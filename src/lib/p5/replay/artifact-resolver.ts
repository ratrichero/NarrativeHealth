import type { P5DecisionRecord, P5P4SnapshotRef } from "../types";
import type {
  P5ArtifactResolutionResult,
  P5HistoricalApproval,
  P5HistoricalGuardrail,
  P5HistoricalPermission,
  P5HistoricalPolicy,
  P5HistoricalSnapshot,
} from "./types";

/**
 * P5-07-IMPL — Historical Artifact Resolver.
 *
 * Resolves recorded historical references by **exact identity + version**
 * (P5-07 §5): never "latest", never "current", never an active/current
 * version. Every resolution reports one of FOUND / MISSING / VERSION_MISMATCH
 * / HASH_MISMATCH / UNAVAILABLE / CONTRADICTION — never a generic "not found".
 *
 * STORAGE BOUNDARY: the repository has no P5 historical persistence yet
 * (P5-05 §16: audit persistence model PROVISIONAL; P5-03/04/05 engines are
 * contract-only). The default store (NoHistoricalArtifactStore) is an
 * explicit read-only absence adapter, mirroring P5-06's NoP5DecisionStore.
 * "Replay capability exists" and "historical data is unavailable" are
 * strictly distinguished: the engine works, and reports REPLAY_UNAVAILABLE
 * with exact classifications when the recorded artifacts do not exist.
 *
 * READ-ONLY: no write/mutation method exists anywhere in this module.
 */

/** P5-07-IMPL read-only storage boundary for versioned historical artifacts. */
export interface HistoricalArtifactStore {
  findDecision(decisionId: string): Promise<P5DecisionRecord | null>;
  findP4Snapshot(ref: P5P4SnapshotRef): Promise<P5HistoricalSnapshot | null>;
  findPolicy(policyId: string, policyVersion: string): Promise<P5HistoricalPolicy | null>;
  findGuardrail(guardrailId: string, version: string | null): Promise<P5HistoricalGuardrail | null>;
  findApproval(approvalId: string): Promise<P5HistoricalApproval | null>;
  findPermission(ref: string): Promise<P5HistoricalPermission | null>;
}

/**
 * Default store — no historical artifact persistence exists in the repository
 * yet. Always returns absence. Purely read-only; has no mutation surface.
 */
export class NoHistoricalArtifactStore implements HistoricalArtifactStore {
  async findDecision(): Promise<P5DecisionRecord | null> {
    return null;
  }
  async findP4Snapshot(): Promise<P5HistoricalSnapshot | null> {
    return null;
  }
  async findPolicy(): Promise<P5HistoricalPolicy | null> {
    return null;
  }
  async findGuardrail(): Promise<P5HistoricalGuardrail | null> {
    return null;
  }
  async findApproval(): Promise<P5HistoricalApproval | null> {
    return null;
  }
  async findPermission(): Promise<P5HistoricalPermission | null> {
    return null;
  }
}

/** P5-07-IMPL resolver abstraction — the boundary the replay engine consumes. */
export interface HistoricalArtifactResolver {
  resolveDecision(decisionId: string): Promise<P5ArtifactResolutionResult<P5DecisionRecord>>;
  resolveP4Snapshot(ref: P5P4SnapshotRef): Promise<P5ArtifactResolutionResult<P5HistoricalSnapshot>>;
  resolvePolicy(policyId: string, policyVersion: string): Promise<P5ArtifactResolutionResult<P5HistoricalPolicy>>;
  resolveGuardrail(guardrailId: string, version: string | null): Promise<P5ArtifactResolutionResult<P5HistoricalGuardrail>>;
  resolveApproval(approvalId: string): Promise<P5ArtifactResolutionResult<P5HistoricalApproval>>;
  resolvePermission(ref: string): Promise<P5ArtifactResolutionResult<P5HistoricalPermission>>;
}

/** Deterministic plain-object equality (fixed-key contract tuples). */
function plainEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Concrete resolver over a HistoricalArtifactStore. All resolutions are
 * historical: `liveContext` is always false here — live-context labeling is
 * the engine's diagnostic concern, never the resolver's truth.
 */
export class ArtifactResolver implements HistoricalArtifactResolver {
  constructor(private readonly store: HistoricalArtifactStore) {}

