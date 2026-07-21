"""
KIS 밸류에이션(PER·PBR·EPS·BPS) 스냅샷 → derived_metrics 적재

목적: 장외/주말에도 종목 상세 '투자지표' 카드가 실측 PER·PBR을 표시하도록
      EOD 스냅샷을 배치로 적재한다. 장중엔 RealtimePriceController가 같은
      KIS inquire-price로 실시간 오버레이하므로, 이 배치값은 장외 폴백 전용.

데이터 소스: 한국투자증권 KIS Developers Open API
  TR: FHKST01010100 (inquire-price, 주식 현재가)
  - per(주가수익비율), pbr(주가순자산비율), eps(주당순이익·원), bps(주당순자산·원)
  넥스트레이드 통합: fid_cond_mrkt_div_code "UN"(통합) 우선 → 빈값 시 "J"(KRX) 폴백.

저장 컬럼(derived_metrics UPDATE — 파생 생성 이후 당일 행에 매칭):
  per, pbr, eps, bps

run_daily 7d 단계에서 호출(파생 6단계 이후). 비치명적.
"""
import time
import logging
from datetime import date

import requests

from .investor_flow_loader import _load_config, _get_token, _BASE_URL, _SLEEP_SEC
from ..shared.db_writer import get_all_active_security_ids, get_session

from sqlalchemy import text

logger = logging.getLogger(__name__)


def _to_float(s) -> float | None:
    """KIS 문자열 필드 → float. 빈값/0/파싱실패는 None(적재 스킵 신호)."""
    if s is None:
        return None
    try:
        v = float(str(s).strip())
    except (TypeError, ValueError):
        return None
    return v


def _inquire_valuation(ticker: str, cfg: dict, token: str, mkt: str) -> dict | None:
    """inquire-price로 per/pbr/eps/bps 조회 (시장구분 mkt). rt_cd!=0/빈값이면 None."""
    headers = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {token}",
        "appkey":        cfg["app_key"],
        "appsecret":     cfg["app_secret"],
        "tr_id":         "FHKST01010100",
    }
    params = {
        "fid_cond_mrkt_div_code": mkt,
        "fid_input_iscd":         ticker,
    }
    try:
        r = requests.get(
            f"{_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price",
            headers=headers, params=params, timeout=10,
        )
        if r.status_code != 200:
            return None
        d = r.json()
        if d.get("rt_cd") != "0":
            return None
        out = d.get("output") or {}
        # 현재가가 0이면(미지원/거래정지 등) 밸류에이션도 신뢰 불가 → 폴백/스킵.
        prpr = _to_float(out.get("stck_prpr"))
        if prpr in (None, 0.0):
            return None
        vol = _to_float(out.get("acml_vol"))
        return {
            "per": _to_float(out.get("per")),
            "pbr": _to_float(out.get("pbr")),
            "eps": _to_float(out.get("eps")),
            "bps": _to_float(out.get("bps")),
            # KIS 통합(UN=KRX+NXT) EOD — 장외에도 증권사(키움)와 일치하도록 표시에 우선 반영.
            "kis_close":      prpr,
            "kis_change_pct": _to_float(out.get("prdy_ctrt")),
            "kis_volume":     int(vol) if vol is not None else None,
            "kis_turnover":   _to_float(out.get("acml_tr_pbmn")),
        }
    except Exception as e:
        logger.debug("[%s] 밸류에이션 요청 실패: %s", ticker, e)
        return None


def _fetch_valuation(ticker: str, cfg: dict, token: str) -> dict | None:
    """UN(통합) 우선 → 빈값이면 J(KRX) 폴백. 넥스트레이드 통합 시세 정합."""
    row = _inquire_valuation(ticker, cfg, token, "UN")
    if row is None:
        row = _inquire_valuation(ticker, cfg, token, "J")
    if row is None:
        return None
    # 통합 종가(kis_close)가 있으면(가격 유효) 밸류에이션이 비어도 적재(통합 EOD 표시용).
    if row.get("kis_close") in (None, 0.0) and all(row.get(k) in (None, 0.0) for k in ("per", "pbr", "eps", "bps")):
        return None
    return row


def _upsert_valuation(rows: list[dict]) -> int:
    """derived_metrics의 밸류에이션 컬럼만 UPDATE (당일 행 존재 전제 — 파생 이후 실행)."""
    if not rows:
        return 0
    sql = text("""
        UPDATE derived_metrics
        SET per = :per, pbr = :pbr, eps = :eps, bps = :bps,
            kis_close = :kis_close, kis_change_pct = :kis_change_pct,
            kis_volume = :kis_volume, kis_turnover = :kis_turnover
        WHERE security_id = :security_id AND as_of_date = :as_of_date
    """)
    with get_session() as session:
        for i in range(0, len(rows), 500):
            session.execute(sql, rows[i:i + 500])
    return len(rows)


def load_valuation(as_of_date: date | None = None) -> int:
    """전 종목 PER·PBR·EPS·BPS 수집 및 derived_metrics 적재."""
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

    logger.info("밸류에이션(PER/PBR/EPS/BPS) 적재 시작 (as_of_date=%s, 종목=%d)", as_of_date, total)

    for i, (security_id, ticker) in enumerate(all_securities, 1):
        result = _fetch_valuation(ticker, cfg, token)

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
            _upsert_valuation(rows_buf)
            rows_buf.clear()

    if rows_buf:
        _upsert_valuation(rows_buf)

    logger.info("밸류에이션 완료 — 적재 %d건 / 전체 %d건", loaded, total)
    return loaded


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    load_valuation()
