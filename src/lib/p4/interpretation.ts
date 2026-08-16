import type {
  P4DirectionState,
  P4FiredSignal,
  P4InterpretationResult,
  P4Move,
  P4QualitativeValue,
} from "./types";
import type { P4Assembly } from "./assembler";

/**
 * P4-03 interpretation engine (P4-05A).
 *
 * Deterministic transformation of assembled P3 + P2 evidence into the P4
 * Decision Support result: signals (P4-03 §3), Direction (§4), Opportunity
 * (§12), Risk (§11/§12), Confidence (§7), Actionability (§8/§13), conflict
 * handling (§9), P2 projection (§10) and UNKNOWN propagation (§14).
 *
 * This module performs NO P3 recalculation and NO new numeric cutoffs: every
 * input is a persisted P3 read-model state or a frozen step delta; every rule
 * is a semantic combination of those states. Identical input ⇒ identical
 * output (no LLM, no ML, no hidden heuristic).
 *
 * Provisional-rule note: where the frozen P4-03 prose (§7/§9) and the
 * canonical §16 scenarios disagree on the Confidence impact of a material
 * conflict, the scenarios (the §20 acceptance vectors) win — a material
 * conflict caps Confidence at MEDIUM ("not HIGH") instead of forcing LOW.
 * This is recorded as a deviation-requires-review item in the P4-05A report.
 */

// ---------------------------------------------------------------------------
// Qualitative ladder helpers (deterministic tier arithmetic, no weights)
// ---------------------------------------------------------------------------

const TIER: Record<Exclude<P4QualitativeValue, "UNKNOWN">, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function fromTier(tier: number): Exclude<P4QualitativeValue, "UNKNOWN"> {
  if (tier >= 2) return "HIGH";
  if (tier >= 1) return "MEDIUM";
  return "LOW";
}

function capTier(tier: number, cap: number): number {
  return Math.min(tier, cap);
}

function signOf(move: P4Move): "POSITIVE" | "NEGATIVE" | null {
  if (move === "POSITIVE") return "POSITIVE";
  if (move === "NEGATIVE") return "NEGATIVE";
  return null;
}

function opposite(sign: "POSITIVE" | "NEGATIVE"): "POSITIVE" | "NEGATIVE" {
  return sign === "POSITIVE" ? "NEGATIVE" : "POSITIVE";
}

// ---------------------------------------------------------------------------
// Evidence conflict detection (P4-03 §9)
// ---------------------------------------------------------------------------

interface ConflictInfo {
  fired: boolean;
  material: boolean;
  /** Opposite-sign pairs within the direction core (both sides in C). */
  corePairs: number;
  severity: "low" | "medium" | "high";
}

/**
 * §9.1 firing + §9.2 materiality + §9.3 severity.
 * Material = opposite-sign pair within the direction core (core split).
 * Severity: ≥2 core pairs → HIGH; material with 1 → MEDIUM; minor → LOW.
 */
function detectConflict(moves: P4Assembly["moves"]): ConflictInfo {
  const core = [moves.regime, moves.rotationScore, moves.momentum];
  const five = [moves.regime, moves.rotationScore, moves.momentum, moves.breadth, moves.relativeStrength];

  const positive = five.filter((m) => m === "POSITIVE");
  const negative = five.filter((m) => m === "NEGATIVE");
  const fired = positive.length > 0 && negative.length > 0;

  let corePairs = 0;
  for (let i = 0; i < core.length; i += 1) {
    for (let j = i + 1; j < core.length; j += 1) {
      const a = signOf(core[i]);
      const b = signOf(core[j]);
      if (a != null && b != null && a !== b) corePairs += 1;
    }
  }

  // Materiality = opposite-sign pair within the direction core (a core split).
  // Breadth-vs-core conflicts are MINOR per the canonical §16 scenarios
  // (Scenario 2 "breadth opposes → minor conflict, Confidence −1"; Scenario 5
  // momentum-vs-breadth labeled minor) — the §9.2 prose "OR core-vs-breadth"
  // is inconsistent with both scenarios and is NOT applied (reported as a
  // deviation-requires-review in the P4-05A report).
  const material = corePairs > 0;
  const severity: ConflictInfo["severity"] = corePairs >= 2 ? "high" : material ? "medium" : "low";

  return { fired, material, corePairs, severity };
}

