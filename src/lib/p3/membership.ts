import { createHash } from "node:crypto";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  narrativeMembershipCoverage,
  narrativeMembershipEvents,
  narrativeMembershipSnapshotMembers,
  narrativeMembershipSnapshots,
  p3HistoricalCorrections,
  p3NarrativeIntelligence,
} from "@/db/schema";

export type P3MembershipAvailability =
  | "AVAILABLE"
  | "NO_SNAPSHOT"
  | "PARTIAL_HISTORY"
  | "INVALID_SNAPSHOT";

export interface P3MembershipConstituent {
  coinId: number;
  isPrimary: boolean;
  membershipState: "ELIGIBLE";
  sourceEventId: number | null;
}

export interface P3MembershipResolution {
  narrativeId: number;
  windowEnd: Date;
  snapshotId: number | null;
  snapshotRevision: number | null;
  constituents: readonly P3MembershipConstituent[];
  source: "membership_snapshot" | "membership_event_ledger" | null;
  memberDigest: string | null;
  availability: P3MembershipAvailability;
  reason?: string;
}

interface ResolvedMember {
  coinId: number;
  isPrimary: boolean;
  sourceEventId: number;
}

export interface P3MembershipEventForResolution {
  id: number;
  coinId: number;
  eventType: string;
  isPrimary: boolean | null;
  effectiveAt: Date;
}

export function resolveMembershipEventsAt(
  events: readonly P3MembershipEventForResolution[],
  windowEnd: Date,
): { availability: P3MembershipAvailability; members: readonly ResolvedMember[]; reason?: string } {
  const state = new Map<number, ResolvedMember>();
  const orderedEvents = events
    .filter((event) => event.effectiveAt.getTime() <= windowEnd.getTime())
    .slice()
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime() || a.id - b.id);

  for (const event of orderedEvents) {
    if (event.eventType === "ADDED") {
      state.set(event.coinId, {
        coinId: event.coinId,
        isPrimary: event.isPrimary ?? false,
        sourceEventId: event.id,
      });
    } else if (event.eventType === "REMOVED") {
      state.delete(event.coinId);
    } else if (event.eventType === "PRIMARY_SET") {
      const current = state.get(event.coinId);
      if (!current || event.isPrimary == null) {
        return {
          availability: "PARTIAL_HISTORY",
          members: [],
          reason: `Membership history has an invalid PRIMARY_SET event for coin ${event.coinId}`,
        };
      }
      state.set(event.coinId, { ...current, isPrimary: event.isPrimary, sourceEventId: event.id });
    } else {
      return {
        availability: "PARTIAL_HISTORY",
        members: [],
        reason: `Membership history has unknown event type ${event.eventType}`,
      };
    }
  }

  return {
    availability: "AVAILABLE",
    members: [...state.values()].sort((a, b) => a.coinId - b.coinId),
  };
}

function digestMembers(members: readonly { coinId: number; isPrimary: boolean }[]): string {
  const sorted = members.slice().sort((a, b) => a.coinId - b.coinId);
  const items = sorted.map((member) => {
    const isPrimary = member.isPrimary ? "true" : "false";
    return `{"coinId": ${member.coinId}, "isPrimary": ${isPrimary}, "membershipState": "MEMBER"}`;
  });
  const canonical = `[${items.join(", ")}]`;
  return createHash("sha256").update(canonical).digest("hex");
}

function baseResolution(
  narrativeId: number,
  windowEnd: Date,
  availability: P3MembershipAvailability,
  reason: string,
): P3MembershipResolution {
  return {
    narrativeId,
    windowEnd,
    snapshotId: null,
    snapshotRevision: null,
    constituents: [],
    source: null,
    memberDigest: null,
    availability,
    reason,
  };
}

/**
 * Reads a snapshot's persisted members and validates its digest/count.
 * Returns null if the snapshot does not exist or fails validation.
 */
async function readSnapshotMembers(
  snapshot: { id: number; memberCount: number; memberDigest: string },
): Promise<readonly ResolvedMember[] | null> {
  const members = await db
    .select({
      coinId: narrativeMembershipSnapshotMembers.coinId,
      isPrimary: narrativeMembershipSnapshotMembers.isPrimary,
      sourceEventId: narrativeMembershipSnapshotMembers.sourceEventId,
    })
    .from(narrativeMembershipSnapshotMembers)
    .where(eq(narrativeMembershipSnapshotMembers.snapshotId, snapshot.id))
    .orderBy(asc(narrativeMembershipSnapshotMembers.coinId));

  const resolvedMembers = members.map((member) => ({
    coinId: member.coinId,
    isPrimary: member.isPrimary,
    sourceEventId: member.sourceEventId ?? 0,
  }));
  const digest = digestMembers(resolvedMembers);
  if (snapshot.memberCount !== resolvedMembers.length || snapshot.memberDigest !== digest) {
    return null;
  }
  return resolvedMembers;
}

