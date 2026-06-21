"""
KR 일별 주가 → price_daily 적재
데이터 소스: pykrx get_market_ohlcv

설계 결정:
  - pykrx 1.0.51은 수정주가(adjusted)만 제공.
    adjusted=False → 빈 DataFrame (미지원).
    따라서 close = close_adj = pykrx 수정가로 초기 적재.
    재백필 시 close_adj만 갱신, close(원본)는 ON CONFLICT에서 제외(불변).
  - 거래대금: pykrx 컬럼 없음 → close × volume 근사.
  - 백필: 종목별 ingestion_meta(source=PYKRX_PRICE_KR_{ticker}, target=end_date)로
    resume 가능. 중간 중단 후 재실행 시 SUCCESS 종목 스킵.
  - 요청 간 딜레이 0.3s 기본 (KRX 스크래핑 IP 차단/빈 응답 방지).
    멀티스레드 금지.

함정:
  - pykrx adjusted=False → 빈 응답 (버그 아님, 단순 미지원).
  - 신규 상장 종목: 상장 전 날짜 조회 시 빈 DataFrame → 정상.
  - PYTHONUTF8=1 필수.
"""
import os
import time
import logging
from datetime import date

os.environ.setdefault("PYTHONUTF8", "1")

from pykrx import stock
from ..shared.db_writer import get_all_active_security_ids, upsert_price_daily
from ..shared.ingestion_meta import start_run, finish_run, fail_run

logger = logging.getLogger(__name__)

SOURCE_DAILY            = "PYKRX_PRICE_KR"
SOURCE_BACKFILL_PREFIX  = "PYKRX_PRICE_KR_"   # + ticker


def _fetch_ohlcv(ticker: str, from_date: date, to_date: date) -> list[dict]:
    """
    pykrx OHLCV 수집 → dict 리스트.

    pykrx는 수정주가만 제공하므로 close = close_adj.
    빈 응답(거래정지·신규상장) 시 빈 리스트 반환.
    """
    df = stock.get_market_ohlcv(
        from_date.strftime("%Y%m%d"),
        to_date.strftime("%Y%m%d"),
        ticker,
    )
    if df is None or df.empty:
        return []

    rows = []
    for trade_date, row in df.iterrows():
        close_val  = float(row.iloc[3])   # 종가
        volume_val = int(row.iloc[4])     # 거래량
        rows.append({
            "trade_date": trade_date.date() if hasattr(trade_date, "date") else trade_date,
            "open":       float(row.iloc[0]),
            "high":       float(row.iloc[1]),
            "low":        float(row.iloc[2]),
            "close":      close_val,
            "close_adj":  close_val,       # pykrx = 수정가. 재백필 시 갱신됨.
            "volume":     volume_val,
            "turnover":   close_val * volume_val,  # pykrx 거래대금 미제공 → 근사
        })
    return rows


def _get_all_securities() -> list[tuple[int, str]]:
    return (
        get_all_active_security_ids(market="KOSPI") +
        get_all_active_security_ids(market="KOSDAQ")
    )


def backfill(
    start_date: date,
    end_date: date,
    delay_sec: float = 0.3,
) -> None:
    """
    start_date ~ end_date 전 종목 가격 백필. 종목별 resume 가능.

    ingestion_meta key: (PYKRX_PRICE_KR_{ticker}, end_date)
    이미 SUCCESS인 종목은 건너뜀.

    종료 시 빈응답 통계 및 RS 커버리지 리포트 출력.
    """
    securities = _get_all_securities()
    total = len(securities)
    logger.info("백필 시작: %d 종목, %s ~ %s, 딜레이 %.1fs", total, start_date, end_date, delay_sec)

    done = skipped = failed = empty_count = 0

    for idx, (security_id, ticker) in enumerate(securities, 1):
        source = f"{SOURCE_BACKFILL_PREFIX}{ticker}"
        run_id = start_run(source, end_date, market="KR")

        if run_id is None:
            skipped += 1
            if skipped % 200 == 0:
                logger.info("[%d/%d] 스킵 누적 %d", idx, total, skipped)
            continue

        try:
            rows = _fetch_ohlcv(ticker, start_date, end_date)

            if not rows:
                empty_count += 1
                logger.debug("[%d/%d] %s 빈 응답 (거래정지·신규상장 전 기간)", idx, total, ticker)
                finish_run(source, end_date, rows_inserted=0, rows_updated=0)
            else:
                for row in rows:
                    row["security_id"] = security_id
                ins, upd = upsert_price_daily(rows)
                finish_run(source, end_date, rows_inserted=ins, rows_updated=upd)

            done += 1

        except Exception as e:
            failed += 1
            logger.warning("[%d/%d] %s 실패: %s", idx, total, ticker, e)
            fail_run(source, end_date, str(e))

        if idx % 50 == 0:
            logger.info(
                "[%d/%d] 처리 %d / 스킵 %d / 빈응답 %d / 실패 %d",
                idx, total, done, skipped, empty_count, failed,
            )

        time.sleep(delay_sec)

    processed = done + failed
    logger.info(
        "백필 완료 — 처리 %d / 스킵(기완료) %d / 실패 %d",
        done, skipped, failed,
    )
    if processed > 0:
        logger.info(
            "빈응답률: %.1f%% (%d / %d) — 거래정지·상폐·신규상장 기간 초과 추정",
            empty_count / processed * 100, empty_count, processed,
        )

    report_rs_coverage(end_date)


