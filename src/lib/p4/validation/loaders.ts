import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  coinNarratives,
  coins,
  eventRisks,
  p3ConstituentSnapshotMembers,
  p3ConstituentSnapshots,
  p3NarrativeIntelligence,
} from "@/db/schema";
import {
  inferP3Window,
  toP3IntelligenceViewModel,
  type P3IntelligenceReadSource,
} from "@/lib/services/p3-intelligence.service";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { EventRisk } from "@/lib/types/event-risk";

/**
 * P4-06B as-of loaders (P4-06B execution spec §5 — frozen contract).
 *
 * READ-ONLY adapters that reconstruct the historical state as of a horizon W:
 * - artifacts with `windowEnd <= W` only (future leakage is structurally
 *   impossible: the SQL predicate bounds the query);
 * - same-identity grouping (identity of the latest row <= W), never mixed;
 * - chronological ordering (windowEnd asc, id asc);
 * - enrichment (leader symbols, constituent snapshots/members) reuses the
 *   production read-model transform `toP3IntelligenceViewModel`;
 * - P2 events "active as of W": `createdAt <= W AND (expiresAt IS NULL OR
 *   expiresAt >= W)` — the historical analogue of the production active
 *   filter (the `isActive` flag is current-state and deliberately not used
 *   for historical reconstruction);
 * - no P3/P2 kernel invocation, no writes, no P2 Decision Engine thresholds.
 *
 * These loaders live inside `src/lib/p4/validation/` and do NOT modify any
 * production service (P4-06B-IMPL boundary).
 */

type ArtifactRow = typeof p3NarrativeIntelligence.$inferSelect;

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a database)
// ---------------------------------------------------------------------------

/** Filter raw rows to `windowEnd <= W` (or all when W is null), ascending. */
export function asOfRows(rows: ArtifactRow[], upperBoundIso: string | null): ArtifactRow[] {
  const upper = upperBoundIso != null ? new Date(upperBoundIso).getTime() : Number.POSITIVE_INFINITY;
  return rows
    .filter((row) => row.windowEnd.getTime() <= upper)
    .sort((a, b) => a.windowEnd.getTime() - b.windowEnd.getTime() || a.id - b.id);
}

/**
 * P4-14 Part C identity grouping: keep only the identity group
 * (algorithmKey, algorithmVersion, calculationMode, window) that contains the
 * latest row (by windowEnd, then id). Returns [] when no rows.
 */
