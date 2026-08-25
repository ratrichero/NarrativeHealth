/**
 * P6-03D — Intelligence Snapshot Module
 *
 * Public API for P6-native intelligence snapshot layer.
 */

export type {
  EntityType,
  SnapshotType,
  SnapshotStatus,
  SnapshotTimeframe,
  SnapshotVersionTuple,
  SnapshotIdentity,
  CoinSnapshotInput,
  CoinSnapshotOutput,
  NarrativeMemberInput,
  NarrativeSnapshotInput,
  NarrativeSnapshotOutput,
  SnapshotProvenance,
  NarrativeSnapshotProvenance,
} from "./types";

export { SNAPSHOT_NEUTRAL_SCORE, SNAPSHOT_V1_VERSION } from "./types";

export { createSnapshotIdentity, snapshotIdentityKey } from "./identity";

export {
  assembleCoinProvenance,
  assembleNarrativeProvenance,
} from "./provenance";

export { generateCoinSnapshot, coinSnapshotIdentityKey } from "./coin-snapshot";

export {
  generateNarrativeSnapshot,
  narrativeSnapshotIdentityKey,
} from "./narrative-snapshot";

export {
  persistCoinSnapshot,
  persistNarrativeSnapshot,
  readCurrentSnapshot,
  readCurrentCoinSnapshots,
} from "./persistence";
export type { SnapshotRecord } from "./persistence";

export { runSnapshotGeneration } from "./service";
export type {
  NarrativeMembershipData,
  SnapshotRunResult,
} from "./service";
