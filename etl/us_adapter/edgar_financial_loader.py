"""
US 재무 → financials 테이블 적재
데이터 소스: SEC EDGAR companyfacts API (10-Q / 10-K, XBRL)

  - ticker→CIK: https://www.sec.gov/files/company_tickers.json
  - companyfacts: https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json

KR(KIS) 재무와의 차이 (중요):
  - US 10-Q EPS는 **단독분기(3개월)** 값이 직접 제공됨 → is_cumulative=FALSE로 적재.
    (KR/KIS는 누적분기 is_cumulative=TRUE → financial_normalizer가 차감해 단독분기 산출.
     financial_normalizer에 단독분기 입력 분기(branch)를 추가해 US를 지원한다.)
  - 연결/별도 구분 없음 → is_consolidated=TRUE 통일.
  - 통화 USD. 억원 환산 없음(원 단위 그대로 US 달러).

XBRL 기간 구분:
  - 10-Q에는 3개월(단독분기)·누적(YTD) 값이 같은 fp로 섞여 들어옴 → **기간 길이(days)로 판별**.
    분기 = 60~100일, 연간 = 330~400일. YTD(6·9개월)는 제외.
  - StockholdersEquity는 시점(instant) 개념 → fp='FY' 항목을 연말 자본으로 사용, ROE 계산.

정책:
  - User-Agent 헤더 필수(연락 이메일). 없으면 403.
  - rate limit 10 req/s → 요청 간 슬립.
"""
import os
import time
import logging
from datetime import date

os.environ.setdefault("PYTHONUTF8", "1")

import requests
from ..shared.db_writer import get_all_active_security_ids, upsert_financials
from ..shared.ingestion_meta import start_run, finish_run, fail_run

logger = logging.getLogger(__name__)

SOURCE_PREFIX = "EDGAR_FIN_US_"   # + ticker

_TICKERS_URL   = "https://www.sec.gov/files/company_tickers.json"
_COMPANYFACTS  = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

# SEC 정책: 실제 연락 이메일 포함 필수. 환경변수로 오버라이드 가능.
_USER_AGENT = os.environ.get("SEC_USER_AGENT", "NEXTPICK ETL (shubbydobob@gmail.com)")
_HEADERS = {"User-Agent": _USER_AGENT, "Accept-Encoding": "gzip, deflate"}

_REQ_DELAY = 0.15   # ≈ 6~7 req/s (10/s 한도 여유)

# us-gaap 태그 후보(회사별 상이 → 순서대로 폴백)
_EPS_TAGS = ["EarningsPerShareDiluted", "EarningsPerShareBasic"]
_NI_TAGS  = ["NetIncomeLoss", "ProfitLoss"]
_REV_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"]
_EQ_TAGS  = ["StockholdersEquity"]

_FP_TO_Q = {"Q1": 1, "Q2": 2, "Q3": 3}


