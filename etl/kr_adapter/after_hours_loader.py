"""
시간외 단일가 종가 → derived_metrics 적재

데이터 소스: 한국투자증권 KIS Developers Open API
  TR: FHKST01010300 (주식현재가 시간외현재가)
  - 시간외 단일가 현재가/전일대비/등락률 반환

저장 컬럼:
  after_hours_close      : 시간외 단일가 체결가 (원)
  after_hours_change_pct : 정규장 종가 대비 등락률 (%)

실행 시점: 평일 18:10 KST (시간외 단일가 마감 18:00 이후)
"""
import time
import logging
from datetime import date
from pathlib import Path

import requests

from .investor_flow_loader import _load_config, _get_token, _BASE_URL, _SLEEP_SEC
from ..shared.db_writer import get_all_active_security_ids, get_session

from sqlalchemy import text

logger = logging.getLogger(__name__)


def _fetch_after_hours_price(ticker: str, cfg: dict, token: str) -> dict | None:
    """FHKST01010300 TR로 시간외 현재가 조회."""
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey":        cfg["app_key"],
        "appsecret":     cfg["app_secret"],
        "tr_id":         "FHKST01010300",
    }
    params = {
        "fid_cond_mrkt_div_code": "J",
        "fid_input_iscd":         ticker,
    }
    try:
        r = requests.get(
            f"{_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
            headers=headers, params=params, timeout=10,
        )
        if r.status_code != 200:
            return None
        d = r.json()
        if d.get("rt_cd") != "0":
            return None

        out = d.get("output", [])
        if not out:
            return None

        # output은 체결시간 내림차순 배열 — 첫 번째가 가장 최근 체결
        latest = out[0] if isinstance(out, list) else out

        price_str = latest.get("stck_prpr", "0")       # 체결가
        change_str = latest.get("prdy_ctrt", "0")       # 전일대비 등락률(%)

        price = int(price_str) if price_str else 0
        change_pct = float(change_str) if change_str else 0.0

        if price <= 0:
            return None

        return {"after_hours_close": price, "after_hours_change_pct": change_pct}

    except Exception as e:
        logger.debug("[%s] 시간외 요청 실패: %s", ticker, e)
        return None


def _upsert_after_hours(rows: list[dict]) -> int:
    """derived_metrics의 시간외 컬럼만 UPDATE."""
    if not rows:
        return 0

    sql = text("""
        UPDATE derived_metrics
        SET after_hours_close = :after_hours_close,
            after_hours_change_pct = :after_hours_change_pct
        WHERE security_id = :security_id AND as_of_date = :as_of_date
    """)

    with get_session() as session:
        for i in range(0, len(rows), 500):
            session.execute(sql, rows[i:i + 500])
    return len(rows)


def load_after_hours(as_of_date: date | None = None) -> int:
    """전 종목 시간외 단일가 수집 및 derived_metrics 적재."""
    if as_of_date is None:
        as_of_date = date.today()

    cfg = _load_config()
    token = _get_token(cfg)

    all_securities = []
    for mkt in ("KOSPI", "KOSDAQ"):
        all_securities.extend(get_all_active_security_ids(mkt))

    total = len(all_securities)
    loaded = 0
    rows_buf: list[dict] = []

    logger.info("시간외 단일가 적재 시작 (as_of_date=%s, 종목=%d)", as_of_date, total)

    for i, (security_id, ticker) in enumerate(all_securities, 1):
        result = _fetch_after_hours_price(ticker, cfg, token)

        if result:
            rows_buf.append({
                "security_id": security_id,
                "as_of_date": as_of_date,
                **result,
            })
            loaded += 1

        if i % 200 == 0:
            logger.info("  진행 %d/%d — 적재 %d", i, total, loaded)

        time.sleep(_SLEEP_SEC)

        if len(rows_buf) >= 500:
            _upsert_after_hours(rows_buf)
            rows_buf.clear()

    if rows_buf:
        _upsert_after_hours(rows_buf)

    logger.info("시간외 단일가 완료 — 적재 %d건 / 전체 %d건", loaded, total)
    return loaded


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    load_after_hours()
