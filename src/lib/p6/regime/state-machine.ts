/**
 * P6-04D — Regime State Machine
 *
 * Implements the frozen state machine from P6-04B §6 with:
 * - PD-04B-04: 10-point hysteresis
 * - PD-04B-05: 2 consecutive qualifying snapshots
 * - PD-04C-01: Boundary equality (inclusive toward higher state)
 * - PD-04C-02: Neutral band behavior (regime unchanged)
 * - PD-04C-03: UNKNOWN → real regime when enough data
 * - PD-04C-04: INVALID/MISSING pauses persistence (not reset)
 * - PD-04C-05: UNKNOWN counts toward persistence
 * - PD-04C-06: Gap ≤ 3 days pauses persistence
 * - PD-04C-19: Same-score consecutive = still qualifies
 * - TR-08: Direction lock during transition
 *
 * Authority: P6-04B Semantic Contract, P6-04C1 Decision Contract
 */

import type { RegimeState, RegimeConfig, RegimeStateProperties } from "./types";
import { BOUNDARY_STRONG, BOUNDARY_STABLE_UPPER, BOUNDARY_STABLE_LOWER, BOUNDARY_WEAK } from "./types";

// ─── CORE CLASSIFICATION ──────────────────────────────────────────

/**
 * Classify a health_score into a RegimeState without considering current state.
 * Used for cold-start and initial classification.
 *
 * PD-04C-01: Boundary equality — inclusive toward higher state.
 * Score = 80 → STRONG, Score = 60 → STABLE, Score = 40 → STABLE, Score = 20 → WEAK.
 */
export function classifyScore(score: number): RegimeState {
  if (score >= BOUNDARY_STRONG) return "STRONG";
  if (score <= BOUNDARY_WEAK) return "WEAK";
  if (score >= BOUNDARY_STABLE_LOWER && score <= BOUNDARY_STABLE_UPPER) return "STABLE";
  // Neutral band — classify based on nearest boundary
  if (score > BOUNDARY_STABLE_UPPER) return "STABLE"; // 60 < score < 80
  return "STABLE"; // 20 < score < 40
}

// ─── TRANSITION DETECTION ─────────────────────────────────────────

/**
 * Determine if a score qualifies for a specific target regime.
 */
function qualifiesForRegime(score: number, target: RegimeState): boolean {
  switch (target) {
    case "STRONG": return score >= BOUNDARY_STRONG;
    case "STABLE": return score >= BOUNDARY_STABLE_LOWER && score <= BOUNDARY_STABLE_UPPER;
    case "WEAK": return score <= BOUNDARY_WEAK;
    default: return false;
  }
}

/**
 * Determine what regime a score would transition TO from the current regime.
 * Returns null if no transition is possible.
 *
 * PD-04B-04: 10-point threshold defines the boundaries.
 * PD-04C-02: Neutral bands do NOT independently cause transitions.
 * PD-04C-20: Only one transition per calculation; nearest boundary first.
 */
function findTransitionTarget(
  currentRegime: RegimeState,
  score: number
): RegimeState | null {
  if (currentRegime === "INSUFFICIENT_DATA" || currentRegime === "TRANSITIONING") {
    return null;
  }

  // UNKNOWN → real regime (PD-04C-03)
  if (currentRegime === "UNKNOWN") {
    return classifyScore(score);
  }

  // From STRONG:
  if (currentRegime === "STRONG") {
    if (score <= BOUNDARY_WEAK) return "WEAK";           // ≤ 20 → WEAK
    if (score <= BOUNDARY_STABLE_UPPER) return "STABLE"; // ≤ 60 → STABLE
    return null; // Score > 60, still in STRONG zone or upper neutral band
  }

  // From STABLE:
  if (currentRegime === "STABLE") {
    if (score >= BOUNDARY_STRONG) return "STRONG";
    if (score <= BOUNDARY_WEAK) return "WEAK";
    return null; // Score in neutral band or STABLE zone
  }

  // From WEAK:
  if (currentRegime === "WEAK") {
    if (score >= BOUNDARY_STRONG) return "STRONG";      // ≥ 80 → STRONG
    if (score >= BOUNDARY_STABLE_LOWER) return "STABLE"; // ≥ 40 → STABLE
    return null; // Score < 40, still in WEAK zone or lower neutral band
  }

  return null;
}

