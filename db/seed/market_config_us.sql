-- US 시장 기본 설정 (v1) — Phase 4에서 실제 활성화
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
    'US', 1, FALSE,             -- Phase 4 전까지 비활성
    0.25, FALSE, 0.0, 20.0,    -- C: 절대값 모드 (O'Neil 원전)
    0.25, 0.17, 3,             -- A: 오닐 기준값
    0.10, 1.40,
    1.50,
    80.0, 252,
    10,
    4, 'BEAR',
    0.25, 0.20, 0.15, 0.10, 0.20, 0.10,
    '2020-01-01'
);
