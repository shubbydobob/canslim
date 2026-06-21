-- KR 시장 기본 설정 (v1)
INSERT INTO market_config (
    market, version, is_active,
    c_eps_growth_threshold, c_use_percentile, c_neg_growth_score_cap, c_accel_max_bonus,
    a_eps_cagr_threshold, a_roe_min, a_min_years,
    n_max_pct_from_high, n_breakout_vol_min,
    s_vol_surge_threshold,
    l_rs_min_percentile, l_rs_window_days,
    i_net_buy_window_days,
    m_distribution_day_limit, m_gate_phases,
    weight_c, weight_a, weight_n, weight_s, weight_l, weight_i,
    effective_from
) VALUES (
    'KR', 1, TRUE,
    0.25, TRUE, 20.0, 20.0,     -- C: 퍼센타일 모드, 음성장 캡 20점
    0.20, 0.15, 3,              -- A: CAGR 20%, ROE 15% (KR 기준 하향)
    0.10, 1.40,                 -- N
    1.50,                       -- S
    80.0, 252,                  -- L
    10,                         -- I
    4, 'BEAR',                  -- M 게이트
    0.25, 0.20, 0.15, 0.10, 0.20, 0.10,
    '2020-01-01'
);
