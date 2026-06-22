"""
KR 투자자별 순매수 흐름 → derived_metrics 적재

데이터 소스: 네이버 금융 frgn.naver 스크래핑 (HTML)
  - pykrx KRX 투자자 API (MDCSTAT02302)는 현재 400 LOGOUT 반환으로 사용 불가.
  - 네이버 금융 frgn.naver 는 일별 기관/외국인 순매수 주수(株數)를 제공.

저장 단위: 원(KRW) 환산
  - 순매수 주수 × 당일 종가 = 당일 순매수금액 (근사치)
  - 10일 합산 → inst_net_buy_10d / foreign_net_buy_10d (단위: 원)
  - i_net_buy_threshold 설정 기준: 5,000,000,000원 (50억) 권장

계산 항목:
  inst_net_buy_10d    : 최근 10 거래일 기관합계 순매수 금액 합산 (원, 근사)
  foreign_net_buy_10d : 최근 10 거래일 외국인 순매수 금액 합산 (원, 근사)
  inst_trend_flag     : 최근 3 거래일 기관 트렌드
                        -1 : 3일 모두 순매도
                         0 : 혼조
                         1 : 3일 모두 순매수
                         2 : 3일 모두 순매수 + 가속 (day[-1] >= day[-2] >= day[-3])

한계:
  - 기관/외국인 순매수는 당일 종가 기반 근사 환산. 실제 체결가와 차이 존재.
  - 한국에는 미국 SEC 13F 등가 잔고 기반 데이터가 없어 유량(flow) 신호로만 사용.
  - 네이버 금융 HTML 구조 변경 시 파서 수정 필요.

주의:
  - 빈 응답·파싱 오류·거래정지 종목은 skip → I 점수 null 유지.
  - 요청 간 딜레이 0.3s.
  - 멀티스레드 금지.
"""
import os
import re
import time
import logging
import argparse
from datetime import date, timedelta

os.environ.setdefault("PYTHONUTF8", "1")

import requests
from bs4 import BeautifulSoup

from ..shared.db_writer import get_all_active_security_ids, upsert_investor_flow

logger = logging.getLogger(__name__)

_SLEEP_SEC = 0.3
_NAVER_URL = "https://finance.naver.com/item/frgn.naver"
_HEADERS   = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://finance.naver.com/",
}


# ───────────────────────────────────────────
# HTML 파싱
# ───────────────────────────────────────────

def _parse_num(text: str) -> int | None:
    """'+1,234' / '-5,678' / '' → int or None"""
    cleaned = re.sub(r"[^\d+\-]", "", text.replace(",", ""))
    if not cleaned or cleaned in ("+", "-"):
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def _fetch_investor_rows(ticker: str) -> list[dict] | None:
    """
    네이버 금융 frgn.naver page=1 을 파싱하여 일별 기관/외국인 순매수 행 반환.

    반환 형식: [{'date': date, 'close': int, 'inst': int, 'foreign': int}, ...]
               날짜 내림차순 (가장 최근이 첫 번째)
    """
    try:
        r = requests.get(_NAVER_URL, params={"code": ticker, "page": "1"},
                         headers=_HEADERS, timeout=10)
        r.encoding = "euc-kr"
        if r.status_code != 200:
            return None
    except Exception as e:
        logger.debug("[%s] HTTP 요청 실패: %s", ticker, e)
        return None

    try:
        soup = BeautifulSoup(r.text, "html.parser")
        tables = soup.find_all("table")

        # 테이블 구조가 종목마다 다름:
        #   KOSPI·고거래량 KOSDAQ (13개 테이블) → data at tables[3]
        #   소형 KOSDAQ (12개 테이블) → data at tables[2]
        # 데이터 테이블은 첫 번째 행이 <th> 7개 이상인 테이블. (<td> 페이지네이션과 구분)
        target_table = None
        for t in tables:
            first_row = t.find("tr")
            if first_row:
                ths = first_row.find_all("th")
                if len(ths) >= 7:
                    target_table = t
                    break
        if target_table is None:
            return None

        rows = target_table.find_all("tr")

        result = []
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) < 7 or not cells[0]:
                continue
            # 날짜 파싱
            try:
                d = date.fromisoformat(cells[0].replace(".", "-"))
            except ValueError:
                continue
            close   = _parse_num(cells[1])
            inst    = _parse_num(cells[5])
            foreign = _parse_num(cells[6])
            if close is None or inst is None or foreign is None:
                continue
            result.append({"date": d, "close": close, "inst": inst, "foreign": foreign})

        return result if result else None

    except Exception as e:
        logger.debug("[%s] 파싱 실패: %s", ticker, e)
        return None