  async resolveDecision(decisionId: string): Promise<P5ArtifactResolutionResult<P5DecisionRecord>> {
    const artifact = await this.store.findDecision(decisionId);
    if (!artifact) {
      return {
        dimension: "decision",
        resolution: "MISSING",
        artifact: null,
        requestedRef: decisionId,
        requestedVersion: null,
        snapshotState: null,
        liveContext: false,
        detail: `No decision record exists for decisionId "${decisionId}".`,
      };
    }
    return {
      dimension: "decision",
      resolution: "FOUND",
      artifact,
      requestedRef: decisionId,
      requestedVersion: null,
      snapshotState: null,
      liveContext: false,
      detail: null,
    };
  }

  async resolveP4Snapshot(ref: P5P4SnapshotRef): Promise<P5ArtifactResolutionResult<P5HistoricalSnapshot>> {
    const stored = await this.store.findP4Snapshot(ref);
    if (!stored) {
      return {
        dimension: "p4Snapshot",
        resolution: "MISSING",
        artifact: null,
        requestedRef: ref.narrativeIdentity.narrativeId.toString(),
        requestedVersion: ref.versionTuple.semanticVersion,
        snapshotState: "SNAPSHOT_MISSING",
        liveContext: false,
        detail: `No stored snapshot artifact for ref ${ref.narrativeIdentity.narrativeId} (version ${ref.versionTuple.semanticVersion}).`,
      };
    }

    // Exact identity + version + asOf (P5-07 §6: SNAPSHOT_MATCH requires all three to align).
    const identityMatches =
      plainEqual(stored.narrativeIdentity, ref.narrativeIdentity) &&
      plainEqual(stored.versionTuple, ref.versionTuple) &&
      stored.asOf === ref.asOf;

    if (!identityMatches) {
      return {
        dimension: "p4Snapshot",
        resolution: "VERSION_MISMATCH",
        artifact: stored,
        requestedRef: ref.narrativeIdentity.narrativeId.toString(),
        requestedVersion: ref.versionTuple.semanticVersion,
        snapshotState: "SNAPSHOT_VERSION_MISMATCH",
        liveContext: false,
        detail: "Stored snapshot artifact exists but identity/version/asOf differs from the recorded ref — the exact historical snapshot is not available.",
      };
    }

    // contentHash is PROVISIONAL (P5-02 AD-014): hash checks apply ONLY when
    // a recorded hash AND a comparable stored hash both exist. A recorded
    // hash with no stored hash is never assumed to match (P5-07 G10).
    if (ref.contentHash !== null) {
      if (stored.contentHash === null) {
        return {
          dimension: "p4Snapshot",
          resolution: "UNAVAILABLE",
          artifact: stored,
          requestedRef: ref.narrativeIdentity.narrativeId.toString(),
          requestedVersion: ref.versionTuple.semanticVersion,
          snapshotState: "SNAPSHOT_UNAVAILABLE",
          liveContext: false,
          detail: "Recorded contentHash present but the stored artifact carries no hash — verification unavailable; never assumed to match.",
        };
      }
      if (stored.contentHash !== ref.contentHash) {
        return {
          dimension: "p4Snapshot",
          resolution: "HASH_MISMATCH",
          artifact: stored,
          requestedRef: ref.narrativeIdentity.narrativeId.toString(),
          requestedVersion: ref.versionTuple.semanticVersion,
          snapshotState: "SNAPSHOT_HASH_MISMATCH",
          liveContext: false,
          detail: "Recorded contentHash does not match the stored artifact hash (drift/tamper signal).",
        };
      }
    }

    return {
      dimension: "p4Snapshot",
      resolution: "FOUND",
      artifact: stored,
      requestedRef: ref.narrativeIdentity.narrativeId.toString(),
      requestedVersion: ref.versionTuple.semanticVersion,
      snapshotState: "SNAPSHOT_MATCH",
      liveContext: false,
      detail: null,
    };
  }

