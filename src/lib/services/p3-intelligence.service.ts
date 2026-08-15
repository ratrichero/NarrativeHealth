import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { coins, p3ConstituentSnapshots, p3NarrativeIntelligence } from "@/db/schema";
import { P3_AVAILABILITY_STATES, type P3AvailabilityState } from "@/lib/p3/availability";
import type {
  P3ClassificationViewModel,
  P3IntelligenceViewModel,
  P3LeadershipViewModel,
  P3RotationViewModel,
  P3StageViewModel,
} from "@/lib/types/p3-intelligence";

// ===========================================================================
// READ-ONLY P3 INTELLIGENCE SERVICE
// ---------------------------------------------------------------------------
// This service exposes *immutable persisted* P3 data only. It never invokes
// P3 calculation modules, never recalculates, and never writes. UI/read paths
// must use this service (or the view-model transform) instead of calling the
// P3 kernel functions.
// ===========================================================================

export interface P3IntelligenceReadSource {
  artifact: {
    id: number;
    narrativeId: number;
    windowEnd: Date;
    periodStart: Date;
    periodEnd: Date;
    algorithmKey: string;
    algorithmVersion: string;
    calculationMode: string;
    availabilityState: string;
    breadth: string | null;
    momentum1d: string | null;
    momentum3d: string | null;
    momentum7d: string | null;
    momentum14d: string | null;
    relativeStrength1d: string | null;
    relativeStrength3d: string | null;
    relativeStrength7d: string | null;
    relativeStrength14d: string | null;
    leaderCoinId: number | null;
    leaderScore: string | null;
    regime: string | null;
    rotation: string | null;
    rotationScore: string | null;
    /** Persisted provenance JSON — carries the authoritative context.window. */
    provenance: unknown;
  };
  leaderSymbol: string | null;
  memberCount: number | null;
}

// ---------------------------------------------------------------------------
// Pure formatting helpers (unit-testable, no DB / no React)
// ---------------------------------------------------------------------------

/** Raw ratio, 3 decimals — e.g. breadth 0.14 → "0.140". */
export function formatP3Ratio(value: number): string {
  return value.toFixed(3);
}

/**
 * Momentum delta, signed 2 decimals. The persisted momentum metric is already
 * in percentage points (e.g. 14.03 → "+14.03"), so it is displayed as-is.
 */
