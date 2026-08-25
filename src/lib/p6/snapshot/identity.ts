// P6 Snapshot Identity
// Authority: P6-03B §5, P6-03C2 PD-03B-03/PD-03B-07
// IS-03: Snapshot identity MUST NOT be confused with observation or feature identity
// IS-04: input_window_end replaces legacy date-only identity
// IS-28: uniqueness per (entity_type, entity_id, snapshot_type, window_end)

import type { EntityType, SnapshotType, SnapshotTimeframe, SnapshotIdentity } from "./types";

/**
 * Create a snapshot identity.
 * PD-03B-07: V1 is DAILY timeframe only.
 * IS-28: Uniqueness is per (entity_type, entity_id, snapshot_type, window_end).
 */
export function createSnapshotIdentity(
  entityType: EntityType,
  entityId: number,
  snapshotType: SnapshotType,
  windowEnd: Date,
  timeframe: SnapshotTimeframe = "DAILY"
): SnapshotIdentity {
  return {
    entity_type: entityType,
    entity_id: entityId,
    snapshot_type: snapshotType,
    timeframe,
    window_end: windowEnd,
  };
}

/**
 * Produce a deterministic string key for uniqueness checks.
 * IS-28: (entity_type, entity_id, snapshot_type, window_end)
 */
export function snapshotIdentityKey(identity: SnapshotIdentity): string {
  return `${identity.entity_type}:${identity.entity_id}:${identity.snapshot_type}:${identity.window_end.toISOString()}`;
}
