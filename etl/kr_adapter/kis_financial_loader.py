"""
KIS API 재무 로더 — 전종목 연간/분기 재무 데이터 수집 (DART 대체)

커버리지: 전 상장종목 (DART 미등록 소형주 포함)
기간: 연간 23년 + 분기 30분기
속도: 전종목 약 10~15분 (초당 20건 한도, 0.06s 딜레이)

API:
  FHKST66430200 income-statement : 매출/영업이익/당기순이익 (단위: 억원)
  FHKST66430100 financial-ratio  : 자본총계 (단위: 억원)

단위 변환: KIS 억원 × 10^8 → financials 테이블 원(KRW)
ROE = net_income(억원) / total_cptl(억원)  ← 단위 상쇄
EPS = net_income(원) / total_shares

실행: python -m etl.kr_adapter.kis_financial_loader
"""
import os
import logging
import time
from datetime import date, datetime
from calendar import monthrange
from typing import Optional

os.environ.setdefault("PYTHONUTF8", "1")

import requests

from .investor_flow_loader import _get_token, _load_config
from ..shared.db_writer import get_all_active_security_ids, upsert_financials, get_session
from ..shared.ingestion_meta import start_run, finish_run, fail_run
from sqlalchemy import text

logger = logging.getLogger(__name__)

SOURCE_PREFIX = "KIS_FIN_KR_"
_BASE_URL     = "https://openapi.koreainvestment.com:9443"
_DELAY        = 0.06   # 초당 16건 (한도 20건보다 여유)

_UNITS = 1e8   # KIS 단위: 억원 → 원 변환


# ─────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────

def _parse(val: str) -> Optional[float]:
    """KIS 금액 파싱. 빈값·'-'·'99.99' → None."""
    if not val or str(val).strip() in ("", "-", "0", "99.99"):
        return None
    try:
        return float(str(val).replace(",", ""))
    except ValueError:
        return None


def _stac_to_meta(stac_yymm: str) -> tuple[int, int, str, bool]:
    """
    stac_yymm(YYYYMM) → (fiscal_year, fiscal_quarter, period_type, is_cumulative)

    KIS 분기 데이터는 모두 누적(1월~N월) 기준.
    month=12 → ANNUAL / month=03,06,09 → QUARTER(누적)
    """
    year  = int(stac_yymm[:4])
    month = int(stac_yymm[4:])
    if month == 12:
        return year, 4, "ANNUAL", False
    q_map = {3: 1, 6: 2, 9: 3}
    return year, q_map[month], "QUARTER", True


def _period_end(fiscal_year: int, fiscal_quarter: int) -> date:
    month = {1: 3, 2: 6, 3: 9, 4: 12}[fiscal_quarter]
    last  = monthrange(fiscal_year, month)[1]
    return date(fiscal_year, month, last)


# ─────────────────────────────────────────────
# KIS API 호출
# ─────────────────────────────────────────────

def _headers(cfg: dict, token: str, tr_id: str) -> dict:
    return {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey":        cfg["app_key"],
        "appsecret":     cfg["app_secret"],
        "tr_id":         tr_id,
        "custtype":      "P",
    }


def _fetch_is(ticker: str, cfg: dict, token: str, div_cls: str) -> list[dict]:
    """손익계산서 조회 (div_cls: '0'=연간, '1'=분기)."""
    try:
        r = requests.get(
            f"{_BASE_URL}/uapi/domestic-stock/v1/finance/income-statement",
            headers=_headers(cfg, token, "FHKST66430200"),
            params={
                "fid_cond_mrkt_div_code": "J",
                "fid_input_iscd":         ticker,
                "fid_div_cls_code":       div_cls,
            },
            timeout=10,
        )
        time.sleep(_DELAY)
        if r.ok and r.json().get("rt_cd") == "0":
            return r.json().get("output", [])
    except Exception as e:
        logger.debug("IS 조회 실패 %s div=%s: %s", ticker, div_cls, e)
    return []


def _fetch_bs(ticker: str, cfg: dict, token: str, div_cls: str) -> dict[str, float]:
    """재무비율(BS 자본총계) 조회 → {stac_yymm: total_cptl(억원)}."""
    result = {}
    try:
        r = requests.get(
            f"{_BASE_URL}/uapi/domestic-stock/v1/finance/financial-ratio",
            headers=_headers(cfg, token, "FHKST66430100"),
            params={
                "fid_cond_mrkt_div_code": "J",
                "fid_input_iscd":         ticker,
                "fid_div_cls_code":       div_cls,
            },
            timeout=10,
        )
        time.sleep(_DELAY)
        if r.ok and r.json().get("rt_cd") == "0":
            for item in r.json().get("output", []):
                v = _parse(item.get("total_cptl"))
                if v is not None:
                    result[item["stac_yymm"]] = v
    except Exception as e:
        logger.debug("BS 조회 실패 %s div=%s: %s", ticker, div_cls, e)
    return result