export function formatP3Momentum(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

/** Signed raw ratio, 3 decimals — e.g. -0.011 → "-0.011". */
export function formatP3SignedRatio(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;
}

/** 0-100 score, 2 decimals — e.g. 89.29 → "89.29". */
export function formatP3Score(value: number): string {
  return value.toFixed(2);
}

const WINDOW_LABELS: Record<number, string> = { 1: "1D", 3: "3D", 7: "7D", 14: "14D" };

/** Derive the P3 window label ("1D" | "3D" | "7D" | "14D") from persisted period bounds. */
export function p3WindowLabel(periodStart: Date, periodEnd: Date): string {
  const days = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000);
  return WINDOW_LABELS[days] ?? `${days}D`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Human window-end label in UTC (e.g. "11 Aug 2026"). Computed from UTC date
 * parts so the label is stable regardless of the server timezone and of how
 * the Postgres driver parsed the (timestamp without tz) column.
 */
export function p3WindowEndLabel(windowEnd: Date): string {
  return `${windowEnd.getUTCDate()} ${MONTHS[windowEnd.getUTCMonth()]} ${windowEnd.getUTCFullYear()}`;
}

/** Coerce a persisted availability string to the known state union. */
export function normalizeAvailabilityState(raw: string | null): P3AvailabilityState {
  if (raw && (P3_AVAILABILITY_STATES as readonly string[]).includes(raw)) {
    return raw as P3AvailabilityState;
  }
  return "MISSING";
}

function parseDecimal(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function numericStage(
  raw: string | null,
  format: (value: number) => string,
  fallbackState: P3AvailabilityState
): P3StageViewModel {
  const value = parseDecimal(raw);
  if (value == null) {
    return { availabilityState: fallbackState, value: null, display: "—" };
  }
  return { availabilityState: "VALID", value, display: format(value) };
}

function classificationStage(
  classification: string | null,
  fallbackState: P3AvailabilityState
): P3ClassificationViewModel {
  if (classification == null || classification === "") {
    return { availabilityState: fallbackState, classification: null, display: "—" };
  }
  return { availabilityState: "VALID", classification, display: classification };
}

function rotationStage(
  classification: string | null,
  scoreRaw: string | null,
  fallbackState: P3AvailabilityState
): P3RotationViewModel {
  const classificationVm = classificationStage(classification, fallbackState);
  const score = parseDecimal(scoreRaw);
  return {
    availabilityState: classificationVm.availabilityState,
    classification: classificationVm.classification,
    score,
    scoreDisplay: score == null ? "—" : formatP3Score(score),
  };
}

function leadershipStage(
  coinId: number | null,
  symbol: string | null,
  scoreRaw: string | null,
  fallbackState: P3AvailabilityState
): P3LeadershipViewModel {
  const score = parseDecimal(scoreRaw);
  if (coinId == null || symbol == null || score == null) {
    return {
      availabilityState: fallbackState,
      coinId: coinId ?? null,
      symbol: symbol ?? null,
      score: score ?? null,
      scoreDisplay: "—",
    };
  }
  return { availabilityState: "VALID", coinId, symbol, score, scoreDisplay: formatP3Score(score) };
}

/**
 * Infer the artifact window label.
 *
 * 1. Authoritative source: the persisted provenance carries the declared
 *    window (`provenance.context.window`), e.g. "7D".
 * 2. Fallback: the longest persisted momentum window (an artifact can have
 *    several momentum horizons persisted; the declared window is the longest
 *    present — e.g. artifact 1 persists 1D/3D/7D momentum for a 7D window).
 * 3. Last resort: the period span (note: the stored period bounds are
 *    day-aligned and their span may exceed the window length by one day,
 *    e.g. 2026-08-03 → 2026-08-11 spans 8 days for a 7D window).
 */
export function inferP3Window(artifact: P3IntelligenceReadSource["artifact"]): string {
  const provenanceContext = (artifact.provenance as { context?: { window?: unknown } } | null)?.context;
  const provenanceWindow = provenanceContext?.window;
  if (typeof provenanceWindow === "string" && provenanceWindow !== "") {
    return provenanceWindow;
  }
  if (artifact.momentum14d != null) return "14D";
  if (artifact.momentum7d != null) return "7D";
  if (artifact.momentum3d != null) return "3D";
  if (artifact.momentum1d != null) return "1D";
  return p3WindowLabel(artifact.periodStart, artifact.periodEnd);
}

/** Pick the momentum metric matching the artifact window (1D/3D/7D/14D). */
function windowMomentum(artifact: P3IntelligenceReadSource["artifact"]): string | null {
  switch (inferP3Window(artifact)) {
    case "1D": return artifact.momentum1d;
    case "3D": return artifact.momentum3d;
    case "14D": return artifact.momentum14d;
    default: return artifact.momentum7d;
  }
}

/** Pick the relative-strength metric matching the artifact window. */
function windowRelativeStrength(artifact: P3IntelligenceReadSource["artifact"]): string | null {
  switch (inferP3Window(artifact)) {
    case "1D": return artifact.relativeStrength1d;
    case "3D": return artifact.relativeStrength3d;
    case "14D": return artifact.relativeStrength14d;
    default: return artifact.relativeStrength7d;
  }
}

// ---------------------------------------------------------------------------
// Pure transform: persisted artifact → frontend-safe view model
// ---------------------------------------------------------------------------

/**
 * Transform a persisted P3 artifact (plus its leadership/constituent summary)
 * into the frontend-safe read model. Never recalculates anything.
 */
export function toP3IntelligenceViewModel(source: P3IntelligenceReadSource): P3IntelligenceViewModel {
  const { artifact, leaderSymbol, memberCount } = source;
  const availabilityState = normalizeAvailabilityState(artifact.availabilityState);
  const fallbackState: P3AvailabilityState =
    availabilityState === "VALID" ? "MISSING" : availabilityState;

  const window = inferP3Window(artifact);

  return {
    artifactId: artifact.id,
    narrativeId: artifact.narrativeId,
    window,
    windowEnd: artifact.windowEnd.toISOString(),
    windowEndLabel: p3WindowEndLabel(artifact.windowEnd),
    calculationMode: artifact.calculationMode,
    algorithmKey: artifact.algorithmKey,
    algorithmVersion: artifact.algorithmVersion,
    availabilityState,
    regime: classificationStage(artifact.regime, fallbackState),
    rotation: rotationStage(artifact.rotation, artifact.rotationScore, fallbackState),
    breadth: numericStage(artifact.breadth, formatP3Ratio, fallbackState),
    momentum: numericStage(windowMomentum(artifact), formatP3Momentum, fallbackState),
    relativeStrength: numericStage(windowRelativeStrength(artifact), formatP3SignedRatio, fallbackState),
    leadership: leadershipStage(artifact.leaderCoinId, leaderSymbol, artifact.leaderScore, fallbackState),
    constituents: {
      count: memberCount,
      availabilityState: memberCount == null ? fallbackState : "VALID",
    },
  };
}

// ---------------------------------------------------------------------------
// Read service — queries the latest VALID persisted artifact
// ---------------------------------------------------------------------------

/**
 * Retrieve the latest VALID P3 intelligence artifact for a narrative and
 * normalize it for the UI. Returns null when no VALID artifact exists.
 *
 * Read-only: selects immutable persisted rows; never recalculation.
 */
export async function getLatestValidP3Intelligence(
  narrativeId: number
): Promise<P3IntelligenceViewModel | null> {
  const [artifact] = await db
    .select()
    .from(p3NarrativeIntelligence)
    .where(
      and(
        eq(p3NarrativeIntelligence.narrativeId, narrativeId),
        eq(p3NarrativeIntelligence.availabilityState, "VALID")
      )
    )
    .orderBy(desc(p3NarrativeIntelligence.windowEnd), desc(p3NarrativeIntelligence.id))
    .limit(1);

  if (!artifact) return null;

  let leaderSymbol: string | null = null;
  if (artifact.leaderCoinId != null) {
    const [leaderCoin] = await db
      .select({ symbol: coins.symbol })
      .from(coins)
      .where(eq(coins.id, artifact.leaderCoinId))
      .limit(1);
    leaderSymbol = leaderCoin?.symbol ?? null;
  }

  let memberCount: number | null = null;
  const [constituentSnapshot] = await db
    .select({ memberCount: p3ConstituentSnapshots.memberCount })
    .from(p3ConstituentSnapshots)
    .where(eq(p3ConstituentSnapshots.intelligenceId, artifact.id))
    .limit(1);
  memberCount = constituentSnapshot?.memberCount ?? null;

  return toP3IntelligenceViewModel({ artifact, leaderSymbol, memberCount });
}
