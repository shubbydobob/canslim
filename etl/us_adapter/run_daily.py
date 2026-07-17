"""
US 일별 ETL 진입점 (하위호환 shim).
실제 구현은 us_run_daily.py로 이관됨 → 위임.
"""
from .us_run_daily import main

if __name__ == "__main__":
    main()
