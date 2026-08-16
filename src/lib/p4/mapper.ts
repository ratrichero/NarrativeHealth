import type {
  P4EvidenceReference,
  P4EvidenceStatus,
  P4EvidenceValue,
  P4InterpretationRole,
  P4Move,
} from "./types";
import { evidenceIdentityKey } from "./explanation/evidence";
import { moveFromTrendState } from "./availability";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type {
  P3IntelligenceHistoryViewModel,
  P3TrendStep,
} from "@/lib/types/p3-intelligence-history";
import type { EventRisk } from "@/lib/types/event-risk";

/**
 * P4 read-model mapper (P4-05A).
 *
 * Pure transforms: persisted P3 view models (already frontend-safe read models
 * built by the P3 read services) → P4 evidence references + display values.
 * This module performs NO calculation and NO interpretation: it only converts
 * persisted states into the P4 evidence vocabulary. Display values are
 * resolved from the existing read-model display fields (P4-MASTER §25 —
 * Alternative B; `humanValue` was NOT added to EvidenceReference).
 *
 * Reference fields are named to match the P4-04 engine's template inputs
 * (`trend.overall`, `regimeMove`, `regime.previous`, `leadership.previous.symbol`, ...).
 */

/** Canonical artifact identity composite (P4-02 §7 — same identity contract). */
export function artifactIdentityOf(vm: P3IntelligenceViewModel): string {
  return `${vm.narrativeId}|${vm.algorithmKey}|${vm.algorithmVersion}|${vm.calculationMode}|${vm.window}`;
}

// ---------------------------------------------------------------------------
// Reference / value builders
// ---------------------------------------------------------------------------

interface BuiltRef {
  ref: P4EvidenceReference;
  value: P4EvidenceValue;
}

function buildRef(input: {
  sourceLayer: P4EvidenceReference["sourceLayer"];
  sourceType: string;
  sourceId: string;
  artifactIdentity: string | null;
  narrativeId: number;
  windowOrDate: string;
  field: string;
  status: P4EvidenceStatus;
  role: P4InterpretationRole;
  value: P4EvidenceValue;
}): BuiltRef {
  const ref: P4EvidenceReference = {
    sourceLayer: input.sourceLayer,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    artifactIdentity: input.artifactIdentity,
    narrativeIdentity: String(input.narrativeId),
    windowOrDate: input.windowOrDate,
    field: input.field,
    status: input.status,
    interpretationRole: input.role,
  };
  return { ref, value: input.value };
}

/** Move ref for a frozen step delta — VALID when determinate, UNAVAILABLE otherwise. */
function moveRef(input: {
  identity: string;
  narrativeId: number;
  windowEnd: string;
  field: string;
  move: P4Move;
  clause: string;
  phrase: string;
  numericValue?: number | null;
}): BuiltRef {
  return buildRef({
    sourceLayer: "P3",
    sourceType: "p3_history_step",
    sourceId: input.windowEnd,
    artifactIdentity: input.identity,
    narrativeId: input.narrativeId,
    windowOrDate: input.windowEnd,
    field: input.field,
    status: input.move === "UNKNOWN" ? "UNAVAILABLE" : "VALID",
    role: input.field === "leadershipScoreMove" ? "contextual" : "primary",
    value: {
      clause: input.clause,
      phrase: input.phrase,
      display: input.move,
      numericValue: input.numericValue ?? null,
    },
  });
}

/** Trend classification ref (step.previous / step.current placeholders). */
function classificationRef(input: {
  identity: string;
  narrativeId: number;
  windowEnd: string;
  field: string;
  classification: string | null;
  clause: string;
  phrase: string;
  role: P4InterpretationRole;
}): BuiltRef {
  return buildRef({
    sourceLayer: "P3",
    sourceType: "p3_history_step",
    sourceId: input.windowEnd,
    artifactIdentity: input.identity,
    narrativeId: input.narrativeId,
    windowOrDate: input.windowEnd,
    field: input.field,
    status: input.classification == null || input.classification === "" ? "UNAVAILABLE" : "VALID",
    role: input.role,
    value: {
      clause: input.clause,
      phrase: input.phrase,
      display: input.classification ?? "—",
    },
  });
}