  async resolvePolicy(policyId: string, policyVersion: string): Promise<P5ArtifactResolutionResult<P5HistoricalPolicy>> {
    const stored = await this.store.findPolicy(policyId, policyVersion);
    if (!stored) {
      return {
        dimension: "policy",
        resolution: "MISSING",
        artifact: null,
        requestedRef: policyId,
        requestedVersion: policyVersion,
        snapshotState: null,
        liveContext: false,
        detail: `No stored policy artifact for "${policyId}" version "${policyVersion}".`,
      };
    }
    // Exactness is enforced by the resolver regardless of store implementation.
    if (stored.policyId !== policyId || stored.policyVersion !== policyVersion) {
      return {
        dimension: "policy",
        resolution: "VERSION_MISMATCH",
        artifact: stored,
        requestedRef: policyId,
        requestedVersion: policyVersion,
        snapshotState: null,
        liveContext: false,
        detail: `Stored policy artifact "${stored.policyId}" v"${stored.policyVersion}" does not match requested "${policyId}" v"${policyVersion}" — never silently resolved to the wrong version.`,
      };
    }
    return {
      dimension: "policy",
      resolution: "FOUND",
      artifact: stored,
      requestedRef: policyId,
      requestedVersion: policyVersion,
      snapshotState: null,
      liveContext: false,
      detail: null,
    };
  }

  async resolveGuardrail(guardrailId: string, version: string | null): Promise<P5ArtifactResolutionResult<P5HistoricalGuardrail>> {
    const stored = await this.store.findGuardrail(guardrailId, version);
    if (!stored) {
      return {
        dimension: "guardrail",
        resolution: "MISSING",
        artifact: null,
        requestedRef: guardrailId,
        requestedVersion: version,
        snapshotState: null,
        liveContext: false,
        detail: `No stored guardrail artifact for "${guardrailId}" version "${version}".`,
      };
    }
    if (stored.guardrailId !== guardrailId || stored.version !== version) {
      return {
        dimension: "guardrail",
        resolution: "VERSION_MISMATCH",
        artifact: stored,
        requestedRef: guardrailId,
        requestedVersion: version,
        snapshotState: null,
        liveContext: false,
        detail: `Stored guardrail artifact version does not match requested version "${version}".`,
      };
    }
    return {
      dimension: "guardrail",
      resolution: "FOUND",
      artifact: stored,
      requestedRef: guardrailId,
      requestedVersion: version,
      snapshotState: null,
      liveContext: false,
      detail: null,
    };
  }

  async resolveApproval(approvalId: string): Promise<P5ArtifactResolutionResult<P5HistoricalApproval>> {
    const stored = await this.store.findApproval(approvalId);
    if (!stored) {
      return {
        dimension: "approval",
        resolution: "MISSING",
        artifact: null,
        requestedRef: approvalId,
        requestedVersion: null,
        snapshotState: null,
        liveContext: false,
        detail: `No stored approval artifact for "${approvalId}".`,
      };
    }
    if (stored.approvalId !== approvalId) {
      return {
        dimension: "approval",
        resolution: "VERSION_MISMATCH",
        artifact: stored,
        requestedRef: approvalId,
        requestedVersion: null,
        snapshotState: null,
        liveContext: false,
        detail: `Stored approval artifact "${stored.approvalId}" does not match requested "${approvalId}".`,
      };
    }
    return {
      dimension: "approval",
      resolution: "FOUND",
      artifact: stored,
      requestedRef: approvalId,
      requestedVersion: null,
      snapshotState: null,
      liveContext: false,
      detail: null,
    };
  }

  async resolvePermission(ref: string): Promise<P5ArtifactResolutionResult<P5HistoricalPermission>> {
    const stored = await this.store.findPermission(ref);
    if (!stored) {
      return {
        dimension: "permission",
        resolution: "MISSING",
        artifact: null,
        requestedRef: ref,
        requestedVersion: null,
        snapshotState: null,
        liveContext: false,
        detail: `No stored permission artifact for "${ref}".`,
      };
    }
    if (stored.ref !== ref) {
      return {
        dimension: "permission",
        resolution: "VERSION_MISMATCH",
        artifact: stored,
        requestedRef: ref,
        requestedVersion: null,
        snapshotState: null,
        liveContext: false,
        detail: `Stored permission artifact "${stored.ref}" does not match requested "${ref}".`,
      };
    }
    return {
      dimension: "permission",
      resolution: "FOUND",
      artifact: stored,
      requestedRef: ref,
      requestedVersion: null,
      snapshotState: null,
      liveContext: false,
      detail: null,
    };
  }
}

/** Default singleton for production (absence store; P5-07-IMPL storage boundary). */
export const historicalArtifactResolver = new ArtifactResolver(new NoHistoricalArtifactStore());
