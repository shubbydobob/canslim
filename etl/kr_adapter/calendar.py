"""
KRX 거래일 캘린더 유틸리티
pykrx의 get_market_ohlcv가 거래일에만 데이터를 반환하므로,
DB에 저장된 price_daily의 날짜 집합을 기반으로 거래일을 판단합니다.

함정: 신규 종목은 price_daily가 없어 거래일 판단 불가 →
      KOSPI 지수(코드 '1001')의 거래일을 기준으로 사용합니다.
"""
import os
os.environ.setdefault("PYTHONUTF8", "1")

from datetime import date, timedelta
from pykrx import stock
import pandas as pd


_KOSPI_INDEX = "1001"


def get_trading_dates(from_date: date, to_date: date) -> list[date]:
    """
    KRX 거래일 목록 반환.
    KOSPI 지수 OHLCV를 기준으로 사용 (거래일에만 데이터 존재).
    """
    df = stock.get_index_ohlcv(
        from_date.strftime("%Y%m%d"),
        to_date.strftime("%Y%m%d"),
        _KOSPI_INDEX
    )
    if df is None or df.empty:
        return []
    return [d.date() for d in df.index]


def get_nearest_trading_date(target: date) -> date:
    """target 날짜 또는 그 이전 가장 가까운 거래일 반환"""
    check_from = target - timedelta(days=10)
    trading_dates = get_trading_dates(check_from, target)
    return trading_dates[-1] if trading_dates else target


def is_trading_day(target: date) -> bool:
    trading_dates = get_trading_dates(target, target)
    return len(trading_dates) > 0
