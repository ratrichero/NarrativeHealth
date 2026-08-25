/**
 * P6-05D — Warning Identity & Deduplication
 *
 * PD-05C-01: Warning identity is occurrence-based (FROZEN).
 *
 * Identity tuple:
 * (entity_type, entity_id, warning_type, detection_window)
 *
 * Each detection window produces a new warning record.
 * Same window + same type = deduplicated.
 *
 * Authority: P6-05C1 Decision Contract
 */

import type {
  EntityType,
  WarningType,
  WarningIdentity,
  WarningRecord,
  WarningConfig,
} from "./types";
import { DEFAULT_WARNING_CONFIG } from "./types";

// ─── DEDUP KEY ────────────────────────────────────────────────────

/**
 * Compute dedup key from identity tuple.
 * EW-27: Dedup key includes detection_window.
 */
export function computeDedupKey(identity: WarningIdentity): string {
  return [
    identity.entity_type,
    identity.entity_id,
    identity.warning_type,
    identity.detection_window.toISOString(),
  ].join(":");
}

// ─── OCCURRENCE CHECK ─────────────────────────────────────────────

/**
 * Check if a warning candidate is a duplicate of an existing active warning.
 *
 * Duplicate = same dedup key (same entity, type, and detection window).
 *
 * PD-05C-01: Each detection window is a new occurrence.
 * Same window = same occurrence = duplicate.
 */
export function isDuplicate(
  dedupKey: string,
  existingWarnings: ReadonlyArray<WarningRecord>
): boolean {
  return existingWarnings.some(
    (w) =>
      w.dedup_key === dedupKey &&
      (w.lifecycle === "ACTIVE" || w.lifecycle === "DETECTED")
  );
}

// ─── COOLDOWN CHECK ───────────────────────────────────────────────

/**
 * Check if a warning is within cooldown period.
 * PD-05B-08: 24-hour cooldown per (entity_type, entity_id, warning_type).
 *
 * Cooldown operates AFTER dedup check.
 */
export function isWithinCooldown(
  entityType: EntityType,
  entityId: number,
  warningType: WarningType,
  detectionWindow: Date,
  existingWarnings: ReadonlyArray<WarningRecord>,
  config: WarningConfig = DEFAULT_WARNING_CONFIG
): boolean {
  // PD-05B-08: Cooldown suppresses only within the SAME detection window.
  // Different detection windows are new occurrences and should not be blocked by cooldown.
  // Dedup already handles same-window suppression; cooldown provides an additional
  // safety net for edge cases within the same window.
  const cooldownMs = config.cooldownHours * 60 * 60 * 1000;
  const cutoff = new Date(detectionWindow.getTime() - cooldownMs);

  return existingWarnings.some(
    (w) =>
      w.entity_type === entityType &&
      w.entity_id === entityId &&
      w.warning_type === warningType &&
      w.dedup_key === computeDedupKey(buildWarningIdentity(entityType, entityId, warningType, detectionWindow)) &&
      w.detected_at >= cutoff &&
      (w.lifecycle === "ACTIVE" || w.lifecycle === "DETECTED")
  );
}

// ─── SUPERSESSION CHECK ───────────────────────────────────────────

/**
 * Find existing ACTIVE warnings of the same type for the same entity
 * that should be superseded by a new warning.
 *
 * PD-05B-10: ACTIVE → SUPERSEDED when new warning of same type is generated.
 */
export function findWarningsToSupersede(
  entityType: EntityType,
  entityId: number,
  warningType: WarningType,
  existingWarnings: ReadonlyArray<WarningRecord>
): WarningRecord[] {
  return existingWarnings.filter(
    (w) =>
      w.entity_type === entityType &&
      w.entity_id === entityId &&
      w.warning_type === warningType &&
      w.lifecycle === "ACTIVE"
  );
}

// ─── RESOLUTION CHECK ─────────────────────────────────────────────

/**
 * Find ACTIVE warnings that should be RESOLVED because the condition
 * no longer exists.
 *
 * Example: HEALTH_DETERIORATION was active, but health improved.
 */
export function findWarningsToResolve(
  entityType: EntityType,
  entityId: number,
  warningType: WarningType,
  conditionNoLongerApplies: boolean,
  existingWarnings: ReadonlyArray<WarningRecord>
): WarningRecord[] {
  if (!conditionNoLongerApplies) return [];

  return existingWarnings.filter(
    (w) =>
      w.entity_type === entityType &&
      w.entity_id === entityId &&
      w.warning_type === warningType &&
      w.lifecycle === "ACTIVE"
  );
}

// ─── BUILD IDENTITY ───────────────────────────────────────────────

/**
 * Build warning identity from components.
 */
export function buildWarningIdentity(
  entityType: EntityType,
  entityId: number,
  warningType: WarningType,
  detectionWindow: Date
): WarningIdentity {
  return {
    entity_type: entityType,
    entity_id: entityId,
    warning_type: warningType,
    detection_window: detectionWindow,
  };
}