# ───────────────────────────────────────────
# 지표 계산
# ───────────────────────────────────────────

def _compute_flow_metrics(rows: list[dict], as_of_date: date) -> dict | None:
    """
    일별 기관/외국인 순매수 주수 × 종가 → WON 환산 후 합산.

    rows: 날짜 내림차순. as_of_date 이전 데이터만 사용.
    """
    valid = [r for r in rows if r["date"] <= as_of_date]
    if not valid:
        return None

    # 최근 10 거래일 (날짜 내림차순 → 앞에서 10개)
    last10 = valid[:10]
    if len(last10) < 3:
        return None   # 데이터 너무 적음

    # WON 환산: 주수 × 종가
    inst_won    = [r["inst"]    * r["close"] for r in last10]
    foreign_won = [r["foreign"] * r["close"] for r in last10]

    inst_10d    = sum(inst_won)
    foreign_10d = sum(foreign_won)

    # inst_trend_flag: 최근 3 거래일 기관 (날짜 내림차순이므로 인덱스 역전)
    # last10[0]=가장 최근, last10[2]=3일 전
    d3, d2, d1 = inst_won[0], inst_won[1], inst_won[2]  # d3=최근

    all_positive = d1 > 0 and d2 > 0 and d3 > 0
    all_negative = d1 < 0 and d2 < 0 and d3 < 0

    if all_positive and d3 >= d2 >= d1:
        trend_flag = 2   # 가속 상승
    elif all_positive:
        trend_flag = 1   # 순매수 지속
    elif all_negative:
        trend_flag = -1  # 순매도 지속
    else:
        trend_flag = 0   # 혼조

    return {
        "inst_net_buy_10d":    inst_10d,
        "foreign_net_buy_10d": foreign_10d,
        "inst_trend_flag":     trend_flag,
    }


# ───────────────────────────────────────────
# 공개 API
# ───────────────────────────────────────────

def load_investor_flow(as_of_date: date = None) -> None:
    """
    전 종목 투자자 순매수 흐름 계산 및 derived_metrics 적재.

    Args:
        as_of_date: 기준일 (기본값: 오늘)
    """
    if as_of_date is None:
        as_of_date = date.today()

    db_markets = ["KOSPI", "KOSDAQ"]
    all_securities = []
    for mkt in db_markets:
        all_securities.extend(get_all_active_security_ids(mkt))

    total   = len(all_securities)
    loaded  = 0
    skipped = 0
    rows_buf: list[dict] = []

    logger.info("investor_flow 적재 시작 (as_of_date=%s, 종목 수=%d)", as_of_date, total)

    for i, (security_id, ticker) in enumerate(all_securities, 1):
        parsed = _fetch_investor_rows(ticker)
        if parsed:
            metrics = _compute_flow_metrics(parsed, as_of_date)
        else:
            metrics = None

        if metrics:
            rows_buf.append({"security_id": security_id, "as_of_date": as_of_date, **metrics})
            loaded += 1
        else:
            skipped += 1

        if i % 200 == 0:
            logger.info("  진행 %d/%d — 적재 %d, skip %d", i, total, loaded, skipped)

        time.sleep(_SLEEP_SEC)

        # 500건마다 flush
        if len(rows_buf) >= 500:
            upsert_investor_flow(rows_buf)
            rows_buf.clear()

    if rows_buf:
        upsert_investor_flow(rows_buf)

    logger.info("investor_flow 완료 — 적재 %d건, skip %d건", loaded, skipped)


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="KR 투자자 순매수 흐름 적재")
    parser.add_argument("--date", help="기준일 (YYYY-MM-DD), 기본값: 오늘")
    args = parser.parse_args()
    as_of = date.fromisoformat(args.date) if args.date else None
    load_investor_flow(as_of)