// ---------------------------------------------------------------------------
// Signals (P4-03 §3)
// ---------------------------------------------------------------------------

/** Deterministic signal detection over the assembled evidence. */
export function detectSignals(assembly: P4Assembly): P4FiredSignal[] {
  const { moves, history, narrativeId, keysByField } = assembly;
  const windowEnd = assembly.current.windowEnd;
  const trend = history.trend.overall;
  const conflict = detectConflict(moves);

  // Suppression for NARRATIVE_* (§3.2/§3.3): a material conflict *within the
  // direction core* (core split). Core-vs-breadth conflicts do not suppress
  // (canonical Scenario 2 keeps NARRATIVE_IMPROVEMENT with an opposing breadth).
  const coreSplit = conflict.corePairs > 0;

  const key = (field: string, index = 0): string | undefined => keysByField[field]?.[index];
  const keys = (field: string): string[] => keysByField[field] ?? [];
  const opposingKeys = (lean: "POSITIVE" | "NEGATIVE"): string[] => {
    const opposing: string[] = [];
    if (moves.breadth === opposite(lean)) opposing.push(...keys("breadthMove"));
    if (moves.relativeStrength === opposite(lean)) opposing.push(...keys("relativeStrengthMove"));
    return opposing;
  };

  const signals: P4FiredSignal[] = [];
  const push = (signal: Omit<P4FiredSignal, "narrativeId" | "windowEnd">) => {
    signals.push({ ...signal, narrativeId, windowEnd });
  };

  // NARRATIVE_IMPROVEMENT (§3.2)
  if (
    trend === "IMPROVING" &&
    moves.regime !== "NEGATIVE" &&
    (moves.rotationScore === "POSITIVE" || moves.momentum === "POSITIVE" || moves.regime === "POSITIVE") &&
    !coreSplit
  ) {
    const corroborating: string[] = [];
    if (moves.regime === "POSITIVE") corroborating.push(...keys("regimeMove"));
    if (moves.rotationScore === "POSITIVE") corroborating.push(...keys("rotationScoreMove"));
    if (moves.momentum === "POSITIVE") corroborating.push(...keys("momentumMove"));
    const opposing = opposingKeys("POSITIVE");
    push({
      id: "NARRATIVE_IMPROVEMENT",
      directionRelation: "POSITIVE",
      evidenceKeys: [key("trend.overall"), ...corroborating].filter((k): k is string => k != null),
      ...(opposing.length > 0 ? { conflictingEvidenceKeys: opposing } : {}),
    });
  }

  // NARRATIVE_DETERIORATION (§3.3)
  if (
    trend === "DETERIORATING" &&
    moves.regime !== "POSITIVE" &&
    (moves.regime === "NEGATIVE" || moves.rotationScore === "NEGATIVE" || moves.momentum === "NEGATIVE") &&
    !coreSplit
  ) {
    const corroborating: string[] = [];
    if (moves.regime === "NEGATIVE") corroborating.push(...keys("regimeMove"));
    if (moves.rotationScore === "NEGATIVE") corroborating.push(...keys("rotationScoreMove"));
    if (moves.momentum === "NEGATIVE") corroborating.push(...keys("momentumMove"));
    const opposing = opposingKeys("NEGATIVE");
    push({
      id: "NARRATIVE_DETERIORATION",
      directionRelation: "NEGATIVE",
      evidenceKeys: [key("trend.overall"), ...corroborating].filter((k): k is string => k != null),
      ...(opposing.length > 0 ? { conflictingEvidenceKeys: opposing } : {}),
    });
  }

  // BROADENING / NARROWING (§3.4/§3.5)
  if (moves.breadth === "POSITIVE") {
    push({ id: "BROADENING", directionRelation: "POSITIVE", evidenceKeys: keys("breadthMove") });
  } else if (moves.breadth === "NEGATIVE") {
    push({ id: "NARROWING", directionRelation: "NEGATIVE", evidenceKeys: keys("breadthMove") });
  }

  // REGIME_CHANGE (§3.7) — only ranked movement; unranked ⇒ not emitted.
  if (assembly.latestStep && (assembly.latestStep.regime.state === "IMPROVING" || assembly.latestStep.regime.state === "DETERIORATING")) {
    push({
      id: "REGIME_CHANGE",
      directionRelation: moves.regime === "POSITIVE" ? "POSITIVE" : moves.regime === "NEGATIVE" ? "NEGATIVE" : "MIXED",
      evidenceKeys: [key("regime.previous"), key("regime.current")].filter((k): k is string => k != null),
    });
  }

  // ROTATION_CHANGE (§3.8)
  if (assembly.latestStep) {
    const rotationMoved =
      assembly.latestStep.rotation.state === "IMPROVING" || assembly.latestStep.rotation.state === "DETERIORATING";
    const scoreMoved = moves.rotationScore === "POSITIVE" || moves.rotationScore === "NEGATIVE";
    if (rotationMoved || scoreMoved) {
      push({
        id: "ROTATION_CHANGE",
        directionRelation:
          moves.rotationScore === "POSITIVE" || assembly.latestStep.rotation.state === "IMPROVING"
            ? "POSITIVE"
            : "NEGATIVE",
        evidenceKeys: [key("rotation.previous"), key("rotation.current"), key("rotationScore.delta")].filter(
          (k): k is string => k != null
        ),
      });
    }
  }

  // LEADERSHIP_CHANGE (§3.6) — both sides available (else suppressed).
  if (assembly.latestStep?.leadership.changed && assembly.latestStep.leadership.previous && assembly.latestStep.leadership.current) {
    push({
      id: "LEADERSHIP_CHANGE",
      directionRelation: "MIXED",
      evidenceKeys: [key("leadership.previous.symbol"), key("leadership.current.symbol")].filter(
        (k): k is string => k != null
      ),
    });
  }

  // EVIDENCE_CONFLICT (§3.9) — informational, MIXED.
  if (conflict.fired) {
    const moveByField: Record<string, P4Move> = {
      regimeMove: moves.regime,
      rotationScoreMove: moves.rotationScore,
      momentumMove: moves.momentum,
      breadthMove: moves.breadth,
      relativeStrengthMove: moves.relativeStrength,
    };
    const positiveKeys: string[] = [];
    const negativeKeys: string[] = [];
    for (const field of Object.keys(moveByField)) {
      const move = moveByField[field];
      if (move === "POSITIVE") positiveKeys.push(...keys(field));
      else if (move === "NEGATIVE") negativeKeys.push(...keys(field));
    }
    push({
      id: "EVIDENCE_CONFLICT",
      directionRelation: "MIXED",
      severity: conflict.severity,
      evidenceKeys: positiveKeys,
      conflictingEvidenceKeys: negativeKeys,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Direction (P4-03 §4)
// ---------------------------------------------------------------------------

export interface DirectionResult {
  direction: P4DirectionState;
  /** Valid corroborator moves opposing the lean (minor conflicts, §4 Step 3). */
  opposingCorroborators: number;
  /** Historical trend opposes the current direction (Confidence −1, §4 Step 4). */
  historicalDivergence: boolean;
}

/** Deterministic Direction aggregation (P4-03 §4.1). */
export function interpretDirection(assembly: P4Assembly): DirectionResult {
  const { moves, trendOverall } = assembly;
  const core = [moves.regime, moves.rotationScore, moves.momentum];
  const corroborators = [moves.breadth, moves.relativeStrength];

  const posC = core.filter((m) => m === "POSITIVE").length;
  const negC = core.filter((m) => m === "NEGATIVE").length;

  // Step 2 — core lean. `dominant` separates the §4 dominant case (≥2 core
  // same sign) from the tentative case (exactly 1 core sign): opposing
  // corroborators do not flip a dominant lean, but they DO flip a tentative
  // lean into MIXED (P4-03 §4 Step 3).
  let base: P4DirectionState;
  let lean: "POSITIVE" | "NEGATIVE" | null = null;
  let dominant = false;
  if (posC >= 2) {
    base = "POSITIVE";
    lean = "POSITIVE";
    dominant = true;
  } else if (negC >= 2) {
    base = "NEGATIVE";
    lean = "NEGATIVE";
    dominant = true;
  } else if (posC === 1 && negC === 1) {
    base = "MIXED";
  } else if (posC === 1) {
    base = "POSITIVE";
    lean = "POSITIVE";
  } else if (negC === 1) {
    base = "NEGATIVE";
    lean = "NEGATIVE";
  } else {
    base = "NEUTRAL";
  }

  // Step 3 — corroborator reconciliation (only VALID non-UNKNOWN corroborators count).
  const validCorroborators = corroborators.filter((m) => m !== "UNKNOWN");
  let direction: P4DirectionState = base;
  let opposingCorroborators = 0;

  if (lean) {
    const opposing = validCorroborators.filter((m) => signOf(m) === opposite(lean)).length;
    opposingCorroborators = opposing;
    if (dominant) {
      // Dominant lean: opposing corroborators do not flip the lean (each is a
      // minor conflict, §4 Step 3 + §9).
      direction = base;
    } else if (opposing > 0) {
      // Tentative lean + opposing corroborator → MIXED (P4-03 §4 Step 3).
      direction = "MIXED";
    } else {
      direction = base;
    }
  } else if (base === "MIXED") {
    direction = "MIXED";
  } else {
    // NEUTRAL base — split corroborators ⇒ MIXED.
    const posX = validCorroborators.some((m) => m === "POSITIVE");
    const negX = validCorroborators.some((m) => m === "NEGATIVE");
    if (posX && negX) {
      direction = "MIXED";
      opposingCorroborators = 1;
    } else {
      direction = "NEUTRAL";
    }
  }

  // Step 4 — historical context is context-only; it never overrides Direction.
  const historicalDivergence =
    (direction === "POSITIVE" && trendOverall === "DETERIORATING") ||
    (direction === "NEGATIVE" && trendOverall === "IMPROVING");

  return { direction, opposingCorroborators, historicalDivergence };
}

// ---------------------------------------------------------------------------
// Opportunity (P4-03 §12)
// ---------------------------------------------------------------------------

function interpretOpportunity(input: {
  direction: P4DirectionState;
  moves: P4Assembly["moves"];
  conflict: ConflictInfo;
  stale: boolean;
  trendOverall: P4Assembly["trendOverall"];
  p2: P4Assembly["p2"];
}): P4QualitativeValue {
  const { direction, moves, conflict, stale, trendOverall, p2 } = input;
  if (direction === "UNKNOWN") return "UNKNOWN";
  if (direction === "NEGATIVE" || direction === "MIXED" || direction === "NEUTRAL") return "LOW";

  // POSITIVE — start HIGH, apply the suppression ladder (§12.3), each −1, floor LOW.
  let tier = TIER.HIGH;
  const adverse: Array<boolean> = [
    moves.breadth === "NEGATIVE",
    moves.momentum === "NEGATIVE",
    moves.regime === "NEGATIVE",
    moves.rotationScore === "NEGATIVE",
    moves.relativeStrength === "NEGATIVE",
    conflict.material,
    trendOverall === "DETERIORATING",
  ];
  tier = Math.max(0, tier - adverse.filter(Boolean).length);
  if (stale) tier = capTier(tier, TIER.MEDIUM);
  if (p2.scope === "narrative-wide" && (p2.maxRiskLevel === "HIGH" || p2.maxRiskLevel === "CRITICAL")) {
    tier = capTier(tier, TIER.MEDIUM);
  }
  return fromTier(tier);
}

// ---------------------------------------------------------------------------
// Risk (P4-03 §11/§12.2)
// ---------------------------------------------------------------------------

function interpretRisk(input: {
  direction: P4DirectionState;
  moves: P4Assembly["moves"];
  trendOverall: P4Assembly["trendOverall"];
  p2: P4Assembly["p2"];
}): P4QualitativeValue {
  const { direction, moves, trendOverall, p2 } = input;
  if (direction === "UNKNOWN") return "UNKNOWN";

  const detCount = [moves.regime, moves.rotationScore, moves.momentum, moves.breadth].filter(
    (m) => m === "NEGATIVE"
  ).length;
  let tier =
    detCount >= 2 || (direction === "NEGATIVE" && trendOverall === "DETERIORATING")
      ? TIER.HIGH
      : detCount === 1
        ? TIER.MEDIUM
        : TIER.LOW;

  // P2 adjustment (§10/§11): narrative-wide or multi-coin HIGH/CRITICAL ⇒ +1
  // tier, cap HIGH; never sole HIGH (LOW + 1 = MEDIUM).
  const p2High =
    (p2.scope === "narrative-wide" || p2.scope === "multi-coin") &&
    (p2.maxRiskLevel === "HIGH" || p2.maxRiskLevel === "CRITICAL");
  if (p2High) tier = capTier(tier + 1, TIER.HIGH);

  // Historical contradiction (Scenario 11): current POSITIVE + trend
  // DETERIORATING is structural context ⇒ +1 tier (LOW → MEDIUM).
  if (direction === "POSITIVE" && trendOverall === "DETERIORATING") {
    tier = capTier(tier + 1, TIER.HIGH);
  }

  return fromTier(tier);
}

// ---------------------------------------------------------------------------
// Confidence (P4-03 §7 + canonical §16 scenarios)
// ---------------------------------------------------------------------------

function interpretConfidence(input: {
  moves: P4Assembly["moves"];
  conflict: ConflictInfo;
  opposingCorroborators: number;
  historicalDivergence: boolean;
  stale: boolean;
  insufficientHistory: boolean;
}): P4QualitativeValue {
  const { moves, conflict, opposingCorroborators, historicalDivergence, stale, insufficientHistory } = input;
  if (insufficientHistory) return "LOW";

  const coreValidity = [moves.regime, moves.rotationScore, moves.momentum].filter((m) => m !== "UNKNOWN").length;
  const corroboratorValidity = [moves.breadth, moves.relativeStrength].filter((m) => m !== "UNKNOWN").length;

  // Coverage dimension (§7).
  let tier =
    coreValidity === 3 && corroboratorValidity === 2
      ? TIER.HIGH
      : coreValidity === 3 && corroboratorValidity === 1
        ? TIER.MEDIUM
        : TIER.LOW;

  // Consistency dimension. Canonical scenarios (§16): a material conflict caps
  // Confidence at MEDIUM ("not HIGH"); minor conflicts reduce one level.
  if (conflict.material) {
    tier = capTier(tier, TIER.MEDIUM);
  } else {
    tier = Math.max(0, tier - opposingCorroborators);
  }

  // Historical divergence (§6 contradiction role): −1.
  if (historicalDivergence) tier = Math.max(0, tier - 1);

  // Stale cap (§14).
  if (stale) tier = capTier(tier, TIER.MEDIUM);

  return fromTier(tier);
}

// ---------------------------------------------------------------------------
// Actionability (P4-03 §8 + §13 matrix overrides)
// ---------------------------------------------------------------------------

function interpretActionability(input: {
  direction: P4DirectionState;
  confidence: P4QualitativeValue;
  opportunity: P4QualitativeValue;
  risk: P4QualitativeValue;
  conflict: ConflictInfo;
  p2: P4Assembly["p2"];
}): P4QualitativeValue {
  const { direction, confidence, opportunity, risk, conflict, p2 } = input;
  if (direction === "UNKNOWN") return "UNKNOWN";
  if (direction === "NEUTRAL") return "LOW";
  if (direction === "MIXED") return confidence === "HIGH" || confidence === "MEDIUM" ? "MEDIUM" : "LOW";

  // POSITIVE / NEGATIVE.
  const determinable = opportunity !== "UNKNOWN" || risk !== "UNKNOWN";
  let base: P4QualitativeValue =
    confidence === "HIGH"
      ? determinable
        ? "HIGH"
        : "LOW"
      : confidence === "MEDIUM"
        ? determinable
          ? "MEDIUM"
          : "LOW"
        : "LOW";

  // §13 matrix: LOW opportunity + HIGH risk + Direction NEGATIVE + Conf ≥ MEDIUM ⇒ HIGH.
  if (opportunity === "LOW" && risk === "HIGH" && direction === "NEGATIVE" && (confidence === "HIGH" || confidence === "MEDIUM")) {
    base = "HIGH";
  }

  // §13: contradictory HIGH opportunity + HIGH risk ⇒ MEDIUM (evidence review).
  if (opportunity === "HIGH" && risk === "HIGH") base = "MEDIUM";

  // §9: material conflict ⇒ never HIGH. Scenario 10: narrative-wide HIGH P2 ⇒ never HIGH.
  if (conflict.material) base = "MEDIUM";
  if (p2.scope === "narrative-wide" && (p2.maxRiskLevel === "HIGH" || p2.maxRiskLevel === "CRITICAL")) base = "MEDIUM";

  return base;
}

// ---------------------------------------------------------------------------
// Main interpretation entry point
// ---------------------------------------------------------------------------

/** Interpret the assembled evidence into the P4-03 result (deterministic). */
export function interpretP4(assembly: P4Assembly): P4InterpretationResult {
  const { current, history, moves, trendOverall, p2, refs, values, narrativeId } = assembly;
  const windowEnd = current.windowEnd;

  const coreKeys = (): string[] => {
    const moveByField: Record<string, P4Move> = {
      regimeMove: moves.regime,
      rotationScoreMove: moves.rotationScore,
      momentumMove: moves.momentum,
    };
    const keys: string[] = [];
    for (const field of Object.keys(moveByField)) {
      const move = moveByField[field];
      if (move !== "UNKNOWN") {
        const candidates = assembly.keysByField[field] ?? [];
        if (candidates[0]) keys.push(candidates[0]);
      }
    }
    return keys;
  };

  const degraded = (degradation: P4InterpretationResult["degradation"], confidence: P4QualitativeValue): P4InterpretationResult =>
    ({
      status: "DEGRADED" as const,
      narrativeId,
      windowEnd,
      direction: "UNKNOWN",
      opportunity: "UNKNOWN",
      risk: "UNKNOWN",
      confidence,
      actionability: "UNKNOWN",
      signals: [],
      evidence: refs,
      values,
      context: {
        historicalTrend: trendOverall,
        dataSufficiency: {
          comparableArtifacts: history.dataSufficiency.comparableArtifacts,
          requiredMinimum: history.dataSufficiency.requiredMinimum,
          sufficient: history.dataSufficiency.sufficient,
        },
        p2Expected: false,
      },
      degradation,
    });

  // Gate 1 — no valid current (defensive; the service boundary returns null
  // for NO_EVIDENCE before interpretation runs).
  if (current.availabilityState === "MISSING" || current.availabilityState === "INVALID" || current.availabilityState === "AMBIGUOUS") {
    const code = current.availabilityState === "AMBIGUOUS" ? "AMBIGUOUS" : "INVALID";
    return degraded([{ code, field: "current" }], "LOW");
  }

  // Identity ambiguity (P4-02 §7) — never guess.
  const identityFields = [current.window, current.algorithmKey, current.algorithmVersion, current.calculationMode];
  if (identityFields.some((value) => value == null || value === "")) {
    return degraded([{ code: "IDENTITY_AMBIGUOUS" }], "UNKNOWN");
  }

  const stale = current.availabilityState === "STALE";

  // Gate 2 — insufficient history (<2 artifacts) (§4.1 Step 1, §14).
  if (assembly.latestStep == null) {
    return degraded([{ code: "INSUFFICIENT_HISTORY" }], "LOW");
  }

  const conflict = detectConflict(moves);

  // Gate 3 — ≥2 direction-core moves UNKNOWN (§4.1 Step 1, §14).
  const coreUnknown = [moves.regime, moves.rotationScore, moves.momentum].filter((m) => m === "UNKNOWN").length;
  if (coreUnknown >= 2) {
    return degraded([{ code: "CRITICAL_EVIDENCE_MISSING" }], "LOW");
  }

  const signals = detectSignals(assembly);
  const directionResult = interpretDirection(assembly);
  const direction = directionResult.direction;

  const opportunity = interpretOpportunity({
    direction,
    moves,
    conflict,
    stale,
    trendOverall,
    p2,
  });
  const risk = interpretRisk({ direction, moves, trendOverall, p2 });
  const confidence = interpretConfidence({
    moves,
    conflict,
    opposingCorroborators: directionResult.opposingCorroborators,
    historicalDivergence: directionResult.historicalDivergence,
    stale,
    insufficientHistory: false,
  });
  const actionability = interpretActionability({ direction, confidence, opportunity, risk, conflict, p2 });

  const conclusionEvidence = {
    direction: coreKeys(),
    confidence: [...coreKeys(), ...((assembly.keysByField["trend.overall"] ?? []).slice(0, 1))],
  };

  return {
    status: stale ? "DEGRADED" : "AVAILABLE",
    narrativeId,
    windowEnd,
    direction,
    opportunity,
    risk,
    confidence,
    actionability,
    signals,
    evidence: refs,
    values,
    context: {
      historicalTrend: trendOverall,
      dataSufficiency: {
        comparableArtifacts: history.dataSufficiency.comparableArtifacts,
        requiredMinimum: history.dataSufficiency.requiredMinimum,
        sufficient: history.dataSufficiency.sufficient,
      },
      p2Expected: false,
    },
    degradation: stale ? [{ code: "STALE" as const }] : [],
    conclusionEvidence,
  };
}

