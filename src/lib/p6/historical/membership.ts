/**
 * P6-08D — Point-in-Time Membership Reconstruction
 *
 * PD-08A-03: Historical comparison uses membership at comparison time.
 * PD-08C-04: Latest event per coin at effective_at ≤ T.
 *
 * Authority: P6-08B §13, P6-08C1 §11, P6-08C2 ACCEPTED
 *
 * Deterministic event ordering:
 *   Primary: effective_at DESC (most recent event first)
 *   Secondary: id DESC (deterministic tie-breaking by insertion order)
 *
 * Filter: only coins with latest event eventType ≠ 'REMOVED' are members.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { narrativeMembershipEvents } from "@/db/schema";
import type { EntityType } from "@/lib/p6/snapshot/types";
import type { HistoricalMembership, MembershipEvent } from "./types";

// ─── POINT-IN-TIME MEMBERSHIP ─────────────────────────────────────

/**
 * Reconstruct narrative membership at a specific point in time.
 *
 * PD-08C-04: For each coin, select the latest membership event where
 * effective_at ≤ T. Use the accepted deterministic event ordering.
 *
 * @param narrativeId - The narrative entity ID
 * @param asOf - The point-in-time to reconstruct membership for
 * @returns HistoricalMembership with the member list and metadata
 */
export async function reconstructMembershipAtTime(
  narrativeId: number,
  asOf: Date
): Promise<HistoricalMembership> {
  // PD-08C-04: Latest event per coin at effective_at ≤ T
  // Using DISTINCT ON (PostgreSQL) with deterministic ordering
  const events = await db
    .select({
      id: narrativeMembershipEvents.id,
      coinId: narrativeMembershipEvents.coinId,
      eventType: narrativeMembershipEvents.eventType,
      isPrimary: narrativeMembershipEvents.isPrimary,
      effectiveAt: narrativeMembershipEvents.effectiveAt,
    })
    .from(narrativeMembershipEvents)
    .where(
      and(
        eq(narrativeMembershipEvents.narrativeId, narrativeId),
        sql`${narrativeMembershipEvents.effectiveAt} <= ${asOf}`
      )
    )
    .orderBy(
      desc(narrativeMembershipEvents.effectiveAt),
      desc(narrativeMembershipEvents.id)
    );

  // Deduplicate per coin_id (latest event wins)
  const latestByCoin = new Map<number, MembershipEvent>();
  for (const event of events) {
    if (!latestByCoin.has(event.coinId)) {
      latestByCoin.set(event.coinId, {
        id: event.id,
        coin_id: event.coinId,
        event_type: event.eventType,
        is_primary: event.isPrimary,
        effective_at: event.effectiveAt,
      });
    }
  }

  // Filter: only coins with latest event eventType ≠ 'REMOVED' are members
  const members: Array<{ coin_id: number; is_primary: boolean }> = [];
  for (const event of latestByCoin.values()) {
    if (event.event_type !== "REMOVED") {
      members.push({
        coin_id: event.coin_id,
        is_primary: event.is_primary ?? false,
      });
    }
  }

  return {
    narrative_id: narrativeId,
    as_of: asOf,
    members,
    member_count: members.length,
    membership_changed: false, // Caller compares with current membership
    event_count: events.length,
  };
}

/**
 * Compare two memberships and determine if they differ.
 *
 * @param historical - Membership at the historical comparison point
 * @param currentMembers - Current member coin IDs
 * @returns Whether membership changed between historical and current
 */
export function detectMembershipChange(
  historical: HistoricalMembership,
  currentMemberIds: ReadonlySet<number>
): boolean {
  if (historical.member_count !== currentMemberIds.size) {
    return true;
  }

  const historicalIds = new Set(historical.members.map((m) => m.coin_id));
  for (const id of currentMemberIds) {
    if (!historicalIds.has(id)) return true;
  }
  for (const id of historicalIds) {
    if (!currentMemberIds.has(id)) return true;
  }

  return false;
}

/**
 * Get all membership events for a narrative (for debugging/provenance).
 */
export async function readMembershipEvents(
  narrativeId: number,
  limit: number = 100
): Promise<MembershipEvent[]> {
  const rows = await db
    .select({
      id: narrativeMembershipEvents.id,
      coinId: narrativeMembershipEvents.coinId,
      eventType: narrativeMembershipEvents.eventType,
      isPrimary: narrativeMembershipEvents.isPrimary,
      effectiveAt: narrativeMembershipEvents.effectiveAt,
    })
    .from(narrativeMembershipEvents)
    .where(eq(narrativeMembershipEvents.narrativeId, narrativeId))
    .orderBy(desc(narrativeMembershipEvents.effectiveAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    coin_id: row.coinId,
    event_type: row.eventType,
    is_primary: row.isPrimary,
    effective_at: row.effectiveAt,
  }));
}
