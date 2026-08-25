/**
 * P6-04D — Regime Confidence Calculation
 *
 * PD-04B-12: confidence = min(100, qualifying_snapshot_count / min_persistence * 100)
 * PD-04C-08: "count" = consecutive qualifying snapshots
 * PD-04C-09: Transition confidence only
 * PD-04C-10: Integer (floor), clamped [0, 100]
 *
 * Authority: P6-04B Semantic Contract, P6-04C1 Decision Contract
 */

/**
 * Calculate transition confidence.
 *
 * @param qualifyingCount - Number of consecutive qualifying snapshots
 * @param minPersistence - Minimum persistence required (default: 2)
 * @returns Confidence 0-100 (integer, floor, clamped)
 */
export function calculateConfidence(
  qualifyingCount: number,
  minPersistence: number = 2
): number {
  if (minPersistence <= 0) return 100;
  const raw = (qualifyingCount / minPersistence) * 100;
  return Math.min(100, Math.max(0, Math.floor(raw)));
}
