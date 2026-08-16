import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { coinNarratives, coins, eventRisks } from "@/db/schema";
import { getLatestValidP3Intelligence } from "@/lib/services/p3-intelligence.service";
import { getP3IntelligenceHistory } from "@/lib/services/p3-intelligence-history.service";
import { eventRiskService } from "@/lib/services/event-risk.service";
import type { EventRisk } from "@/lib/types/event-risk";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type {
  P3IntelligenceHistoryViewModel,
  P3TrendState,
  P3TrendStep,
} from "@/lib/types/p3-intelligence-history";
import type {
  P4EvidenceReference,
  P4EvidenceValue,
  P4Moves,
} from "./types";
import { artifactIdentityOf, computeMoves, mapEvidence, type P2RefInput } from "./mapper";
import { P4ServiceError, p4IdentityError, p4LoadError } from "./errors";

/**
 * P4 evidence assembler (P4-05A).
 *
 * Loads persisted evidence (via the existing P3 read services — never the P3
 * kernel) + approved P2 Event Risk, validates identity compatibility (P4-02
 * §7), derives the semantic moves (P4-03 §2.3) and produces the P4Assembly
 * consumed by the interpretation engine. Read-time derivation only: no
 * writes, no cache, no persistence.
 *
 * `assembleP4Evidence` is pure (fixture-testable); `loadP4Evidence` performs
 * the read-only database queries.
 */

// ---------------------------------------------------------------------------
// P2 Event Risk assembly (P4-03 §10 — scope classification)
// ---------------------------------------------------------------------------

/** P2 risk-level ordering (P2 qualitative semantics only — NOT P4 thresholds). */
const RISK_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export interface P2AssemblyEvidence {
  /** Active events with narrativeId = this narrative. */
  narrativeWideEvents: EventRisk[];
  /** Active coin-local events for narrative constituents (narrativeId null). */
  coinLocalEvents: Array<EventRisk & { symbol?: string | null }>;
  /** Frozen scope classification (P4-03 §10). */
  scope: "narrative-wide" | "multi-coin" | "coin-local" | "none";
  /** Max qualitative risk level across scope-relevant events, or null. */
  maxRiskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  /** Constituent symbols carrying coin-local events. */
  symbols: string[];
}

/** Classify P2 scope deterministically (P4-03 §10 scope table). */
export function classifyP2(input: {
  narrativeWideEvents: EventRisk[];
  coinLocalEvents: Array<EventRisk & { symbol?: string | null }>;
}): P2AssemblyEvidence {
  const { narrativeWideEvents, coinLocalEvents } = input;

  const relevant = [...narrativeWideEvents, ...coinLocalEvents];
  let maxRiskLevel: P2AssemblyEvidence["maxRiskLevel"] = null;
  for (const event of relevant) {
    const rank = RISK_RANK[event.riskLevel];
    if (rank == null) continue;
    if (maxRiskLevel == null || rank > RISK_RANK[maxRiskLevel]) {
      maxRiskLevel = event.riskLevel as NonNullable<P2AssemblyEvidence["maxRiskLevel"]>;
    }
  }

  const affectedSymbols = [...new Set(coinLocalEvents.map((e) => e.symbol).filter((s): s is string => s != null))];
  const affectedCoinCount = new Set(coinLocalEvents.map((e) => e.coinId).filter((c): c is number => c != null)).size;

  const scope: P2AssemblyEvidence["scope"] = narrativeWideEvents.length > 0
    ? "narrative-wide"
    : affectedCoinCount >= 2
      ? "multi-coin"
      : affectedCoinCount >= 1
        ? "coin-local"
        : "none";

  return { narrativeWideEvents, coinLocalEvents, scope, maxRiskLevel, symbols: affectedSymbols };
}

// ---------------------------------------------------------------------------
// P4Assembly
// ---------------------------------------------------------------------------

export interface P4Assembly {
  narrativeId: number;
  current: P3IntelligenceViewModel;
  history: P3IntelligenceHistoryViewModel;
  latestStep: P3TrendStep | null;
  /** Semantic moves over the latest step (P4-03 §2.3). */
  moves: P4Moves;
  /** Frozen P3-18 overall trend (context-only). */
  trendOverall: P3TrendState;
  p2: P2AssemblyEvidence;
  refs: P4EvidenceReference[];
  values: Record<string, P4EvidenceValue>;
  /** Identity key per evidence field (signal.evidenceKeys contract). */
  keysByField: Record<string, string[]>;
  identity: {
    narrativeId: number;
    window: string;
    algorithmKey: string;
    algorithmVersion: string;
    calculationMode: string;
  };
  identityKey: string;
}

export type P4AssemblyResult =
  | { ok: true; assembly: P4Assembly }
  | { ok: false; reason: "NO_EVIDENCE" | "IDENTITY_MISMATCH"; detail: string };

/**
 * Identity compatibility (P4-02 §7 — frozen): the latest VALID artifact and
 * the historical series must agree on narrative, window, algorithm, version
 * and mode. Returns null when compatible, else a human-readable detail.
 */
export function validateIdentity(
  current: P3IntelligenceViewModel,
  history: P3IntelligenceHistoryViewModel
): string | null {
  const identity = history.identity;
  const checks: Array<[string, boolean]> = [
    ["narrativeId", current.narrativeId === identity.narrativeId],
    ["window", current.window === identity.window],
    ["algorithmKey", current.algorithmKey === identity.algorithmKey],
    ["algorithmVersion", current.algorithmVersion === identity.algorithmVersion],
    ["calculationMode", current.calculationMode === identity.calculationMode],
    ["latest artifact", history.current == null || history.current.artifactId === current.artifactId],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length === 0) return null;
  return `artifact/history identity mismatch on: ${failed.join(", ")}`;
}