/**
 * Resolves the only authoritative P3 membership boundary. Current
 * coin_narratives is intentionally absent from this module: missing history
 * must remain unavailable rather than silently becoming current membership.
 *
 * CONTRACT (mutation-free):
 * - This is a pure READ/RESOLUTION boundary. It NEVER inserts into
 *   narrative_membership_snapshots or narrative_membership_snapshot_members.
 * - Resolution semantics:
 *   - Case A: requested window == baseline window → return baseline snapshot.
 *   - Case B: requested window after baseline, no events → reuse baseline snapshot.
 *   - Case C: requested window after baseline, events exist → apply events to
 *             baseline membership in-memory and return computed state.
 *   - Case D: requested window precedes trustworthy baseline → NO_SNAPSHOT.
 *   - Case E: coverage exists but history insufficient → explicit unavailable state.
 *
 * The returned snapshotId is the authoritative baseline snapshot when the
 * membership has not changed since baseline. If events have been applied, the
 * snapshotId still references the baseline snapshot as the source of truth.
 */
export async function resolveP3Membership(
  narrativeId: number,
  windowEnd: Date,
  options: {
    mode?: "observed" | "simulation" | "corrected-observed";
    snapshotRevision?: number;
  } = {},
): Promise<P3MembershipResolution> {
  if (!Number.isInteger(narrativeId) || narrativeId <= 0) {
    return baseResolution(narrativeId, windowEnd, "INVALID_SNAPSHOT", "Invalid narrativeId");
  }
  if (!(windowEnd instanceof Date) || !Number.isFinite(windowEnd.getTime())) {
    return baseResolution(narrativeId, windowEnd, "INVALID_SNAPSHOT", "Invalid windowEnd");
  }

  const membershipMode = options.mode ?? "observed";
  const snapshotRevision = options.snapshotRevision ?? 1;
  if (!Number.isInteger(snapshotRevision) || snapshotRevision <= 0) {
    return baseResolution(narrativeId, windowEnd, "INVALID_SNAPSHOT", "Invalid snapshotRevision");
  }

  // Case D: find coverage. If none precedes windowEnd → NO_SNAPSHOT.
  const [coverage] = await db
    .select({ historyCoverageStart: narrativeMembershipCoverage.historyCoverageStart })
    .from(narrativeMembershipCoverage)
    .where(and(
      eq(narrativeMembershipCoverage.narrativeId, narrativeId),
      lte(narrativeMembershipCoverage.historyCoverageStart, windowEnd),
    ))
    .orderBy(asc(narrativeMembershipCoverage.historyCoverageStart))
    .limit(1);

  if (!coverage) {
    return baseResolution(
      narrativeId,
      windowEnd,
      "NO_SNAPSHOT",
      `No verified membership coverage exists at ${windowEnd.toISOString()}`,
    );
  }

  // Locate the authoritative baseline snapshot at the coverage start.
  // JavaScript Date has only millisecond precision, while PostgreSQL
  // timestamptz stores microseconds. Use a 1ms range to avoid missing
  // the baseline due to precision truncation.
  const coverageStart = coverage.historyCoverageStart;
  const coverageStartPlus1ms = new Date(coverageStart.getTime() + 1);
  const [baselineSnapshot] = await db
    .select()
    .from(narrativeMembershipSnapshots)
    .where(and(
      eq(narrativeMembershipSnapshots.narrativeId, narrativeId),
      gte(narrativeMembershipSnapshots.windowEnd, coverageStart),
      lte(narrativeMembershipSnapshots.windowEnd, coverageStartPlus1ms),
      eq(narrativeMembershipSnapshots.membershipMode, membershipMode),
      eq(narrativeMembershipSnapshots.snapshotRevision, snapshotRevision),
    ))
    .limit(1);

  if (!baselineSnapshot) {
    // Coverage exists but no authoritative baseline snapshot is materialized.
    return baseResolution(
      narrativeId,
      windowEnd,
      "PARTIAL_HISTORY",
      `Coverage exists at ${coverage.historyCoverageStart.toISOString()} but no authoritative baseline snapshot is materialized for this window/mode/revision`,
    );
  }

  const baselineMembers = await readSnapshotMembers(baselineSnapshot);
  if (!baselineMembers) {
    return baseResolution(
      narrativeId,
      windowEnd,
      "INVALID_SNAPSHOT",
      `Snapshot ${baselineSnapshot.id} failed member count/digest validation`,
    );
  }

  // Case A: requested window == baseline window → return baseline snapshot.
  if (windowEnd.getTime() === baselineSnapshot.windowEnd.getTime()) {
    return {
      narrativeId,
      windowEnd,
      snapshotId: baselineSnapshot.id,
      snapshotRevision,
      constituents: baselineMembers.map((member) => ({ ...member, membershipState: "ELIGIBLE" as const })),
      source: "membership_snapshot",
      memberDigest: baselineSnapshot.memberDigest,
      availability: "AVAILABLE",
    };
  }

  // Case C: load events after baseline up to windowEnd.
  const events = await db
    .select()
    .from(narrativeMembershipEvents)
    .where(and(
      eq(narrativeMembershipEvents.narrativeId, narrativeId),
      gte(narrativeMembershipEvents.effectiveAt, baselineSnapshot.windowEnd),
      lte(narrativeMembershipEvents.effectiveAt, windowEnd),
    ))
    .orderBy(asc(narrativeMembershipEvents.effectiveAt), asc(narrativeMembershipEvents.id));

  // Case B: no events after baseline → reuse baseline membership.
  if (events.length === 0) {
    return {
      narrativeId,
      windowEnd,
      snapshotId: baselineSnapshot.id,
      snapshotRevision,
      constituents: baselineMembers.map((member) => ({ ...member, membershipState: "ELIGIBLE" as const })),
      source: "membership_snapshot",
      memberDigest: baselineSnapshot.memberDigest,
      availability: "AVAILABLE",
    };
  }

  // Apply events chronologically to baseline membership (in-memory, no persistence).
  const eventInputs: P3MembershipEventForResolution[] = events.map((event) => ({
    id: event.id,
    coinId: event.coinId,
    eventType: event.eventType,
    isPrimary: event.isPrimary,
    effectiveAt: event.effectiveAt,
  }));
  const resolved = resolveMembershipEventsAt(eventInputs, windowEnd);
  if (resolved.availability !== "AVAILABLE") {
    return baseResolution(narrativeId, windowEnd, resolved.availability, resolved.reason ?? "Invalid membership history");
  }

  const members = [...resolved.members];
  const digest = digestMembers(members);

  return {
    narrativeId,
    windowEnd,
    snapshotId: baselineSnapshot.id,
    snapshotRevision,
    constituents: members.map((member) => ({ ...member, membershipState: "ELIGIBLE" as const })),
    source: "membership_event_ledger",
    memberDigest: digest,
    availability: "AVAILABLE",
  };
}

