package com.nextpick.scoring.job;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;

/**
 * DerivedMetricsJob 에서 price_metrics, rs_percentile 을
 * 각각 독립 트랜잭션(REQUIRES_NEW)으로 실행하기 위한 빈.
 *
 * 배경: 두 쿼리가 같은 트랜잭션에 있으면 rs_percentile 실패 시
 * price_metrics 2558건도 함께 롤백됨.
 * 별도 빈으로 분리하면 Spring 프록시를 거쳐 독립 트랜잭션이 보장됨.
 */
@Component
public class DerivedMetricsTxHelper {

    @PersistenceContext
    private EntityManager em;

    /**
     * 해당 시장에서 scoreDate 이하의 최신 거래일(price_daily 기준). 없으면 null.
     * 채점일을 실제 마지막 세션으로 앵커링해 미래 날짜의 '그림자' 파생/점수행 생성을 막는 데 사용.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public LocalDate latestTradeDate(String marketIn, LocalDate scoreDate) {
        String sql = ("""
            SELECT MAX(p.trade_date)
            FROM price_daily p
            JOIN instruments i ON i.id = p.security_id
                AND i.market IN (%s) AND i.is_active = TRUE
            WHERE p.trade_date <= :scoreDate
            """).formatted(marketIn);
        Object r = em.createNativeQuery(sql)
                .setParameter("scoreDate", scoreDate)
                .getSingleResult();
        if (r == null) return null;
        if (r instanceof java.sql.Date d) return d.toLocalDate();
        if (r instanceof LocalDate d) return d;
        return LocalDate.parse(r.toString());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int upsertPriceMetrics(String marketIn, LocalDate scoreDate) {
        String sql = ("""
            WITH price_window AS (
                SELECT
                    p.security_id,
                    p.close_adj,
                    p.volume,
                    MAX(p.close_adj) OVER (
                        PARTITION BY p.security_id
                        ORDER BY p.trade_date
                        ROWS BETWEEN 251 PRECEDING AND CURRENT ROW
                    ) AS high_252d,
                    AVG(p.close_adj) OVER (
                        PARTITION BY p.security_id
                        ORDER BY p.trade_date
                        ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
                    ) AS ma_50d,
                    AVG(p.volume) OVER (
                        PARTITION BY p.security_id
                        ORDER BY p.trade_date
                        ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                    ) AS vol_avg_20d,
                    AVG(p.volume) OVER (
                        PARTITION BY p.security_id
                        ORDER BY p.trade_date
                        ROWS BETWEEN 49 PRECEDING AND CURRENT ROW
                    ) AS vol_avg_50d,
                    p.trade_date
                FROM price_daily p
                JOIN instruments i ON i.id = p.security_id
                    AND i.market IN (%s) AND i.is_active = TRUE
                WHERE p.trade_date <= :scoreDate
            ),
            latest_trade AS (
                SELECT MAX(trade_date) AS td
                FROM price_window
            ),
            today AS (
                SELECT
                    security_id,
                    close_adj,
                    volume,
                    high_252d,
                    ma_50d,
                    CASE
                        WHEN high_252d > 0
                        THEN ROUND(CAST((close_adj - high_252d) / high_252d * 100 AS NUMERIC), 4)
                        ELSE NULL
                    END AS pct_from_high,
                    CASE
                        WHEN close_adj > ma_50d
                             AND vol_avg_50d > 0
                             AND volume > vol_avg_50d * 1.5
                        THEN TRUE ELSE FALSE
                    END AS breakout,
                    CASE
                        WHEN vol_avg_20d > 0
                        THEN ROUND(CAST(volume / vol_avg_20d AS NUMERIC), 4)
                        ELSE NULL
                    END AS vol_ratio_20d
                FROM price_window
                WHERE trade_date = (SELECT td FROM latest_trade)
            )
            INSERT INTO derived_metrics (
                security_id, as_of_date,
                pct_from_52w_high, price_vs_base_breakout, volume_ratio_20d,
                created_at
            )
            SELECT
                security_id, :scoreDate,
                pct_from_high, breakout, vol_ratio_20d,
                NOW()
            FROM today
            ON CONFLICT (security_id, as_of_date) DO UPDATE SET
                pct_from_52w_high      = EXCLUDED.pct_from_52w_high,
                price_vs_base_breakout = EXCLUDED.price_vs_base_breakout,
                volume_ratio_20d       = EXCLUDED.volume_ratio_20d
            """).formatted(marketIn);

        return em.createNativeQuery(sql)
                .setParameter("scoreDate", scoreDate)
                .executeUpdate();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int upsertRsPercentile(String marketIn, LocalDate scoreDate) {
        // .formatted() 미사용: PERCENT_RANK() 의 % 가 Java 포맷 지시자로 오해됨
        String sql = "WITH today_price AS ("
                + "  SELECT p.security_id, p.close_adj"
                + "  FROM price_daily p"
                + "  JOIN instruments i ON i.id = p.security_id"
                + "    AND i.market IN (" + marketIn + ") AND i.is_active = TRUE"
                + "  WHERE p.trade_date = :scoreDate"
                + "), base_price AS ("
                + "  SELECT DISTINCT ON (p.security_id)"
                + "    p.security_id, p.close_adj AS close_252d"
                + "  FROM price_daily p"
                + "  JOIN instruments i ON i.id = p.security_id"
                + "    AND i.market IN (" + marketIn + ") AND i.is_active = TRUE"
                + "  WHERE p.trade_date <= (CAST(:scoreDate AS date) - INTERVAL '252 days')"
                + "  ORDER BY p.security_id, p.trade_date DESC"
                + "), returns AS ("
                + "  SELECT t.security_id,"
                + "    (t.close_adj / b.close_252d - 1) * 100 AS return_252d"
                + "  FROM today_price t JOIN base_price b USING (security_id)"
                + "  WHERE b.close_252d > 0"
                + "), ranked AS ("
                + "  SELECT security_id,"
                + "    ROUND(CAST(PERCENT_RANK() OVER (ORDER BY return_252d) * 100 AS NUMERIC), 4) AS rs_pct"
                + "  FROM returns"
                + ") INSERT INTO derived_metrics (security_id, as_of_date, rs_percentile, created_at)"
                + "  SELECT security_id, :scoreDate, rs_pct, NOW() FROM ranked"
                + "  ON CONFLICT (security_id, as_of_date) DO UPDATE SET rs_percentile = EXCLUDED.rs_percentile";

        return em.createNativeQuery(sql)
                .setParameter("scoreDate", scoreDate)
                .executeUpdate();
    }

    /**
     * Accumulation/Distribution 점수(0~100) 계산 — I 팩터의 가격·거래량 프록시.
     *
     * 최근 50거래일에서 상승일 거래량은 +, 하락일 거래량은 −로 집계하되 최근일에 지수가중(0.95^n).
     *   udv = Σ(sign(Δclose)·vol·w) / Σ(vol·w)  ∈ [−1,+1]   (양수=매집 우세, 음수=분산 우세)
     *   score = 50 + 50·udv  ∈ [0,100]
     * 최소 20거래일 이력이 있어야 산출(신규주 노이즈 방지). 시장 무관 — price_daily만 사용.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public int upsertAccumDist(String marketIn, LocalDate scoreDate) {
        String sql = ("""
            WITH win AS (
                SELECT
                    p.security_id,
                    p.close_adj,
                    p.volume,
                    LAG(p.close_adj) OVER (PARTITION BY p.security_id ORDER BY p.trade_date) AS prev_close,
                    ROW_NUMBER()     OVER (PARTITION BY p.security_id ORDER BY p.trade_date DESC) AS rn
                FROM price_daily p
                JOIN instruments i ON i.id = p.security_id
                    AND i.market IN (%s) AND i.is_active = TRUE
                WHERE p.trade_date <= :scoreDate
                  AND p.trade_date >  CAST(:scoreDate AS date) - INTERVAL '120 days'
            ),
            recent AS (
                SELECT
                    security_id,
                    POWER(0.95, rn - 1)          AS w,
                    SIGN(close_adj - prev_close) AS dir,
                    volume
                FROM win
                WHERE rn <= 50 AND prev_close IS NOT NULL AND volume > 0
            ),
            ad AS (
                SELECT
                    security_id,
                    SUM(dir * volume * w) / NULLIF(SUM(volume * w), 0) AS udv
                FROM recent
                GROUP BY security_id
                HAVING COUNT(*) >= 20
            )
            INSERT INTO derived_metrics (security_id, as_of_date, accum_dist_score, created_at)
            SELECT security_id, :scoreDate,
                   ROUND(CAST(50 + 50 * udv AS NUMERIC), 2), NOW()
            FROM ad
            ON CONFLICT (security_id, as_of_date) DO UPDATE SET
                accum_dist_score = EXCLUDED.accum_dist_score
            """).formatted(marketIn);

        return em.createNativeQuery(sql)
                .setParameter("scoreDate", scoreDate)
                .executeUpdate();
    }
}
