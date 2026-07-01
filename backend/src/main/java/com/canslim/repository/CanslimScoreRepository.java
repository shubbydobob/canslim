package com.canslim.repository;

import com.canslim.domain.CanslimScore;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface CanslimScoreRepository extends JpaRepository<CanslimScore, Long> {

    Optional<CanslimScore> findBySecurityIdAndScoreDate(Long securityId, LocalDate scoreDate);

    List<CanslimScore> findByScoreDateAndMarketOrderByCompositeScoreDesc(
            LocalDate scoreDate, String market);

    Page<CanslimScore> findByScoreDateAndMarket(
            LocalDate scoreDate, String market, Pageable pageable);

    long countByScoreDateAndMarket(LocalDate scoreDate, String market);

    List<CanslimScore> findBySecurityIdOrderByScoreDateDesc(Long securityId);

    Optional<CanslimScore> findFirstBySecurityIdOrderByScoreDateDesc(Long securityId);

    /** 시장의 가장 최근 채점일 조회 */
    Optional<CanslimScore> findFirstByMarketOrderByScoreDateDesc(String market);

    @Modifying
    @Query(value = """
        INSERT INTO canslim_scores
            (security_id, score_date, market, c_score, a_score, n_score, s_score, l_score, i_score, m_score,
             composite_score, config_version, created_at)
        VALUES
            (:securityId, :scoreDate, :market, :cScore, :aScore, :nScore, :sScore, :lScore, :iScore, :mScore,
             :compositeScore, :configVersion, NOW())
        ON CONFLICT (security_id, score_date) DO UPDATE SET
            c_score         = EXCLUDED.c_score,
            a_score         = EXCLUDED.a_score,
            n_score         = EXCLUDED.n_score,
            s_score         = EXCLUDED.s_score,
            l_score         = EXCLUDED.l_score,
            i_score         = EXCLUDED.i_score,
            m_score         = EXCLUDED.m_score,
            composite_score = EXCLUDED.composite_score,
            config_version  = EXCLUDED.config_version
        """, nativeQuery = true)
    void upsert(@Param("securityId")    Long securityId,
                @Param("scoreDate")     LocalDate scoreDate,
                @Param("market")        String market,
                @Param("cScore")        Double cScore,
                @Param("aScore")        Double aScore,
                @Param("nScore")        Double nScore,
                @Param("sScore")        Double sScore,
                @Param("lScore")        Double lScore,
                @Param("iScore")        Double iScore,
                @Param("mScore")        Double mScore,
                @Param("compositeScore") double compositeScore,
                @Param("configVersion") Integer configVersion);

    /** 시장 내 종목들의 52주 고점 대비 -15% 이내 비율 → M 점수 (0~100)
     *  scoreDate에 derived_metrics 데이터가 없으면 가장 최근 영업일 데이터로 폴백 */
    @Query(value = """
        SELECT COALESCE(
            LEAST(100, GREATEST(0,
                ROUND((
                    COUNT(*) FILTER (WHERE dm.pct_from_52w_high > -15) * 100.0
                    / NULLIF(COUNT(*), 0) - 5
                ) * 100.0 / 45, 2)
            )),
            50.0)
        FROM derived_metrics dm
        JOIN instruments i ON dm.security_id = i.id
        WHERE dm.as_of_date = (
            SELECT MAX(as_of_date) FROM derived_metrics
            WHERE as_of_date <= :scoreDate
        )
        AND i.market IN (:markets)
        """, nativeQuery = true)
    Double computeMarketBreadth(@Param("scoreDate") LocalDate scoreDate,
                                @Param("markets") List<String> markets);

    /** 점수 날짜별 랭킹 갱신 */
    @Modifying
    @Query(value = """
        UPDATE canslim_scores
        SET market_rank       = ranked.rn,
            market_percentile = ranked.pct
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (ORDER BY composite_score DESC) AS rn,
                   PERCENT_RANK() OVER (ORDER BY composite_score)    AS pct
            FROM canslim_scores
            WHERE score_date = :scoreDate AND market = :market
        ) ranked
        WHERE canslim_scores.id = ranked.id
        """, nativeQuery = true)
    void updateRankings(@Param("scoreDate") LocalDate scoreDate, @Param("market") String market);
}