def report_rs_coverage(end_date: date) -> None:
    """
    백필 후 RS 계산 가능 여부 리포트.
    종목별 price_daily 적재 거래일 수를 기준으로 분류:
      - ≥252일 : RS 정상 계산 가능
      - 60~251일: RS 단축 계산 (LScorer 최소 60일 예외 처리 필요)
      - <60일   : RS NULL — 스크리너 제외 권장
    """
    from ..shared.db_writer import get_session
    from sqlalchemy import text

    sql = text("""
        SELECT
            COUNT(*) FILTER (WHERE day_count >= 252)             AS full_rs,
            COUNT(*) FILTER (WHERE day_count >= 60
                             AND   day_count <  252)             AS partial_rs,
            COUNT(*) FILTER (WHERE day_count < 60)              AS no_rs,
            COUNT(*)                                             AS total,
            MIN(day_count)                                       AS min_days,
            PERCENTILE_CONT(0.1) WITHIN GROUP
                (ORDER BY day_count)::INT                        AS p10_days
        FROM (
            SELECT security_id, COUNT(DISTINCT trade_date) AS day_count
            FROM   price_daily
            WHERE  trade_date <= :ed
            GROUP  BY security_id
        ) t
    """)
    with get_session() as session:
        r = session.execute(sql, {"ed": end_date}).fetchone()

    print("\n=== RS 커버리지 리포트 ===")
    print(f"기준일 : {end_date}  (252거래일 ≒ 1년)")
    print(f"  RS 정상 (≥252일) : {r.full_rs:>5}종목")
    print(f"  RS 단축 (60~251일): {r.partial_rs:>5}종목  ← LScorer 최소 60일 예외 처리 필요")
    print(f"  RS 불가 (<60일)  : {r.no_rs:>5}종목  ← 스크리너 제외 권장")
    print(f"  합계              : {r.total:>5}종목")
    print(f"  최소 거래일수     : {r.min_days}일,  하위10% : {r.p10_days}일")
    print()


def load_daily(target_date: date = None) -> None:
    """
    당일 가격 수집 (일배치용).
    source_name = PYKRX_PRICE_KR, target_date = 수집일.
    """
    if target_date is None:
        target_date = date.today()

    run_id = start_run(SOURCE_DAILY, target_date, market="KR")
    if run_id is None:
        logger.info("이미 처리됨: %s %s, 스킵", SOURCE_DAILY, target_date)
        return

    try:
        securities = _get_all_securities()
        logger.info("일별 가격 수집: %d 종목, %s", len(securities), target_date)

        total_ins = total_upd = 0
        for security_id, ticker in securities:
            rows = _fetch_ohlcv(ticker, target_date, target_date)
            for row in rows:
                row["security_id"] = security_id
            ins, upd = upsert_price_daily(rows)
            total_ins += ins
            total_upd += upd
            time.sleep(0.1)

        logger.info("일별 가격 적재 완료: 신규 %d, 갱신 %d", total_ins, total_upd)
        finish_run(SOURCE_DAILY, target_date, rows_inserted=total_ins, rows_updated=total_upd)

    except Exception as e:
        logger.exception("일별 가격 적재 실패")
        fail_run(SOURCE_DAILY, target_date, str(e))
        raise


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    START = date(2022, 1, 1)
    END   = date.today()

    backfill(START, END)