def fetch_cik_map() -> dict[str, int]:
    """ticker(대문자, dash) → CIK(int) 매핑."""
    r = requests.get(_TICKERS_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    out = {}
    for entry in data.values():
        t = str(entry["ticker"]).strip().upper()
        out[t] = int(entry["cik_str"])
    return out


def _fetch_companyfacts(cik: int) -> dict | None:
    url = _COMPANYFACTS.format(cik=cik)
    r = requests.get(url, headers=_HEADERS, timeout=30)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def _concept_units(facts: dict, tags: list[str], unit_keys: list[str]) -> list[dict]:
    """us-gaap 태그 후보 중 첫 매칭의 units 배열 반환."""
    usgaap = facts.get("facts", {}).get("us-gaap", {})
    for tag in tags:
        node = usgaap.get(tag)
        if not node:
            continue
        units = node.get("units", {})
        for uk in unit_keys:
            if uk in units:
                return units[uk]
    return []


def _duration_days(entry: dict) -> int | None:
    s, e = entry.get("start"), entry.get("end")
    if not s or not e:
        return None
    try:
        return (date.fromisoformat(e) - date.fromisoformat(s)).days
    except ValueError:
        return None


def _collect_duration(units: list[dict]) -> tuple[dict, dict]:
    """
    기간(duration) 개념 → (quarterly, annual).
    quarterly[(fy, fq)] = {'val', 'end'}, annual[fy] = {'val', 'end'}.
    같은 키 중복 시 end 최신값 채택(재작성 반영).
    """
    quarterly, annual = {}, {}
    for e in units:
        fy, fp = e.get("fy"), e.get("fp")
        val, end = e.get("val"), e.get("end")
        if fy is None or val is None or end is None:
            continue
        days = _duration_days(e)
        if days is None:
            continue
        if 60 <= days <= 100 and fp in _FP_TO_Q:
            key = (int(fy), _FP_TO_Q[fp])
            cur = quarterly.get(key)
            if cur is None or end > cur["end"]:
                quarterly[key] = {"val": float(val), "end": end}
        elif 330 <= days <= 400:
            cur = annual.get(int(fy))
            if cur is None or end > cur["end"]:
                annual[int(fy)] = {"val": float(val), "end": end}
    return quarterly, annual


def _collect_annual_instant(units: list[dict]) -> dict:
    """시점(instant) 개념(자본총계) → annual[fy] = val (fp='FY' 연말 시점)."""
    out = {}
    for e in units:
        fy, fp = e.get("fy"), e.get("fp")
        val, end = e.get("val"), e.get("end")
        if fy is None or val is None or end is None or fp != "FY":
            continue
        cur = out.get(int(fy))
        if cur is None or end > cur["end"]:
            out[int(fy)] = {"val": float(val), "end": end}
    return out


def _build_rows(security_id: int, facts: dict) -> list[dict]:
    """companyfacts → financials 행 리스트."""
    eps_q, eps_a = _collect_duration(_concept_units(facts, _EPS_TAGS, ["USD/shares"]))
    ni_q,  ni_a  = _collect_duration(_concept_units(facts, _NI_TAGS,  ["USD"]))
    rev_q, rev_a = _collect_duration(_concept_units(facts, _REV_TAGS, ["USD"]))
    eq_a         = _collect_annual_instant(_concept_units(facts, _EQ_TAGS, ["USD"]))

    rows = []

    # ── 단독분기(3개월) ──────────────────────────────
    for (fy, fq), eps in eps_q.items():
        ni  = ni_q.get((fy, fq))
        rev = rev_q.get((fy, fq))
        rows.append({
            "security_id":      security_id,
            "period_type":      "QUARTER",
            "fiscal_year":      fy,
            "fiscal_quarter":   fq,
            "period_end_date":  eps["end"],
            "report_date":      eps["end"],
            "revenue":          rev["val"] if rev else None,
            "operating_income": None,
            "net_income":       ni["val"] if ni else None,
            "eps":              eps["val"],
            "shares_diluted":   None,
            "roe":              None,
            "is_cumulative":    False,      # US 단독분기
            "is_consolidated":  True,
            "currency":         "USD",
            "data_source":      "EDGAR",
        })

    # ── 연간 ────────────────────────────────────────
    for fy, eps in eps_a.items():
        ni  = ni_a.get(fy)
        rev = rev_a.get(fy)
        eq  = eq_a.get(fy)
        roe = None
        if ni and eq and eq["val"]:
            roe = ni["val"] / eq["val"]
        rows.append({
            "security_id":      security_id,
            "period_type":      "ANNUAL",
            "fiscal_year":      fy,
            "fiscal_quarter":   4,          # 연간 규약(fiscal_quarter=4)
            "period_end_date":  eps["end"],
            "report_date":      eps["end"],
            "revenue":          rev["val"] if rev else None,
            "operating_income": None,
            "net_income":       ni["val"] if ni else None,
            "eps":              eps["val"],
            "shares_diluted":   None,
            "roe":              roe,
            "is_cumulative":    False,
            "is_consolidated":  True,
            "currency":         "USD",
            "data_source":      "EDGAR",
        })

    return rows


def load(target_date: date = None, limit: int | None = None) -> None:
    """
    US 재무 수집·적재. 종목별 ingestion_meta(EDGAR_FIN_US_{ticker}) resume.

    Args:
        limit: 디버그/로컬 검증용 상위 N 종목만.
    """
    if target_date is None:
        target_date = date.today()

    logger.info("SEC ticker→CIK 매핑 로드")
    cik_map = fetch_cik_map()
    time.sleep(_REQ_DELAY)

    securities = get_all_active_security_ids(market="US")
    if limit:
        securities = securities[:limit]
    total = len(securities)
    logger.info("US 재무 수집 시작: %d 종목 (target=%s)", total, target_date)

    done = skipped = failed = no_cik = 0
    for idx, (security_id, ticker) in enumerate(securities, 1):
        source = f"{SOURCE_PREFIX}{ticker}"
        run_id = start_run(source, target_date, market="US")
        if run_id is None:
            skipped += 1
            continue

        cik = cik_map.get(ticker.upper())
        if cik is None:
            no_cik += 1
            logger.debug("%s CIK 없음 → 스킵", ticker)
            finish_run(source, target_date, rows_inserted=0, rows_updated=0)
            continue

        try:
            facts = _fetch_companyfacts(cik)
            if facts is None:
                finish_run(source, target_date, rows_inserted=0, rows_updated=0)
                done += 1
            else:
                rows = _build_rows(security_id, facts)
                ins, upd = upsert_financials(rows)
                finish_run(source, target_date, rows_inserted=ins, rows_updated=upd)
                done += 1
        except Exception as e:
            failed += 1
            logger.warning("[%d/%d] %s(CIK %s) 재무 실패: %s", idx, total, ticker, cik, e)
            fail_run(source, target_date, str(e))

        if idx % 50 == 0:
            logger.info("[%d/%d] 처리 %d / 스킵 %d / CIK없음 %d / 실패 %d",
                        idx, total, done, skipped, no_cik, failed)
        time.sleep(_REQ_DELAY)

    logger.info("US 재무 수집 완료 — 처리 %d / 스킵(기완료) %d / CIK없음 %d / 실패 %d",
                done, skipped, no_cik, failed)


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="상위 N 종목만(디버그)")
    parser.add_argument("--date", help="target_date (YYYY-MM-DD), 기본 오늘")
    args = parser.parse_args()
    td = date.fromisoformat(args.date) if args.date else None
    load(target_date=td, limit=args.limit)
