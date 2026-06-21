package com.canslim.scoring.job;

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
                WHERE trade_date = :scoreDate
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
}