/** Pure assembly — build the P4Assembly from loaded persisted evidence. */
export function assembleP4Evidence(input: {
  current: P3IntelligenceViewModel | null;
  history: P3IntelligenceHistoryViewModel | null;
  p2: P2AssemblyEvidence;
}): P4AssemblyResult {
  const { current, history, p2 } = input;

  if (current == null || history == null) {
    return {
      ok: false,
      reason: "NO_EVIDENCE",
      detail: current == null ? "No VALID P3 artifact" : "No P3 historical series",
    };
  }

  const identityDetail = validateIdentity(current, history);
  if (identityDetail != null) {
    return { ok: false, reason: "IDENTITY_MISMATCH", detail: identityDetail };
  }

  const latestStep = history.steps.length > 0 ? history.steps[history.steps.length - 1] : null;
  const moves = computeMoves(latestStep);

  const p2Refs: P2RefInput[] = [];
  for (const event of p2.narrativeWideEvents) {
    p2Refs.push({ event, narrativeId: current.narrativeId, kind: "narrative-wide" });
  }
  for (const event of p2.coinLocalEvents) {
    p2Refs.push({
      event,
      narrativeId: current.narrativeId,
      kind: p2.scope === "multi-coin" ? "multi-coin" : "coin-local",
      ...(p2.scope === "multi-coin"
        ? { symbols: p2.symbols }
        : event.symbol
          ? { symbols: [event.symbol] }
          : {}),
    });
  }

  const mapped = mapEvidence({
    current,
    history,
    latestStep,
    p2Events: p2Refs,
  });

  return {
    ok: true,
    assembly: {
      narrativeId: current.narrativeId,
      current,
      history,
      latestStep,
      moves,
      trendOverall: history.trend.overall,
      p2,
      refs: mapped.refs,
      values: mapped.values,
      keysByField: mapped.keysByField,
      identity: {
        narrativeId: current.narrativeId,
        window: current.window,
        algorithmKey: current.algorithmKey,
        algorithmVersion: current.algorithmVersion,
        calculationMode: current.calculationMode,
      },
      identityKey: artifactIdentityOf(current),
    },
  };
}

// ---------------------------------------------------------------------------
// Read-only loader (existing services + direct P2 queries)
// ---------------------------------------------------------------------------

/**
 * Load persisted evidence for a narrative. Read-only; P2 event risk rows are
 * loaded with the same active/not-expired filter as `EventRiskService`.
 * Any database failure propagates as a typed `P4ServiceError` so the service
 * boundary can degrade to null (failure isolation, P4-02 §9).
 */
export async function loadP4Evidence(narrativeId: number): Promise<P4AssemblyResult> {
  let current: P3IntelligenceViewModel | null;
  let history: P3IntelligenceHistoryViewModel | null;
  try {
    [current, history] = await Promise.all([
      getLatestValidP3Intelligence(narrativeId),
      getP3IntelligenceHistory(narrativeId),
    ]);
  } catch (cause) {
    throw p4LoadError(cause);
  }

  let narrativeWideEvents: EventRisk[] = [];
  let constituentCoinIds: number[] = [];
  let coinLocalEvents: Array<EventRisk & { symbol?: string | null }> = [];
  try {
    narrativeWideEvents = await eventRiskService.getActiveEvents(undefined, narrativeId);

    const constituents = await db
      .select({ coinId: coinNarratives.coinId, symbol: coins.symbol })
      .from(coinNarratives)
      .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
      .where(and(eq(coinNarratives.narrativeId, narrativeId), eq(coins.isActive, true)));
    constituentCoinIds = constituents.map((c) => c.coinId);

    const today = new Date().toISOString().split("T")[0];
    if (constituentCoinIds.length > 0) {
      const rows = await db
        .select({
          id: eventRisks.id,
          coinId: eventRisks.coinId,
          narrativeId: eventRisks.narrativeId,
          eventType: eventRisks.eventType,
          eventDate: eventRisks.eventDate,
          riskLevel: eventRisks.riskLevel,
          riskScore: eventRisks.riskScore,
          title: eventRisks.title,
          description: eventRisks.description,
          sourceUrl: eventRisks.sourceUrl,
          isActive: eventRisks.isActive,
          createdAt: eventRisks.createdAt,
          expiresAt: eventRisks.expiresAt,
          symbol: coins.symbol,
        })
        .from(eventRisks)
        .innerJoin(coins, eq(coins.id, eventRisks.coinId))
        .where(
          and(
            eq(eventRisks.isActive, true),
            isNull(eventRisks.narrativeId),
            inArray(eventRisks.coinId, constituentCoinIds),
            or(isNull(eventRisks.expiresAt), gte(eventRisks.expiresAt, today))
          )
        );
      coinLocalEvents = rows.map((row) => ({
        id: row.id,
        coinId: row.coinId ?? null,
        narrativeId: row.narrativeId ?? null,
        eventType: row.eventType,
        eventDate: row.eventDate,
        riskLevel: row.riskLevel,
        riskScore: row.riskScore != null ? parseFloat(row.riskScore) : null,
        title: row.title,
        description: row.description,
        sourceUrl: row.sourceUrl,
        isActive: row.isActive,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        symbol: row.symbol,
      }));
    }
  } catch (cause) {
    throw p4LoadError(cause);
  }

  const p2 = classifyP2({ narrativeWideEvents, coinLocalEvents });
  return assembleP4Evidence({ current, history, p2 });
}
