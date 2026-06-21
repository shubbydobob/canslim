"""
DART 누적 재무 → 단독분기 변환 + derived_metrics 계산

변환 규칙:
  Q1_sa  = Q1_cum                    (직전 누적 없음)
  Q2_sa  = H1_cum  - Q1_cum
  Q3_sa  = 9M_cum  - H1_cum
  Q4_sa  = Annual  - 9M_cum

derived_metrics (Python ETL 담당 컬럼):
  eps_standalone_latest  : 최근 단독분기 EPS
  eps_standalone_prev_yq : 1년 전 동일분기 EPS
  eps_qoq_yoy_pct        : YoY% = (latest - prev_yq) / |prev_yq| × 100
  eps_qoq_accel          : 당분기 YoY% - 전분기 YoY%
  eps_3yr_cagr           : 최근 연간 EPS 3개년 CAGR
  eps_annual_consistency : 최근 3년 중 전년 대비 EPS 성장 횟수 / 3
  roe_latest             : 최근 연간 ROE (financials.roe — 현재 None)
"""
import logging
from datetime import date
from typing import Optional

from ..shared.db_writer import get_session, upsert_derived_metrics
from sqlalchemy import text

logger = logging.getLogger(__name__)


# ───────────────────────────────────────────
# 데이터 로드
# ───────────────────────────────────────────

def _load_quarterly(session, security_id: int) -> list[dict]:
    """누적 분기 재무 데이터 로드 (CFS 우선, 없으면 OFS)."""
    sql = text("""
        SELECT fiscal_year, fiscal_quarter, eps, is_consolidated
        FROM   financials
        WHERE  security_id  = :sid
          AND  period_type  = 'QUARTER'
          AND  is_cumulative = TRUE
          AND  eps IS NOT NULL
        ORDER  BY fiscal_year, fiscal_quarter, is_consolidated DESC
    """)
    rows = session.execute(sql, {"sid": security_id}).fetchall()
    # (year, quarter) 기준 CFS 우선 선택
    seen, result = set(), []
    for r in rows:
        key = (r.fiscal_year, r.fiscal_quarter)
        if key not in seen:
            seen.add(key)
            result.append({
                "year": r.fiscal_year,
                "quarter": r.fiscal_quarter,
                "eps_cum": float(r.eps) if r.eps is not None else None,
            })
    return result


def _load_annual(session, security_id: int) -> list[dict]:
    """연간 재무 데이터 로드 (CFS 우선)."""
    sql = text("""
        SELECT fiscal_year, eps, roe, is_consolidated
        FROM   financials
        WHERE  security_id   = :sid
          AND  period_type   = 'ANNUAL'
          AND  is_cumulative = FALSE
          AND  eps IS NOT NULL
        ORDER  BY fiscal_year, is_consolidated DESC
    """)
    rows = session.execute(sql, {"sid": security_id}).fetchall()
    seen, result = set(), []
    for r in rows:
        if r.fiscal_year not in seen:
            seen.add(r.fiscal_year)
            result.append({
                "year": r.fiscal_year,
                "eps": float(r.eps) if r.eps is not None else None,
                "roe": float(r.roe) if r.roe is not None else None,
            })
    return result


# ───────────────────────────────────────────
# 누적 → 단독분기 변환
# ───────────────────────────────────────────

def _to_standalone(quarterly: list[dict]) -> dict[tuple, float]:
    """
    누적 EPS → 단독분기 EPS 변환.
    returns: {(year, quarter): eps_standalone}
    """
    # {(year, quarter): eps_cum}
    cum = {(r["year"], r["quarter"]): r["eps_cum"] for r in quarterly}
    result = {}
    for (year, q), eps_c in cum.items():
        if q == 1:
            result[(year, 1)] = eps_c
        else:
            prev = cum.get((year, q - 1))
            if prev is not None:
                result[(year, q)] = eps_c - prev
    return result


# ───────────────────────────────────────────
# 지표 계산
# ───────────────────────────────────────────

def _safe_yoy(current: Optional[float], prev: Optional[float]) -> Optional[float]:
    if current is None or prev is None or prev == 0:
        return None
    return (current - prev) / abs(prev) * 100


