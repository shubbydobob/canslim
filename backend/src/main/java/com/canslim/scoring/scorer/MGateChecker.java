package com.canslim.scoring.scorer;

import com.canslim.domain.MarketConfig;
import com.canslim.domain.MarketState;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * M-게이트 (Market Direction) 차단 판정.
 *
 * 설계:
 *   - BEAR 등 mGatePhases 에 등록된 phase이면 → 전 종목 채점 차단(blocked=true).
 *   - CORRECTION 은 기본 설정상 게이트에 포함하지 않음 (경고만 — 스코어 낮아짐).
 *   - marketState 없으면 → 차단 안 함 (데이터 공백 시 screener 중단 방지).
 */
@Component
public class MGateChecker {

    public boolean isBlocked(Optional<MarketState> stateOpt, MarketConfig cfg) {
        if (stateOpt.isEmpty()) return false;
        String phase = stateOpt.get().getMarketPhase();
        if (phase == null) return false;
        return cfg.getGatePhaseSet().contains(phase.toUpperCase());
    }
}
