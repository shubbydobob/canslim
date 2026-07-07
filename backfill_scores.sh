#!/bin/bash
# 과거 날짜별 financial_normalizer + scoring 백필 (일간, 백그라운드 실행용)
# 실행: nohup bash backfill_scores.sh > backfill.log 2>&1 &

LOG="$HOME/canslim/backfill.log"
cd ~/canslim

echo "[$(date)] 백필 시작" | tee -a $LOG

# price_daily에서 실제 거래일 목록 추출 (2020-01-01 ~ 2026-06-18)
DATES=$(docker exec canslim-postgres psql -U canslim_user -d canslim -t -c \
  "SELECT DISTINCT trade_date FROM price_daily WHERE trade_date BETWEEN '2020-01-01' AND '2026-06-18' AND is_trading_day=TRUE ORDER BY trade_date;")

TOTAL=$(echo "$DATES" | grep -c '[0-9]' || true)
COUNT=0

echo "[$(date)] 총 ${TOTAL}일 처리 예정" | tee -a $LOG

PREV_MONTH=""

for D in $DATES; do
  D=$(echo $D | tr -d ' ')
  [ -z "$D" ] && continue
  COUNT=$((COUNT+1))

  MONTH=$(echo $D | cut -c1-7)

  echo "[$(date '+%H:%M:%S')] [$COUNT/$TOTAL] $D" | tee -a $LOG

  # financial_normalizer는 월 1회만 실행 (EPS carry-forward로 충분)
  if [ "$MONTH" != "$PREV_MONTH" ]; then
    echo "  [fin_norm] $D" | tee -a $LOG
    PYTHONUTF8=1 .venv/bin/python -m etl.kr_adapter.financial_normalizer --date $D >> $LOG 2>&1
    PREV_MONTH=$MONTH
  fi

  # scoring API (Java ScoringJob이 DerivedMetricsJob까지 내부 처리)
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:8080/api/admin/scoring/run?date=$D")
  echo "  scoring -> HTTP $HTTP" | tee -a $LOG

done

echo "[$(date)] 백필 완료! 총 $COUNT일 처리" | tee -a $LOG
