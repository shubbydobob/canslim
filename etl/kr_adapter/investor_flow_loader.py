"""
KR 투자자별 순매수 흐름 → derived_metrics 적재

데이터 소스: 한국투자증권 KIS Developers Open API
  TR: FHKST01010900 (주식 투자자별 매매동향)
  - 최근 30 거래일치 일별 개인/외국인/기관 순매수 금액(백만원) 반환
  - 기존 네이버 금융 HTML 스크래핑(주수×종가 근사) 대비 정확한 실제 체결금액 제공

저장 단위: 원(KRW)
  - API 반환값(백만원) × 1,000,000 → 원 환산
  - 10일 합산 → inst_net_buy_10d / foreign_net_buy_10d

계산 항목:
  inst_net_buy_10d    : 최근 10 거래일 기관합계 순매수 금액 합산 (원)
  foreign_net_buy_10d : 최근 10 거래일 외국인 순매수 금액 합산 (원)
  inst_trend_flag     : 최근 3 거래일 기관 트렌드
                        -1 : 3일 모두 순매도
                         0 : 혼조
                         1 : 3일 모두 순매수
                         2 : 3일 모두 순매수 + 가속 (d1 >= d2 >= d3, 가장 최근 기준)

API 제한:
  - 토큰 발급: 1분 1회. 발급된 토큰은 24시간 유효 → 파일 캐시
  - TR 호출: 초당 20건 이하 권장 → 0.06s delay
  - 빈 응답·오류 종목은 skip → I 점수 null 유지
"""
import os
import json
import time
import logging
import argparse
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

import requests
import yaml

from ..shared.db_writer import get_all_active_security_ids, upsert_investor_flow

logger = logging.getLogger(__name__)

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "kis.yaml"
_TOKEN_CACHE = Path(tempfile.gettempdir()) / "kis_token_cache.json"
_SLEEP_SEC   = 0.06
_BASE_URL    = "https://openapi.koreainvestment.com:9443"


# ───────────────────────────────────────────
# 설정 / 토큰
# ───────────────────────────────────────────

def _load_config() -> dict:
    if not _CONFIG_PATH.exists():
        raise FileNotFoundError(f"KIS 설정 파일 없음: {_CONFIG_PATH}")
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _get_token(cfg: dict) -> str:
    """
    KIS 접근 토큰 반환. 캐시 파일에 유효한 토큰이 있으면 재사용,
    없거나 만료됐으면 새로 발급 (1분 1회 제한 준수).
    """
    # 캐시 확인
    if _TOKEN_CACHE.exists():
        try:
            with open(_TOKEN_CACHE, encoding="utf-8") as f:
                cache = json.load(f)
            expires_at = datetime.fromisoformat(cache["expires_at"])
            if datetime.now(tz=timezone.utc) < expires_at:
                logger.debug("KIS 토큰 캐시 사용 (만료: %s)", expires_at)
                return cache["access_token"]
        except Exception:
            pass  # 캐시 손상 시 재발급

    # 토큰 발급
    logger.info("KIS 접근 토큰 발급 요청...")
    r = requests.post(
        f"{_BASE_URL}/oauth2/tokenP",
        json={
            "grant_type": "client_credentials",
            "appkey":     cfg["app_key"],
            "appsecret":  cfg["app_secret"],
        },
        timeout=15,
    )
    r.raise_for_status()
    data = r.json()
    token = data["access_token"]
    expires_in = int(data.get("expires_in", 86400))

    # 만료 10분 전 여유를 두고 캐시
    from datetime import timedelta
    expires_at = datetime.now(tz=timezone.utc) + timedelta(seconds=expires_in - 600)
    with open(_TOKEN_CACHE, "w", encoding="utf-8") as f:
        json.dump({"access_token": token, "expires_at": expires_at.isoformat()}, f)

    logger.info("KIS 토큰 발급 완료 (유효기간 %ds)", expires_in)
    return token


# ───────────────────────────────────────────
# KIS API 호출
# ───────────────────────────────────────────