export function selectIdentityGroup(rows: ArtifactRow[]): ArtifactRow[] {
  if (rows.length === 0) return [];
  const groups = new Map<string, ArtifactRow[]>();
  for (const row of rows) {
    const key = `${row.algorithmKey}|${row.algorithmVersion}|${row.calculationMode}|${inferP3Window(row)}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const latest = rows[rows.length - 1];
  const latestKey = `${latest.algorithmKey}|${latest.algorithmVersion}|${latest.calculationMode}|${inferP3Window(latest)}`;
  const identityRows = groups.get(latestKey) ?? [];
  return identityRows.sort((a, b) => a.windowEnd.getTime() - b.windowEnd.getTime() || a.id - b.id);
}

// ---------------------------------------------------------------------------
// DB read path
// ---------------------------------------------------------------------------

export interface AsOfSeries {
  series: P3IntelligenceViewModel[];
  constituentsByArtifact: Record<number, number[] | null>;
}

export interface AsOfP2 {
  narrativeWideEvents: EventRisk[];
  coinLocalEvents: Array<EventRisk & { symbol?: string | null }>;
}

/** Empty P2 set (0 rows) — the honest default when the DB has no events. */
export const EMPTY_P2: AsOfP2 = { narrativeWideEvents: [], coinLocalEvents: [] };

/**
 * Load the same-identity VALID artifact series as of horizon W (or the full
 * series when W is null). Returns the frontend-safe view models (production
 * transform) plus per-artifact constituent coin ids.
 */
export async function loadArtifactSeriesAsOf(
  narrativeId: number,
  upperBoundIso: string | null
): Promise<AsOfSeries> {
  const bound = upperBoundIso != null ? new Date(upperBoundIso) : null;
  const rows = await db
    .select()
    .from(p3NarrativeIntelligence)
    .where(
      and(
        eq(p3NarrativeIntelligence.narrativeId, narrativeId),
        bound != null ? lte(p3NarrativeIntelligence.windowEnd, bound) : undefined
      )
    )
    .orderBy(asc(p3NarrativeIntelligence.windowEnd), asc(p3NarrativeIntelligence.id));

  if (rows.length === 0) return { series: [], constituentsByArtifact: {} };

  const identityRows = selectIdentityGroup(asOfRows(rows, upperBoundIso));

  // Enrichment mirrors the production history service: leader symbols +
  // constituent snapshots/members.
  const leaderCoinIds = [
    ...new Set(identityRows.map((a) => a.leaderCoinId).filter((v): v is number => v != null)),
  ];
  const leaderCoins = leaderCoinIds.length
    ? await db
        .select({ id: coins.id, symbol: coins.symbol })
        .from(coins)
        .where(inArray(coins.id, leaderCoinIds))
    : [];
  const leaderSymbolById = new Map(leaderCoins.map((c) => [c.id, c.symbol]));

  const artifactIds = identityRows.map((a) => a.id);
  const snapshots = artifactIds.length
    ? await db
        .select({
          id: p3ConstituentSnapshots.id,
          intelligenceId: p3ConstituentSnapshots.intelligenceId,
          memberCount: p3ConstituentSnapshots.memberCount,
        })
        .from(p3ConstituentSnapshots)
        .where(inArray(p3ConstituentSnapshots.intelligenceId, artifactIds))
    : [];
  const memberCountById = new Map(snapshots.map((s) => [s.intelligenceId, s.memberCount]));

  const snapshotIds = snapshots.map((s) => s.id);
  const memberRows = snapshotIds.length
    ? await db
        .select({ snapshotId: p3ConstituentSnapshotMembers.snapshotId, coinId: p3ConstituentSnapshotMembers.coinId })
        .from(p3ConstituentSnapshotMembers)
        .where(inArray(p3ConstituentSnapshotMembers.snapshotId, snapshotIds))
    : [];
  const coinIdsBySnapshot = new Map<number, number[]>();
  for (const row of memberRows) {
    const list = coinIdsBySnapshot.get(row.snapshotId) ?? [];
    list.push(row.coinId);
    coinIdsBySnapshot.set(row.snapshotId, list);
  }
  const snapshotIdByIntelligence = new Map(snapshots.map((s) => [s.intelligenceId, s.id]));

  const series: P3IntelligenceViewModel[] = identityRows.map((artifact) => {
    const source: P3IntelligenceReadSource = {
      artifact,
      leaderSymbol: artifact.leaderCoinId != null ? (leaderSymbolById.get(artifact.leaderCoinId) ?? null) : null,
      memberCount: memberCountById.get(artifact.id) ?? null,
    };
    return toP3IntelligenceViewModel(source);
  });

  const constituentsByArtifact: Record<number, number[] | null> = {};
  for (const artifact of identityRows) {
    const snapshotId = snapshotIdByIntelligence.get(artifact.id);
    constituentsByArtifact[artifact.id] =
      snapshotId != null ? (coinIdsBySnapshot.get(snapshotId) ?? []) : null;
  }

  return { series, constituentsByArtifact };
}

/** Constituent coin ids of a narrative (production membership read). */
export async function loadConstituentCoinIds(narrativeId: number): Promise<number[]> {
  const rows = await db
    .select({ coinId: coinNarratives.coinId })
    .from(coinNarratives)
    .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
    .where(and(eq(coinNarratives.narrativeId, narrativeId), eq(coins.isActive, true)));
  return rows.map((r) => r.coinId);
}

/**
 * P2 Event Risk "active as of W": narrative-wide (narrativeId = this
 * narrative) plus coin-local (narrativeId NULL, coin ∈ constituents), where
 * `createdAt <= W` and not expired as of W. `isActive` is current-state and
 * intentionally not applied (P4-06B spec §5).
 */
export async function loadP2AsOf(
  narrativeId: number,
  upperBoundIso: string,
  constituentCoinIds: number[]
): Promise<AsOfP2> {
  const wDate = upperBoundIso.slice(0, 10);
  const bound = new Date(upperBoundIso);
  const asOfConditions = [
    lte(eventRisks.createdAt, bound),
    or(isNull(eventRisks.expiresAt), gte(eventRisks.expiresAt, wDate)),
  ];

  const narrativeWideRaw = await db
    .select()
    .from(eventRisks)
    .where(and(eq(eventRisks.narrativeId, narrativeId), ...asOfConditions))
    .orderBy(asc(eventRisks.eventDate));
  const narrativeWideEvents: EventRisk[] = narrativeWideRaw.map((r) => ({
    id: r.id,
    coinId: r.coinId ?? null,
    narrativeId: r.narrativeId ?? null,
    eventType: r.eventType,
    eventDate: r.eventDate,
    riskLevel: r.riskLevel,
    riskScore: r.riskScore != null ? parseFloat(r.riskScore) : null,
    title: r.title,
    description: r.description ?? null,
    sourceUrl: r.sourceUrl ?? null,
    isActive: r.isActive,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  }));

  let coinLocalRows: Array<EventRisk & { symbol?: string | null }> = [];
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
      .where(and(isNull(eventRisks.narrativeId), inArray(eventRisks.coinId, constituentCoinIds), ...asOfConditions));
    coinLocalRows = rows.map((r) => ({
      id: r.id,
      coinId: r.coinId ?? null,
      narrativeId: r.narrativeId ?? null,
      eventType: r.eventType,
      eventDate: r.eventDate,
      riskLevel: r.riskLevel,
      riskScore: r.riskScore != null ? parseFloat(r.riskScore) : null,
      title: r.title,
      description: r.description ?? null,
      sourceUrl: r.sourceUrl ?? null,
      isActive: r.isActive,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      symbol: r.symbol,
    }));
  }

  return { narrativeWideEvents, coinLocalEvents: coinLocalRows };
}