# ─────────────────────────────────────────────
# 행 생성
# ─────────────────────────────────────────────

def _build_rows(
    security_id: int,
    ticker: str,
    is_rows: list[dict],
    equity_map: dict[str, float],
    total_shares: Optional[int],
    annual_only: bool,
) -> list[dict]:
    rows = []
    for item in is_rows:
        stac = item.get("stac_yymm", "")
        if len(stac) != 6:
            continue
        month = int(stac[4:])
        if annual_only and month != 12:
            continue
        if not annual_only and month == 12:
            continue   # 분기 루프에서 12월 스킵 (연간 루프에서 처리)

        net_income_eok = _parse(item.get("thtr_ntin"))
        revenue_eok    = _parse(item.get("sale_account"))
        op_income_eok  = _parse(item.get("bsop_prti"))

        if net_income_eok is None and revenue_eok is None:
            continue

        fiscal_year, fiscal_quarter, period_type, is_cumulative = _stac_to_meta(stac)

        # 원(KRW) 단위 변환
        net_income = net_income_eok * _UNITS if net_income_eok is not None else None
        revenue    = revenue_eok    * _UNITS if revenue_eok    is not None else None
        op_income  = op_income_eok  * _UNITS if op_income_eok  is not None else None

        # EPS 계산
        eps = None
        if net_income is not None and total_shares and total_shares > 0:
            eps = net_income / total_shares

        # ROE 계산 (연간만, 자본총계 매칭)
        roe = None
        if annual_only and net_income_eok is not None:
            eq = equity_map.get(stac)
            if eq and eq > 0:
                roe = net_income_eok / eq

        rows.append({
            "security_id":      security_id,
            "period_type":      period_type,
            "fiscal_year":      fiscal_year,
            "fiscal_quarter":   fiscal_quarter,
            "period_end_date":  _period_end(fiscal_year, fiscal_quarter),
            "report_date":      None,
            "revenue":          revenue,
            "operating_income": op_income,
            "net_income":       net_income,
            "eps":              eps,
            "shares_diluted":   total_shares,
            "roe":              roe,
            "is_cumulative":    is_cumulative,
            "is_consolidated":  True,   # KIS = 연결 기준
            "currency":         "KRW",
            "data_source":      "KIS_FIN",
        })
    return rows


# ─────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────

def _get_total_shares(security_id: int) -> Optional[int]:
    with get_session() as session:
        row = session.execute(
            text("SELECT total_shares FROM instruments WHERE id = :id"),
            {"id": security_id},
        ).fetchone()
    return int(row.total_shares) if row and row.total_shares else None


def load(target_date: date = None) -> None:
    """전종목 KIS 재무 데이터 수집 및 적재."""
    if target_date is None:
        target_date = date.today()

    cfg   = _load_config()
    token = _get_token(cfg)

    securities = (
        get_all_active_security_ids("KOSPI") +
        get_all_active_security_ids("KOSDAQ")
    )
    total = len(securities)
    logger.info("KIS 재무 수집 시작: %d 종목", total)

    done = skipped = failed = empty = 0

    for idx, (security_id, ticker) in enumerate(securities, 1):
        source = f"{SOURCE_PREFIX}{ticker}"
        run_id = start_run(source, target_date, market="KR")
        if run_id is None:
            skipped += 1
            continue

        try:
            total_shares = _get_total_shares(security_id)

            # 연간 IS + BS
            is_annual  = _fetch_is(ticker, cfg, token, "0")
            bs_annual  = _fetch_bs(ticker, cfg, token, "0")

            # 분기 IS (BS 분기는 생략 — 연간 ROE로 충분)
            is_quarter = _fetch_is(ticker, cfg, token, "1")

            if not is_annual and not is_quarter:
                empty += 1
                fail_run(source, target_date, "empty response")
                continue

            rows  = _build_rows(security_id, ticker, is_annual,  bs_annual, total_shares, annual_only=True)
            rows += _build_rows(security_id, ticker, is_quarter, {},        total_shares, annual_only=False)

            if not rows:
                empty += 1
                fail_run(source, target_date, "no valid rows")
                continue

            ins, upd = upsert_financials(rows)
            finish_run(source, target_date, rows_inserted=ins, rows_updated=upd)
            done += 1

        except Exception as e:
            logger.warning("[%d/%d] %s 실패: %s", idx, total, ticker, e)
            fail_run(source, target_date, str(e))
            failed += 1

        if idx % 100 == 0:
            logger.info("[%d/%d] 완료 %d / 스킵 %d / 빈응답 %d / 실패 %d",
                        idx, total, done, skipped, empty, failed)

    logger.info("KIS 재무 수집 완료 — 완료 %d / 스킵(기완료) %d / 빈응답 %d / 실패 %d",
                done, skipped, empty, failed)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    load()