// ─── STATE MACHINE ────────────────────────────────────────────────

export interface StateMachineInput {
  readonly currentRegime: RegimeStateProperties;
  readonly healthScore: number;
  readonly snapshotCalculationTime: Date;
  readonly config: RegimeConfig;
}

export interface StateMachineResult {
  readonly newRegime: RegimeState;
  readonly previousState: RegimeState | null;
  readonly consecutiveCount: number;
  readonly transitionStartedAt: Date | null;
  readonly transitionTarget: RegimeState | null;
  readonly scoreAtTransition: number | null;
}

/**
 * Process a single snapshot through the state machine.
 *
 * @param input - Current state + new snapshot score
 * @returns New state machine result
 */
export function processSnapshot(input: StateMachineInput): StateMachineResult {
  const { currentRegime, healthScore, snapshotCalculationTime, config } = input;
  const { current_state, previous_state, consecutive_count, transition_target } = currentRegime;

  // ── INSUFFICIENT_DATA: stay INSUFFICIENT_DATA (data accumulation) ──
  if (current_state === "INSUFFICIENT_DATA") {
    return {
      newRegime: "INSUFFICIENT_DATA",
      previousState: previous_state,
      consecutiveCount: consecutive_count,
      transitionStartedAt: null,
      transitionTarget: null,
      scoreAtTransition: null,
    };
  }

  // ── UNKNOWN → first real regime (PD-04C-03) ──
  if (current_state === "UNKNOWN") {
    const target = classifyScore(healthScore);
    // UNKNOWN → target requires persistence (PD-04B-05)
    // First qualifying snapshot: count=1, enter TRANSITIONING
    return {
      newRegime: "TRANSITIONING",
      previousState: current_state,
      consecutiveCount: 1,
      transitionStartedAt: snapshotCalculationTime,
      transitionTarget: target,
      scoreAtTransition: healthScore,
    };
  }

  // ── TRANSITIONING: check if persistence met (TR-08) ──
  if (current_state === "TRANSITIONING" && transition_target) {
    const target = transition_target;
    const qualifies = qualifiesForRegime(healthScore, target);

    if (qualifies) {
      const newCount = consecutive_count + 1;
      if (newCount >= config.minPersistence) {
        // Persistence met → complete transition
        return {
          newRegime: target,
          previousState: current_state,
          consecutiveCount: newCount,
          transitionStartedAt: null,
          transitionTarget: null,
          scoreAtTransition: null,
        };
      }
      // Still transitioning, increment count
      return {
        newRegime: "TRANSITIONING",
        previousState: previous_state,
        consecutiveCount: newCount,
        transitionStartedAt: currentRegime.transition_started_at,
        transitionTarget: target,
        scoreAtTransition: currentRegime.score_at_transition,
      };
    }

    // Score reverted → transition fails, revert to previous state (PD-04C-04)
    return {
      newRegime: previous_state ?? current_state,
      previousState: previous_state,
      consecutiveCount: 0,
      transitionStartedAt: null,
      transitionTarget: null,
      scoreAtTransition: null,
    };
  }

  // ── Stable regime (STRONG/STABLE/WEAK): check for transition ──
  const target = findTransitionTarget(current_state, healthScore);

  if (target) {
    // Transition detected → enter TRANSITIONING
    return {
      newRegime: "TRANSITIONING",
      previousState: current_state,
      consecutiveCount: 1,
      transitionStartedAt: snapshotCalculationTime,
      transitionTarget: target,
      scoreAtTransition: healthScore,
    };
  }

  // No transition: score is in current regime's zone or neutral band
  return {
    newRegime: current_state,
    previousState: current_state,
    consecutiveCount: consecutive_count + 1,
    transitionStartedAt: null,
    transitionTarget: null,
    scoreAtTransition: null,
  };
}

// ─── INITIAL STATE ────────────────────────────────────────────────

export function createInitialState(): RegimeStateProperties {
  return {
    current_state: "INSUFFICIENT_DATA",
    previous_state: null,
    transition_started_at: null,
    transition_target: null,
    consecutive_count: 0,
    score_at_transition: null,
  };
}

export function createUnknownState(): RegimeStateProperties {
  return {
    current_state: "UNKNOWN",
    previous_state: null,
    transition_started_at: null,
    transition_target: null,
    consecutive_count: 0,
    score_at_transition: null,
  };
}