/** Numeric delta ref (e.g. rotationScore.delta) for template placeholders. */
function deltaRef(input: {
  identity: string;
  narrativeId: number;
  windowEnd: string;
  field: string;
  delta: number | null;
  deltaDisplay: string;
  clause: string;
  phrase: string;
}): BuiltRef {
  return buildRef({
    sourceLayer: "P3",
    sourceType: "p3_history_step",
    sourceId: input.windowEnd,
    artifactIdentity: input.identity,
    narrativeId: input.narrativeId,
    windowOrDate: input.windowEnd,
    field: input.field,
    status: input.delta == null ? "UNAVAILABLE" : "VALID",
    role: "contextual",
    value: {
      clause: input.clause,
      phrase: input.phrase,
      display: input.deltaDisplay,
      numericValue: input.delta,
    },
  });
}

/** Move phrase/clause vocabulary — frozen semantic labels, no invented numbers. */
function moveText(field: string, move: P4Move): { clause: string; phrase: string } {
  const label = (name: string, positive: string, negative: string, neutral: string): { clause: string; phrase: string } => {
    if (move === "POSITIVE") return { clause: `${name} is ${positive}`, phrase: `${positive} ${name.toLowerCase()}` };
    if (move === "NEGATIVE") return { clause: `${name} is ${negative}`, phrase: `${negative} ${name.toLowerCase()}` };
    if (move === "NEUTRAL") return { clause: `${name} is ${neutral}`, phrase: `${neutral} ${name.toLowerCase()}` };
    return { clause: `${name} direction is unavailable`, phrase: `unavailable ${name.toLowerCase()}` };
  };
  switch (field) {
    case "regimeMove":
      return label("Regime", "improving", "weakening", "stable");
    case "rotationScoreMove":
      return label("Rotation", "accelerating", "decelerating", "stable");
    case "momentumMove":
      return label("Momentum", "positive", "negative", "flat");
    case "breadthMove":
      return label("Breadth", "increasing", "narrowing", "flat");
    case "relativeStrengthMove":
      return label("Relative strength", "improving", "deteriorating", "flat");
    case "leadershipScoreMove":
      return label("Leader score", "rising", "falling", "unchanged");
    default:
      return { clause: `${field} is ${move}`, phrase: `${field} ${move}` };
  }
}