def _compute_metrics(
    standalone: dict[tuple, float],
    annual: list[dict],
    as_of_date: date,
) -> dict:
    """단독분기·연간 EPS로 CANSLIM C·A 지표 계산."""
    # 기준일 이전 단독분기만 사용
    valid = {k: v for k, v in standalone.items()
             if date(k[0], k[1] * 3, 28) <= as_of_date}

    if not valid:
        return {}

    sorted_keys = sorted(valid.keys())
    latest_k  = sorted_keys[-1]
    latest_yq = k_minus_4(sorted_keys)   # 1년 전 동일 분기

    latest_eps  = valid.get(latest_k)
    prev_yq_eps = valid.get(latest_yq) if latest_yq else None

    # YoY%
    yoy = _safe_yoy(latest_eps, prev_yq_eps)

    # 가속도: 현분기 YoY - 전분기 YoY
    accel = None
    if len(sorted_keys) >= 2:
        prev_k = sorted_keys[-2]
        prev_yq2 = k_minus_4_from(sorted_keys, prev_k)
        prev_yoy = _safe_yoy(valid.get(prev_k), valid.get(prev_yq2) if prev_yq2 else None)
        if yoy is not None and prev_yoy is not None:
            accel = yoy - prev_yoy

    # 3년 CAGR (연간 EPS)
    annual_by_year = {r["year"]: r["eps"] for r in annual}
    cagr  = None
    recent_years = sorted(annual_by_year.keys(), reverse=True)
    if len(recent_years) >= 4:
        y_latest = recent_years[0]
        y_base   = recent_years[3]   # 3년 전
        eps_l = annual_by_year[y_latest]
        eps_b = annual_by_year[y_base]
        if eps_b and eps_b > 0 and eps_l and eps_l > 0:
            cagr = (eps_l / eps_b) ** (1 / 3) - 1

    # 연간 일관성: 최근 3년 중 전년 대비 성장 횟수 / 3
    consistency = None
    if len(recent_years) >= 4:
        growth_count = sum(
            1 for i in range(3)
            if annual_by_year.get(recent_years[i]) is not None
            and annual_by_year.get(recent_years[i + 1]) is not None
            and annual_by_year[recent_years[i]] > annual_by_year[recent_years[i + 1]]
        )
        consistency = growth_count / 3

    # 최근 ROE
    roe_latest = next(
        (r["roe"] for r in sorted(annual, key=lambda x: x["year"], reverse=True)
         if r.get("roe") is not None),
        None,
    )

    return {
        "eps_standalone_latest":  latest_eps,
        "eps_standalone_prev_yq": prev_yq_eps,
        "eps_qoq_yoy_pct":        yoy,
        "eps_qoq_accel":          accel,
        "eps_3yr_cagr":           cagr,
        "eps_annual_consistency": consistency,
        "roe_latest":             roe_latest,
    }


def k_minus_4(sorted_keys: list[tuple]) -> Optional[tuple]:
    """sorted_keys 마지막 원소에서 정확히 4분기 전 키 반환."""
    if not sorted_keys:
        return None
    last = sorted_keys[-1]
    return k_minus_4_from(sorted_keys, last)


def k_minus_4_from(sorted_keys: list[tuple], k: tuple) -> Optional[tuple]:
    year, q = k
    target = (year - 1, q)
    return target if target in set(sorted_keys) else None


# ───────────────────────────────────────────
# 공개 API
# ───────────────────────────────────────────

def normalize_security(security_id: int, as_of_date: date) -> bool:
    """
    단일 종목 derived_metrics 계산 및 적재.
    returns: True if data available, False if skipped
    """
    with get_session() as session:
        quarterly = _load_quarterly(session, security_id)
        annual    = _load_annual(session, security_id)

    if not quarterly and not annual:
        return False

    standalone = _to_standalone(quarterly)
    metrics    = _compute_metrics(standalone, annual, as_of_date)

    if not metrics:
        return False

    upsert_derived_metrics([{
        "security_id": security_id,
        "as_of_date":  as_of_date,
        **metrics,
    }])
    return True


def normalize_all(as_of_date: date = None) -> None:
    """전 종목 derived_metrics 계산 (dart_loader 완료 후 실행)."""
    if as_of_date is None:
        as_of_date = date.today()

    from ..shared.db_writer import get_session
    from sqlalchemy import text as t

    with get_session() as session:
        ids = [r.security_id for r in session.execute(
            t("SELECT DISTINCT security_id FROM financials ORDER BY security_id")
        ).fetchall()]

    logger.info("derived_metrics 계산: %d 종목", len(ids))
    done = skipped = 0
    for security_id in ids:
        if normalize_security(security_id, as_of_date):
            done += 1
        else:
            skipped += 1

    logger.info("계산 완료: %d건 적재, %d건 데이터 부족 스킵", done, skipped)


if __name__ == "__main__":
    import os, argparse
    os.environ.setdefault("PYTHONUTF8", "1")
    import logging
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="as_of_date (YYYY-MM-DD), 기본값: 오늘")
    args = parser.parse_args()
    as_of = date.fromisoformat(args.date) if args.date else None
    normalize_all(as_of)