// ==================== HISTORICAL CORRECTION LEDGER (P3-10E.17) ====================

export interface P3HistoricalCorrection {
  id: number;
  originalIntelligenceId: number;
  originalSnapshotId: number | null;
  correctedSnapshotId: number | null;
  reason: string;
  correctedAt: Date;
  algorithmKey: string | null;
  algorithmVersion: string | null;
  correctedBy: string | null;
  provenance: unknown;
}

export interface EffectiveSnapshotResolution {
  intelligenceId: number;
  originalSnapshotId: number | null;
  effectiveSnapshotId: number | null;
  isSuperseded: boolean;
  correction: P3HistoricalCorrection | null;
}

/**
 * Returns the correction record for an intelligence artifact, if one exists.
 * The correction ledger is append-only: this function never mutates state.
 */
export async function getIntelligenceCorrection(
  intelligenceId: number,
): Promise<P3HistoricalCorrection | null> {
  if (!Number.isInteger(intelligenceId) || intelligenceId <= 0) {
    return null;
  }

  const [correction] = await db
    .select()
    .from(p3HistoricalCorrections)
    .where(eq(p3HistoricalCorrections.originalIntelligenceId, intelligenceId))
    .limit(1);

  if (!correction) return null;

  return {
    id: correction.id,
    originalIntelligenceId: correction.originalIntelligenceId,
    originalSnapshotId: correction.originalSnapshotId ?? null,
    correctedSnapshotId: correction.correctedSnapshotId ?? null,
    reason: correction.reason,
    correctedAt: correction.correctedAt,
    algorithmKey: correction.algorithmKey,
    algorithmVersion: correction.algorithmVersion,
    correctedBy: correction.correctedBy,
    provenance: correction.provenance,
  };
}

/**
 * Resolves the effective snapshot for a persisted intelligence record.
 *
 * Consumer semantics:
 * - If a correction exists for this intelligence, the corrected_snapshot_id
 *   is the authoritative reference.
 * - If no correction exists, the raw membership_snapshot_id is returned.
 * - The returned object makes supersession explicit via `isSuperseded`.
 *
 * This function does not modify any historical artifact. It only reads
 * the correction ledger and the intelligence record.
 */
export async function resolveEffectiveSnapshotId(
  intelligenceId: number,
): Promise<EffectiveSnapshotResolution> {
  if (!Number.isInteger(intelligenceId) || intelligenceId <= 0) {
    return {
      intelligenceId,
      originalSnapshotId: null,
      effectiveSnapshotId: null,
      isSuperseded: false,
      correction: null,
    };
  }

  const [intelligence] = await db
    .select({ membershipSnapshotId: p3NarrativeIntelligence.membershipSnapshotId })
    .from(p3NarrativeIntelligence)
    .where(eq(p3NarrativeIntelligence.id, intelligenceId))
    .limit(1);

  const originalSnapshotId = intelligence?.membershipSnapshotId ?? null;
  const correction = await getIntelligenceCorrection(intelligenceId);

  return {
    intelligenceId,
    originalSnapshotId,
    effectiveSnapshotId: correction?.correctedSnapshotId ?? originalSnapshotId,
    isSuperseded: correction !== null,
    correction,
  };
}

/**
 * Convenience boolean: returns true when the intelligence record has been
 * superseded by a correction ledger entry.
 */
export async function isIntelligenceSuperseded(
  intelligenceId: number,
): Promise<boolean> {
  const resolution = await resolveEffectiveSnapshotId(intelligenceId);
  return resolution.isSuperseded;
}