/** Human-readable move word for clauses (POSITIVE → "improving", etc.). */
function moveWord(move: P4Move): string {
  switch (move) {
    case "POSITIVE":
      return "improving";
    case "NEGATIVE":
      return "deteriorating";
    case "NEUTRAL":
      return "stable";
    default:
      return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// Semantic moves over the latest step (P4-03 §2.3 — frozen deltas/ranks only)
// ---------------------------------------------------------------------------

/** Derive the six semantic moves from the frozen latest step states (P4-03 §2.3). */
export function computeMoves(step: P3TrendStep | null): {
  regime: P4Move;
  rotationScore: P4Move;
  momentum: P4Move;
  breadth: P4Move;
  relativeStrength: P4Move;
  leadershipScore: P4Move;
} {
  if (!step) {
    return {
      regime: "UNKNOWN",
      rotationScore: "UNKNOWN",
      momentum: "UNKNOWN",
      breadth: "UNKNOWN",
      relativeStrength: "UNKNOWN",
      leadershipScore: "UNKNOWN",
    };
  }
  return {
    regime: moveFromTrendState(step.regime.state),
    rotationScore: moveFromTrendState(step.rotationScore.state),
    momentum: moveFromTrendState(step.momentum.state),
    breadth: moveFromTrendState(step.breadth.state),
    relativeStrength: moveFromTrendState(step.relativeStrength.state),
    leadershipScore: moveFromTrendState(step.leadership.state),
  };
}

// ---------------------------------------------------------------------------
// Current artifact refs (A9–A15 — what is true now)
// ---------------------------------------------------------------------------

/** Refs + values for the latest artifact's persisted stages (contextual role). */
export function mapCurrentArtifact(current: P3IntelligenceViewModel): BuiltRef[] {
  const built: BuiltRef[] = [];
  const narrativeId = current.narrativeId;
  const windowEnd = current.windowEnd;
  const identity = artifactIdentityOf(current);
  const id = String(current.artifactId);

  const base = {
    sourceLayer: "P3" as const,
    sourceType: "p3_artifact",
    sourceId: id,
    artifactIdentity: identity,
    narrativeId,
    windowOrDate: windowEnd,
    role: "contextual" as P4InterpretationRole,
  };

  // Regime (classification stage).
  built.push(
    buildRef({
      ...base,
      field: "regime",
      status: current.regime.availabilityState === "VALID" ? "VALID" : "UNAVAILABLE",
      value: {
        clause: current.regime.classification
          ? `Regime is ${current.regime.classification}`
          : "Regime is unavailable",
        phrase: current.regime.classification ? `${current.regime.classification} regime` : "unavailable regime",
        display: current.regime.display,
      },
    })
  );

  // Rotation (classification + score — PARTIAL when score detail is missing).
  const rotationValid = current.rotation.availabilityState === "VALID";
  const rotationPartial = rotationValid && current.rotation.score == null;
  built.push(
    buildRef({
      ...base,
      field: "rotation",
      status: rotationPartial ? "PARTIAL" : rotationValid ? "VALID" : "UNAVAILABLE",
      value: {
        clause:
          rotationValid && current.rotation.classification
            ? current.rotation.score == null
              ? `Rotation is ${current.rotation.classification}`
              : `Rotation is ${current.rotation.classification} (score ${current.rotation.scoreDisplay})`
            : "Rotation is unavailable",
        phrase: current.rotation.classification
          ? `${current.rotation.classification} rotation`
          : "unavailable rotation",
        display: current.rotation.classification ?? current.rotation.scoreDisplay,
        numericValue: current.rotation.score,
      },
    })
  );

  // Breadth (numeric stage).
  built.push(
    buildRef({
      ...base,
      field: "breadth",
      status: current.breadth.availabilityState === "VALID" ? "VALID" : "UNAVAILABLE",
      value: {
        clause: current.breadth.value != null ? `Breadth is ${current.breadth.display}` : "Breadth is unavailable",
        phrase: current.breadth.value != null ? `breadth ${current.breadth.display}` : "unavailable breadth",
        display: current.breadth.display,
        numericValue: current.breadth.value,
      },
    })
  );

  // Momentum (numeric stage).
  built.push(
    buildRef({
      ...base,
      field: "momentum",
      status: current.momentum.availabilityState === "VALID" ? "VALID" : "UNAVAILABLE",
      value: {
        clause: current.momentum.value != null ? `Momentum is ${current.momentum.display}` : "Momentum is unavailable",
        phrase: current.momentum.value != null ? `momentum ${current.momentum.display}` : "unavailable momentum",
        display: current.momentum.display,
        numericValue: current.momentum.value,
      },
    })
  );

  // Relative strength (numeric stage).
  built.push(
    buildRef({
      ...base,
      field: "relativeStrength",
      status: current.relativeStrength.availabilityState === "VALID" ? "VALID" : "UNAVAILABLE",
      value: {
        clause:
          current.relativeStrength.value != null
            ? `Relative strength is ${current.relativeStrength.display}`
            : "Relative strength is unavailable",
        phrase:
          current.relativeStrength.value != null
            ? `relative strength ${current.relativeStrength.display}`
            : "unavailable relative strength",
        display: current.relativeStrength.display,
        numericValue: current.relativeStrength.value,
      },
    })
  );

  // Leadership (PARTIAL when the score is present but symbol/coin identity is missing).
  const leadershipValid = current.leadership.availabilityState === "VALID";
  const leadershipPartial = leadershipValid && current.leadership.symbol == null;
  built.push(
    buildRef({
      ...base,
      field: "leadership",
      status: leadershipPartial ? "PARTIAL" : leadershipValid ? "VALID" : "UNAVAILABLE",
      value: {
        clause:
          leadershipValid && current.leadership.symbol != null && current.leadership.score != null
            ? `Leader is ${current.leadership.symbol} (score ${current.leadership.scoreDisplay})`
            : leadershipValid && current.leadership.score != null
              ? `Leader score is ${current.leadership.scoreDisplay}`
              : "Leadership is unavailable",
        phrase: current.leadership.symbol != null ? `leader ${current.leadership.symbol}` : "unavailable leadership",
        display: current.leadership.symbol ?? current.leadership.scoreDisplay,
        numericValue: current.leadership.score,
      },
    })
  );

  // Constituents (membership count).
  const constituentsValid = current.constituents.availabilityState === "VALID";
  built.push(
    buildRef({
      ...base,
      field: "constituents",
      status: constituentsValid ? "VALID" : "UNAVAILABLE",
      value: {
        clause:
          current.constituents.count != null
            ? `Narrative spans ${current.constituents.count} constituents`
            : "Constituent coverage is unavailable",
        phrase:
          current.constituents.count != null
            ? `constituent count ${current.constituents.count}`
            : "unavailable constituents",
        display: current.constituents.count != null ? String(current.constituents.count) : "—",
        numericValue: current.constituents.count,
      },
    })
  );

  return built;
}

// ---------------------------------------------------------------------------
// Latest-step refs (B5/B6 — how it changed, frozen deltas only)
// ---------------------------------------------------------------------------

/** Refs + values for the latest step: the six moves + template placeholders. */
export function mapLatestStep(
  step: P3TrendStep,
  narrativeId: number,
  windowEnd: string,
  identity: string
): BuiltRef[] {
  const built: BuiltRef[] = [];
  const moves = computeMoves(step);

  const moveFields: Array<{ field: string; move: P4Move; numeric?: number | null }> = [
    { field: "regimeMove", move: moves.regime },
    { field: "rotationScoreMove", move: moves.rotationScore, numeric: step.rotationScore.delta },
    { field: "momentumMove", move: moves.momentum, numeric: step.momentum.delta },
    { field: "breadthMove", move: moves.breadth, numeric: step.breadth.delta },
    { field: "relativeStrengthMove", move: moves.relativeStrength, numeric: step.relativeStrength.delta },
    { field: "leadershipScoreMove", move: moves.leadershipScore, numeric: step.leadership.scoreDelta },
  ];

  for (const { field, move, numeric } of moveFields) {
    const text = moveText(field, move);
    built.push(
      moveRef({
        identity,
        narrativeId,
        windowEnd,
        field,
        move,
        clause: text.clause,
        phrase: text.phrase,
        numericValue: numeric ?? null,
      })
    );
  }

  // Template placeholders (P4-04 §10 — regime/rotation/leadership transitions).
  built.push(
    classificationRef({
      identity,
      narrativeId,
      windowEnd,
      field: "regime.previous",
      classification: step.regime.previous,
      clause: step.regime.previous ? `Regime was ${step.regime.previous}` : "Previous regime is unavailable",
      phrase: step.regime.previous ? `regime ${step.regime.previous}` : "unavailable previous regime",
      role: "primary",
    }),
    classificationRef({
      identity,
      narrativeId,
      windowEnd,
      field: "regime.current",
      classification: step.regime.current,
      clause: step.regime.current ? `Regime is ${step.regime.current}` : "Current regime is unavailable",
      phrase: step.regime.current ? `regime ${step.regime.current}` : "unavailable current regime",
      role: "primary",
    }),
    classificationRef({
      identity,
      narrativeId,
      windowEnd,
      field: "rotation.previous",
      classification: step.rotation.previous,
      clause: step.rotation.previous ? `Rotation was ${step.rotation.previous}` : "Previous rotation is unavailable",
      phrase: step.rotation.previous ? `rotation ${step.rotation.previous}` : "unavailable previous rotation",
      role: "primary",
    }),
    classificationRef({
      identity,
      narrativeId,
      windowEnd,
      field: "rotation.current",
      classification: step.rotation.current,
      clause: step.rotation.current ? `Rotation is ${step.rotation.current}` : "Current rotation is unavailable",
      phrase: step.rotation.current ? `rotation ${step.rotation.current}` : "unavailable current rotation",
      role: "primary",
    }),
    deltaRef({
      identity,
      narrativeId,
      windowEnd,
      field: "rotationScore.delta",
      delta: step.rotationScore.delta,
      deltaDisplay: step.rotationScore.deltaDisplay,
      clause: `Rotation score moved ${step.rotationScore.deltaDisplay}`,
      phrase: `rotation score ${step.rotationScore.deltaDisplay}`,
    }),
    buildRef({
      sourceLayer: "P3",
      sourceType: "p3_history_step",
      sourceId: windowEnd,
      artifactIdentity: identity,
      narrativeId,
      windowOrDate: windowEnd,
      field: "leadership.previous.symbol",
      status: step.leadership.previous?.symbol != null ? "VALID" : "UNAVAILABLE",
      role: "primary",
      value: {
        clause: step.leadership.previous?.symbol
          ? `Previous leader was ${step.leadership.previous.symbol}`
          : "Previous leader is unavailable",
        phrase: step.leadership.previous?.symbol
          ? `previous leader ${step.leadership.previous.symbol}`
          : "unavailable previous leader",
        display: step.leadership.previous?.symbol ?? "—",
      },
    }),
    buildRef({
      sourceLayer: "P3",
      sourceType: "p3_history_step",
      sourceId: windowEnd,
      artifactIdentity: identity,
      narrativeId,
      windowOrDate: windowEnd,
      field: "leadership.current.symbol",
      status: step.leadership.current?.symbol != null ? "VALID" : "UNAVAILABLE",
      role: "primary",
      value: {
        clause: step.leadership.current?.symbol
          ? `Leader is ${step.leadership.current.symbol}`
          : "Current leader is unavailable",
        phrase: step.leadership.current?.symbol ? `leader ${step.leadership.current.symbol}` : "unavailable leader",
        display: step.leadership.current?.symbol ?? "—",
      },
    })
  );

  // Step-state phrase refs for regime/rotation changes (clause from the frozen state).
  if (moves.regime !== "NEUTRAL" && moves.regime !== "UNKNOWN") {
    built.push(
      buildRef({
        sourceLayer: "P3",
        sourceType: "p3_history_step",
        sourceId: windowEnd,
        artifactIdentity: identity,
        narrativeId,
        windowOrDate: windowEnd,
        field: "regimeChange",
        status: "VALID",
        role: "primary",
        value: {
          clause: `Regime ${moveWord(moves.regime)} from ${step.regime.previous ?? "unavailable"} to ${step.regime.current ?? "unavailable"}`,
          phrase: `regime ${moveWord(moves.regime)}`,
          display: step.regime.current ?? "—",
        },
      })
    );
  }
  if (moves.rotationScore !== "NEUTRAL" && moves.rotationScore !== "UNKNOWN") {
    built.push(
      buildRef({
        sourceLayer: "P3",
        sourceType: "p3_history_step",
        sourceId: windowEnd,
        artifactIdentity: identity,
        narrativeId,
        windowOrDate: windowEnd,
        field: "rotationChange",
        status: "VALID",
        role: "primary",
        value: {
          clause: `Rotation ${moveWord(moves.rotationScore)} from ${step.rotation.previous ?? "unavailable"} to ${step.rotation.current ?? "unavailable"}`,
          phrase: `rotation ${moveWord(moves.rotationScore)}`,
          display: step.rotation.current ?? "—",
        },
      })
    );
  }

  return built;
}

// ---------------------------------------------------------------------------
// History refs — frozen trend + sufficiency (context-only)
// ---------------------------------------------------------------------------

/** Refs + values for the frozen historical trend and data sufficiency. */
export function mapHistory(history: P3IntelligenceHistoryViewModel, identity: string): BuiltRef[] {
  const built: BuiltRef[] = [];
  const narrativeId = history.identity.narrativeId;
  const windowEnd = history.current?.windowEnd ?? "";

  built.push(
    buildRef({
      sourceLayer: "P3",
      sourceType: "p3_history",
      sourceId: history.current?.artifactId != null ? String(history.current.artifactId) : "",
      artifactIdentity: identity,
      narrativeId,
      windowOrDate: windowEnd,
      field: "trend.overall",
      status: history.trend.overall === "UNKNOWN" ? "UNAVAILABLE" : "VALID",
      role: "primary",
      value: {
        clause: `Overall trend is ${history.trend.overall}`,
        phrase: `${history.trend.overall} overall trend`,
        display: history.trend.overall,
      },
    })
  );

  return built;
}

// ---------------------------------------------------------------------------
// P2 Event Risk refs (P4-03 §10 — secondary evidence, provenance preserved)
// ---------------------------------------------------------------------------

export interface P2RefInput {
  event: EventRisk;
  narrativeId: number;
  kind: "coin-local" | "multi-coin" | "narrative-wide";
  symbols?: string[];
}

/** Refs + values for approved P2 event risk evidence (source = P2_EVENT_RISK). */
export function mapP2Event(input: P2RefInput): BuiltRef {
  const { event, narrativeId, kind, symbols } = input;
  const riskLevel = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(event.riskLevel)
    ? (event.riskLevel as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")
    : undefined;
  const scope = {
    kind,
    ...(symbols && symbols.length > 0 ? { symbols } : {}),
    ...(riskLevel ? { riskLevel } : {}),
  };
  return buildRef({
    sourceLayer: "P2",
    sourceType: "P2_EVENT_RISK",
    sourceId: String(event.id),
    artifactIdentity: null,
    narrativeId,
    windowOrDate: event.eventDate,
    field: "p2.event",
    status: "VALID",
    role: "contextual",
    value: {
      clause: `Active ${event.eventType} event: ${event.title} (${event.riskLevel})`,
      phrase: `${event.riskLevel} ${event.eventType} event risk`,
      display: event.title,
      scope,
    },
  });
}

// ---------------------------------------------------------------------------
// Combined mapping — assembly refs/values + identity keys
// ---------------------------------------------------------------------------

export interface MappedEvidence {
  refs: P4EvidenceReference[];
  values: Record<string, P4EvidenceValue>;
  /** Identity key per emitted reference (signal.evidenceKeys contract). */
  keysByField: Record<string, string[]>;
}

/**
 * Compose all evidence refs/values for an assembly. Deduplicated by full
 * identity key; `keysByField` exposes the first key per reference field so
 * interpretation can build signal evidence-key lists deterministically.
 */
export function mapEvidence(input: {
  current: P3IntelligenceViewModel;
  history: P3IntelligenceHistoryViewModel;
  latestStep: P3TrendStep | null;
  p2Events: P2RefInput[];
}): MappedEvidence {
  const built: BuiltRef[] = [
    ...mapCurrentArtifact(input.current),
    ...(input.latestStep
      ? mapLatestStep(input.latestStep, input.current.narrativeId, input.current.windowEnd, artifactIdentityOf(input.current))
      : []),
    ...mapHistory(input.history, artifactIdentityOf(input.current)),
    ...input.p2Events.map((p2) => mapP2Event(p2)),
  ];

  const refs: P4EvidenceReference[] = [];
  const values: Record<string, P4EvidenceValue> = {};
  const keysByField: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const { ref, value } of built) {
    const key = evidenceIdentityKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
    values[key] = value;
    const fields = keysByField[ref.field] ?? [];
    fields.push(key);
    keysByField[ref.field] = fields;
  }
  return { refs, values, keysByField };
}