def _fetch_investor_rows(ticker: str, cfg: dict, token: str) -> list[dict] | None:
    """
    FHKST01010900 TR로 종목의 최근 30 거래일 투자자별 매매동향 조회.

    반환: [{'date': date, 'orgn_mn': int, 'frgn_mn': int}, ...]  (날짜 내림차순)
           orgn_mn / frgn_mn 단위: 백만원 (순매수 양수, 순매도 음수)
    """
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey":        cfg["app_key"],
        "appsecret":     cfg["app_secret"],
        "tr_id":         "FHKST01010900",
    }
    params = {
        "fid_cond_mrkt_div_code": "J",
        "fid_input_iscd":         ticker,
        "fid_div_cls_code":       "1",   # 1 = 금액 기준
    }
    try:
        r = requests.get(
            f"{_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor",
            headers=headers, params=params, timeout=10,
        )
        if r.status_code != 200:
            logger.debug("[%s] HTTP %d", ticker, r.status_code)
            return None
        d = r.json()
        if d.get("rt_cd") != "0":
            logger.debug("[%s] rt_cd=%s msg=%s", ticker, d.get("rt_cd"), d.get("msg1", ""))
            return None

        rows = []
        for row in d.get("output", []):
            date_str = row.get("stck_bsop_date", "")
            if len(date_str) != 8:
                continue
            try:
                d_obj = date(int(date_str[:4]), int(date_str[4:6]), int(date_str[6:]))
            except ValueError:
                continue
            try:
                orgn_mn = int(row["orgn_ntby_tr_pbmn"])
                frgn_mn = int(row["frgn_ntby_tr_pbmn"])
            except (KeyError, ValueError):
                continue
            rows.append({"date": d_obj, "orgn_mn": orgn_mn, "frgn_mn": frgn_mn})

        return rows if rows else None

    except Exception as e:
        logger.debug("[%s] 요청 실패: %s", ticker, e)
        return None


# ───────────────────────────────────────────
# 지표 계산
# ───────────────────────────────────────────

def _compute_flow_metrics(rows: list[dict], as_of_date: date) -> dict | None:
    """
    일별 기관/외국인 순매수 금액(백만원) → 원 환산 후 10일 합산.

    rows: 날짜 내림차순. as_of_date 이하 데이터만 사용.
    """
    valid = [r for r in rows if r["date"] <= as_of_date]
    if not valid:
        return None

    last10 = valid[:10]
    if len(last10) < 3:
        return None

    # 백만원 → 원
    inst_won    = [r["orgn_mn"] * 1_000_000 for r in last10]
    foreign_won = [r["frgn_mn"] * 1_000_000 for r in last10]

    inst_10d    = sum(inst_won)
    foreign_10d = sum(foreign_won)

    # inst_trend_flag: 최근 3 거래일 (last10[0]=가장 최근)
    d1, d2, d3 = inst_won[0], inst_won[1], inst_won[2]

    all_pos = d1 > 0 and d2 > 0 and d3 > 0
    all_neg = d1 < 0 and d2 < 0 and d3 < 0

    if all_pos and d1 >= d2 >= d3:
        trend_flag = 2    # 순매수 가속
    elif all_pos:
        trend_flag = 1    # 순매수 지속
    elif all_neg:
        trend_flag = -1   # 순매도 지속
    else:
        trend_flag = 0    # 혼조

    return {
        "inst_net_buy_10d":    inst_10d,
        "foreign_net_buy_10d": foreign_10d,
        "inst_trend_flag":     trend_flag,
    }


# ───────────────────────────────────────────
# 공개 API
# ───────────────────────────────────────────

def load_investor_flow(as_of_date: date | None = None) -> None:
    """
    전 종목 투자자 순매수 흐름 계산 및 derived_metrics 적재.
    """
    if as_of_date is None:
        as_of_date = date.today()

    cfg = _load_config()
    token = _get_token(cfg)

    all_securities = []
    for mkt in ("KOSPI", "KOSDAQ"):
        all_securities.extend(get_all_active_security_ids(mkt))

    total   = len(all_securities)
    loaded  = 0
    skipped = 0
    rows_buf: list[dict] = []

    logger.info("investor_flow 적재 시작 (as_of_date=%s, 종목=%d, 소스=KIS)", as_of_date, total)

    for i, (security_id, ticker) in enumerate(all_securities, 1):
        parsed = _fetch_investor_rows(ticker, cfg, token)
        metrics = _compute_flow_metrics(parsed, as_of_date) if parsed else None

        if metrics:
            rows_buf.append({"security_id": security_id, "as_of_date": as_of_date, **metrics})
            loaded += 1
        else:
            skipped += 1

        if i % 200 == 0:
            logger.info("  진행 %d/%d — 적재 %d, skip %d", i, total, loaded, skipped)

        time.sleep(_SLEEP_SEC)

        if len(rows_buf) >= 500:
            upsert_investor_flow(rows_buf)
            rows_buf.clear()

    if rows_buf:
        upsert_investor_flow(rows_buf)

    logger.info("investor_flow 완료 — 적재 %d건, skip %d건 (소스=KIS)", loaded, skipped)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="KR 투자자 순매수 흐름 적재 (KIS API)")
    parser.add_argument("--date", help="기준일 (YYYY-MM-DD), 기본값: 오늘")
    args = parser.parse_args()
    as_of = date.fromisoformat(args.date) if args.date else None
    load_investor_flow(as_of)
