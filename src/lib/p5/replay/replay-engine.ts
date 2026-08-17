import type { P5AuditEvent, P5DecisionRecord } from "../types";
import type { HistoricalArtifactResolver } from "./artifact-resolver";
import type {
  P5ArtifactResolutionResult,
  P5ReplayDimension,
  P5ReplayEquivalence,
  P5ReplayFinding,
  P5ReplayFindingType,
  P5ReplayMode,
  P5ReplayReport,
  P5ReplayResult,
} from "./types";

/**
 * P5-07-IMPL — Replay Reconstruction Engine.
 *
 * Implements the three FROZEN P5-07 modes:
 *
 *   RECONSTRUCT — rebuild the historical state from recorded artifacts only;
 *   VALIDATE     — check exact reference resolution, version/hash integrity,
 *                  audit chronology, contradictions (never silently repairs);
 *   COMPARE      — compare the recorded historical result against the
 *                  reconstructed result; NEVER live policy/safety re-evaluation.
 *
 * Hard invariants (P5-07 RP-002/005/006/016, §3, §7, §8):
 *  - historical artifacts always win over live state; live data appears only
 *    as labeled LIVE_CONTEXT diagnostics and is never reconstructed truth;
 *  - deterministic: same decisionId + same recorded artifacts + same
 *    replayContractVersion ⇒ same report (no wall-clock, no random, no
 *    mutable global state);
 *  - replay ≠ re-execution: zero side effects, no policy/safety/approval
 *    re-evaluation, no execution, no retry;
 *  - results live in the replay-validation namespace (REPLAY_* / CONTRADICTION),
 *    never in the P5-02 DecisionOutcome vocabulary.
 *
 * READ-ONLY: no write/mutation method exists anywhere in this module.
 */

/** FROZEN P5-07 replay contract version (P5-07 §14 — the only dimension P5-07 adds). */
export const P5_REPLAY_CONTRACT_VERSION = "p5-replay/v1";

/** P5-05 §17 core audit event vocabulary (execution events remain CANDIDATE). */
export const P5_AUDIT_EVENT_TYPES = {
  CANDIDATE_CREATED: "CANDIDATE_CREATED",
  DECISION_CREATED: "DECISION_CREATED",
  DECISION_SELECTED: "DECISION_SELECTED",
  DECISION_BLOCKED: "DECISION_BLOCKED",
  DECISION_SUPPRESSED: "DECISION_SUPPRESSED",
  APPROVAL_REQUESTED: "APPROVAL_REQUESTED",
  APPROVAL_GRANTED: "APPROVAL_GRANTED",
  APPROVAL_DENIED: "APPROVAL_DENIED",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",
  DECISION_EXPIRED: "DECISION_EXPIRED",
  DECISION_CANCELLED: "DECISION_CANCELLED",
  DECISION_SUPERSEDED: "DECISION_SUPERSEDED",
  // CANDIDATE vocabulary (P5-07 §21.8) — only used for the "after permission" check.
  EXECUTION_ATTEMPTED: "EXECUTION_ATTEMPTED",
} as const;

export interface ReplayEngineOptions {
  /** FROZEN contract version applied by this engine instance. */
  replayContractVersion?: string;
  /**
   * Optional diagnostic inspection of live state (P5-07 §11.3). When a
   * REQUIRED historical artifact is missing, the engine may attach the
   * returned note as labeled LIVE_CONTEXT — it never becomes reconstructed
   * historical truth. Explicit replay input, not hidden configuration.
   */
  inspectLiveContext?: (dimension: P5ReplayDimension, ref: string) => string | null;
}

/** Which referenced dimensions the recorded situation makes REQUIRED (P5-07 §4.2). */
interface RequiredDims {
  p4Snapshot: boolean;
  policy: boolean;
  guardrail: boolean;
  approval: boolean;
  permission: boolean;
}

function requiredDimensions(record: P5DecisionRecord): RequiredDims {
  return {
    p4Snapshot: record.provenance.p4SnapshotRef !== null,
    policy: record.provenance.policy.policyId !== null,
    guardrail:
      (record.safetyResult?.guardrailResults?.length ?? 0) > 0 ||
      record.provenance.safety.guardrailVersion !== null,
    approval: record.approvalRecord !== null,
    // A granted execution permission references a permission record (P5-04 SG-011).
    permission: record.permissionResult === "GRANTED",
  };
}

function finding(
  dimension: P5ReplayFinding["dimension"],
  type: P5ReplayFindingType,
  ref: string | null,
  detail: string | null,
  liveContext = false
): P5ReplayFinding {
  return { findingId: `${dimension}|${type}|${ref ?? ""}`, dimension, type, ref, detail, liveContext };
}

/** P5-07 §21.8 audit chronology validation — detects, reports, never repairs. */
export function validateAuditChronology(events: P5AuditEvent[]): P5ReplayFinding[] {
  const findings: P5ReplayFinding[] = [];
  const types = P5_AUDIT_EVENT_TYPES;

  // Duplicate event ids.
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.eventId)) {
      findings.push(finding("chronology", "CHRONOLOGY_DUPLICATE", event.eventId, `Duplicate audit eventId "${event.eventId}".`));
    }
    seen.add(event.eventId);
  }

  // Timestamp consistency in recorded order (decreasing timestamps = disorder).
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (prev.timestamp && curr.timestamp && curr.timestamp < prev.timestamp) {
      findings.push(
        finding(
          "chronology",
          "CHRONOLOGY_ORDER",
          curr.eventId,
          `Event "${curr.eventType}" timestamp precedes its recorded predecessor "${prev.eventType}" — timestamp disorder.`
        )
      );
    }
  }

  const has = (t: string) => events.some((e) => e.eventType === t);
  const indexOf = (t: string) => events.findIndex((e) => e.eventType === t);

  // DECISION_CREATED must precede SELECTED / BLOCKED / SUPPRESSED.
  const decisionOutcomes = [types.DECISION_SELECTED, types.DECISION_BLOCKED, types.DECISION_SUPPRESSED];
  const firstOutcomeIndex = Math.min(...decisionOutcomes.filter((t) => has(t)).map((t) => indexOf(t)));
  if (firstOutcomeIndex !== Infinity) {
    if (!has(types.DECISION_CREATED)) {
      findings.push(finding("chronology", "CHRONOLOGY_GAP", "DECISION_CREATED", "Decision outcome event exists without a preceding DECISION_CREATED event."));
    } else if (indexOf(types.DECISION_CREATED) > firstOutcomeIndex) {
      findings.push(finding("chronology", "CHRONOLOGY_ORDER", "DECISION_CREATED", "DECISION_CREATED appears after a decision outcome event."));
    }
  }

  // APPROVAL_REQUESTED must precede APPROVAL_GRANTED / APPROVAL_DENIED.
  const approvalOutcomes = [types.APPROVAL_GRANTED, types.APPROVAL_DENIED];
  const firstApprovalIndex = Math.min(...approvalOutcomes.filter((t) => has(t)).map((t) => indexOf(t)));
  if (firstApprovalIndex !== Infinity) {
    if (!has(types.APPROVAL_REQUESTED)) {
      findings.push(finding("chronology", "CHRONOLOGY_GAP", "APPROVAL_REQUESTED", "Approval outcome event exists without a preceding APPROVAL_REQUESTED event."));
    } else if (indexOf(types.APPROVAL_REQUESTED) > firstApprovalIndex) {
      findings.push(finding("chronology", "CHRONOLOGY_ORDER", "APPROVAL_REQUESTED", "APPROVAL_REQUESTED appears after an approval outcome event."));
    }
  }

  // PERMISSION_GRANTED must precede PERMISSION_REVOKED.
  if (has(types.PERMISSION_REVOKED)) {
    if (!has(types.PERMISSION_GRANTED)) {
      findings.push(finding("chronology", "CHRONOLOGY_GAP", "PERMISSION_GRANTED", "PERMISSION_REVOKED exists without a preceding PERMISSION_GRANTED event."));
    } else if (indexOf(types.PERMISSION_GRANTED) > indexOf(types.PERMISSION_REVOKED)) {
      findings.push(finding("chronology", "CHRONOLOGY_ORDER", "PERMISSION_REVOKED", "PERMISSION_REVOKED precedes PERMISSION_GRANTED."));
    }
  }

  // CANDIDATE execution vocabulary: EXECUTION_ATTEMPTED only after permission.
  if (has(types.EXECUTION_ATTEMPTED) && !has(types.PERMISSION_GRANTED)) {
    findings.push(finding("chronology", "CHRONOLOGY_GAP", "PERMISSION_GRANTED", "EXECUTION_ATTEMPTED exists without a preceding PERMISSION_GRANTED event."));
  }

  // Terminal events (EXPIRED / CANCELLED / SUPERSEDED) allow no later state transitions.
  const terminal: string[] = [types.DECISION_EXPIRED, types.DECISION_CANCELLED, types.DECISION_SUPERSEDED];
  const terminalIndex = events.findIndex((e) => terminal.includes(e.eventType));
  if (terminalIndex !== -1) {
    for (const event of events.slice(terminalIndex + 1)) {
      if (event.newState !== null) {
        findings.push(
          finding(
            "chronology",
            "CHRONOLOGY_ORDER",
            event.eventId,
            `State-transition event "${event.eventType}" appears after terminal event "${events[terminalIndex].eventType}".`
          )
        );
      }
    }
  }

  return findings;
}

/** Contradiction findings — evidence preserved, never resolved by guesswork (P5-07 §12). */
function contradictionFindings(record: P5DecisionRecord, decisionId: string): P5ReplayFinding[] {
  const findings: P5ReplayFinding[] = [];

  if (record.approvalRecord) {
    // Approval record references an obsolete decision → UNRESOLVED.
    if (record.approvalRecord.decisionIdRef !== null && record.approvalRecord.decisionIdRef !== decisionId) {
      findings.push(
        finding(
          "contradiction",
          "UNRESOLVED",
          record.approvalRecord.approvalId,
          `Approval record "${record.approvalRecord.approvalId}" references decision "${record.approvalRecord.decisionIdRef}", not "${decisionId}" — recorded as unresolved, no silent fix.`
        )
      );
    }
    // Decision approval state vs approval record state.
    if (record.approvalRecord.state !== record.approvalState) {
      findings.push(
        finding(
          "contradiction",
          "ARTIFACT_CONTRADICTION",
          record.approvalRecord.approvalId,
          `Decision approvalState "${record.approvalState}" contradicts recorded approval record state "${record.approvalRecord.state}" — both preserved verbatim.`
        )
      );
    }
  }

  // Decision approval state vs audit trail (P5-07 §12: "Decision says APPROVED, audit says DENIED").
  if (record.approvalState === "APPROVED" || record.approvalState === "DENIED") {
    let lastApprovalEvent: P5AuditEvent | null = null;
    for (const event of record.auditEvents) {
      if (event.eventType === P5_AUDIT_EVENT_TYPES.APPROVAL_GRANTED || event.eventType === P5_AUDIT_EVENT_TYPES.APPROVAL_DENIED) {
        lastApprovalEvent = event;
      }
    }
    if (lastApprovalEvent) {
      const auditApproved = lastApprovalEvent.eventType === P5_AUDIT_EVENT_TYPES.APPROVAL_GRANTED;
      if (record.approvalState === "APPROVED" && !auditApproved) {
        findings.push(
          finding(
            "contradiction",
            "ARTIFACT_CONTRADICTION",
            lastApprovalEvent.eventId,
            `Decision approvalState "APPROVED" contradicts audit event "${lastApprovalEvent.eventType}" — evidence preserved, no silent correction.`
          )
        );
      }
      if (record.approvalState === "DENIED" && auditApproved) {
        findings.push(
          finding(
            "contradiction",
            "ARTIFACT_CONTRADICTION",
            lastApprovalEvent.eventId,
            `Decision approvalState "DENIED" contradicts audit event "${lastApprovalEvent.eventType}" — evidence preserved, no silent correction.`
          )
        );
      }
    }
  }

  return findings;
}

/** Result classification — severity: CONTRADICTION > REPLAY_UNAVAILABLE > REPLAY_PARTIAL > REPLAY_COMPLETE. */
function computeResult(
  decisionFound: boolean,
  required: RequiredDims,
  resolved: {
    p4Snapshot: P5ArtifactResolutionResult<unknown> | null;
    policy: P5ArtifactResolutionResult<unknown> | null;
    guardrail: P5ArtifactResolutionResult<unknown> | null;
    approval: P5ArtifactResolutionResult<unknown> | null;
    permission: P5ArtifactResolutionResult<unknown> | null;
  },
  findings: P5ReplayFinding[]
): P5ReplayResult {
  if (findings.some((f) => f.type === "ARTIFACT_CONTRADICTION" || f.type === "UNRESOLVED")) {
    return "CONTRADICTION";
  }
  if (!decisionFound) {
    return "REPLAY_UNAVAILABLE";
  }

  const blocking = (r: P5ArtifactResolutionResult<unknown> | null) =>
    r !== null &&
    (r.resolution === "MISSING" ||
      r.resolution === "UNAVAILABLE" ||
      r.resolution === "VERSION_MISMATCH" ||
      r.resolution === "HASH_MISMATCH");

  if (
    (required.p4Snapshot && blocking(resolved.p4Snapshot)) ||
    (required.policy && blocking(resolved.policy)) ||
    (required.guardrail && blocking(resolved.guardrail)) ||
    (required.approval && blocking(resolved.approval)) ||
    (required.permission && blocking(resolved.permission))
  ) {
    return "REPLAY_UNAVAILABLE";
  }

  if (findings.length > 0) {
    return "REPLAY_PARTIAL";
  }
  return "REPLAY_COMPLETE";
}

/** P5-07 §13 equivalence — EXACT / SEMANTIC / NON_EQUIVALENT; never fuzzy. */
function computeEquivalence(
  result: P5ReplayResult,
  record: P5DecisionRecord,
  resolved: {
    p4Snapshot: P5ArtifactResolutionResult<unknown> | null;
    policy: P5ArtifactResolutionResult<unknown> | null;
    guardrail: P5ArtifactResolutionResult<unknown> | null;
    approval: P5ArtifactResolutionResult<unknown> | null;
    permission: P5ArtifactResolutionResult<unknown> | null;
  },
  findings: P5ReplayFinding[]
): P5ReplayEquivalence | "REPLAY_UNAVAILABLE" {
  if (result === "REPLAY_UNAVAILABLE") {
    return "REPLAY_UNAVAILABLE";
  }
  if (result === "CONTRADICTION") {
    return "NON_EQUIVALENT";
  }

  const mismatched = findings.some(
    (f) => f.type === "ARTIFACT_VERSION_MISMATCH" || f.type === "ARTIFACT_HASH_MISMATCH"
  );
  if (mismatched) {
    return "NON_EQUIVALENT";
  }

  // Representation/completeness-level differences (identity + version exact,
  // metadata differs) or non-blocking findings (chronology, hash-unavailable)
  // → SEMANTIC equivalence.
  if (semanticDifferences(record, resolved) || findings.length > 0) {
    return "SEMANTIC";
  }

  return "EXACT";
}

/** Identity+version exact but representation differs → SEMANTIC (documented, deterministic). */
function semanticDifferences(
  record: P5DecisionRecord,
  resolved: {
    p4Snapshot: P5ArtifactResolutionResult<unknown> | null;
    policy: P5ArtifactResolutionResult<unknown> | null;
    guardrail: P5ArtifactResolutionResult<unknown> | null;
    approval: P5ArtifactResolutionResult<unknown> | null;
    permission: P5ArtifactResolutionResult<unknown> | null;
  }
): boolean {
  if (resolved.policy?.resolution === "FOUND" && resolved.policy.artifact) {
    const policy = resolved.policy.artifact as { effectiveAt: string | null; evaluationAt: string | null; ruleRefs: string[] };
    const recorded = record.provenance.policy;
    if (policy.effectiveAt !== recorded.effectiveAt || policy.evaluationAt !== recorded.evaluationAt) {
      return true;
    }
    if (policy.ruleRefs.join("\u0000") !== recorded.ruleRefs.join("\u0000")) {
      return true;
    }
  }
  if (resolved.guardrail?.resolution === "FOUND" && resolved.guardrail.artifact) {
    const guardrail = resolved.guardrail.artifact as { evaluatedAt: string | null };
    const recorded = record.safetyResult?.guardrailResults?.[0];
    if (recorded && guardrail.evaluatedAt !== recorded.evaluatedAt) {
      return true;
    }
  }
  if (resolved.p4Snapshot?.resolution === "FOUND" && resolved.p4Snapshot.artifact) {
    const snapshot = resolved.p4Snapshot.artifact as { status: string | null };
    if (snapshot.status !== record.provenance.p4SnapshotRef?.status) {
      return true;
    }
  }
  return false;
}

export class ReplayEngine {
  private readonly resolver: HistoricalArtifactResolver;
  private readonly replayContractVersion: string;
  private readonly inspectLiveContext: ((dimension: P5ReplayDimension, ref: string) => string | null) | null;

  constructor(resolver: HistoricalArtifactResolver, options: ReplayEngineOptions = {}) {
    this.resolver = resolver;
    this.replayContractVersion = options.replayContractVersion ?? P5_REPLAY_CONTRACT_VERSION;
    this.inspectLiveContext = options.inspectLiveContext ?? null;
  }

  /** RECONSTRUCT — rebuild the historical state from recorded artifacts only. */
  async reconstruct(decisionId: string): Promise<P5ReplayReport> {
    return this.run(decisionId, "RECONSTRUCT");
  }

  /** VALIDATE — integrity/consistency checks; never silently repairs anything. */
  async validate(decisionId: string): Promise<P5ReplayReport> {
    return this.run(decisionId, "VALIDATE");
  }

  /** COMPARE — recorded historical result vs reconstructed result; never live re-evaluation. */
  async compare(decisionId: string): Promise<P5ReplayReport> {
    return this.run(decisionId, "COMPARE");
  }

  /** Shared deterministic core for all three modes. */
  private async run(decisionId: string, mode: P5ReplayMode): Promise<P5ReplayReport> {
    const decisionRes = await this.resolver.resolveDecision(decisionId);

    if (decisionRes.resolution !== "FOUND" || decisionRes.artifact === null) {
      const findings: P5ReplayFinding[] = [
        finding(
          "decision",
          "ARTIFACT_MISSING",
          decisionId,
          decisionRes.detail ?? `No decision record exists for decisionId "${decisionId}".`,
          decisionRes.liveContext
        ),
      ];
      return this.report(decisionId, mode, "REPLAY_UNAVAILABLE", findings, [], decisionRes, null, "REPLAY_UNAVAILABLE");
    }

    const record = decisionRes.artifact;
    const required = requiredDimensions(record);
    const findings: P5ReplayFinding[] = [];
    const perArtifact: P5ArtifactResolutionResult<unknown>[] = [];

    const resolved: {
      p4Snapshot: P5ArtifactResolutionResult<unknown> | null;
      policy: P5ArtifactResolutionResult<unknown> | null;
      guardrail: P5ArtifactResolutionResult<unknown> | null;
      approval: P5ArtifactResolutionResult<unknown> | null;
      permission: P5ArtifactResolutionResult<unknown> | null;
    } = { p4Snapshot: null, policy: null, guardrail: null, approval: null, permission: null };

    // P4 snapshot (P5-02 AD-014) — resolved against the recorded ref only.
    if (record.provenance.p4SnapshotRef) {
      const snapshot = await this.resolver.resolveP4Snapshot(record.provenance.p4SnapshotRef);
      resolved.p4Snapshot = snapshot;
      perArtifact.push(snapshot);
      this.collectArtifactFindings(findings, snapshot, "p4Snapshot", required.p4Snapshot);
    }

    // Policy — exact identity + version from the record.
    if (record.provenance.policy.policyId) {
      const policy = await this.resolver.resolvePolicy(
        record.provenance.policy.policyId,
        record.provenance.policy.policyVersion ?? ""
      );
      resolved.policy = policy;
      perArtifact.push(policy);
      this.collectArtifactFindings(findings, policy, "policy", required.policy);
    }

    // Guardrail — when the record references guardrail provenance (e.g. SAFETY_BLOCKED).
    if (required.guardrail && record.safetyResult?.guardrailResults?.[0]) {
      const gr = record.safetyResult.guardrailResults[0];
      const guardrail = await this.resolver.resolveGuardrail(gr.guardrailId, gr.version);
      resolved.guardrail = guardrail;
      perArtifact.push(guardrail);
      this.collectArtifactFindings(findings, guardrail, "guardrail", true);
    }

    // Approval — when an approval record exists (e.g. APPROVAL_DENIED).
    if (record.approvalRecord) {
      const approval = await this.resolver.resolveApproval(record.approvalRecord.approvalId);
      resolved.approval = approval;
      perArtifact.push(approval);
      this.collectArtifactFindings(findings, approval, "approval", true);
    }

    // Permission — P5-04 SG-011: a granted permission implies a permission
    // record. The current decision record model does not record a permission
    // artifact reference, so the exact artifact cannot be resolved — the
    // engine reports an explicit unavailable finding instead of fabricating
    // a reference (P5-07 §4.3 anti-fabrication). resolvePermission() remains
    // part of the resolver contract for when a recorded ref exists.
    if (required.permission) {
      findings.push(
        finding(
          "permission",
          "ARTIFACT_UNAVAILABLE",
          null,
          "permissionResult is GRANTED but the decision record does not record a permission artifact reference — exact permission artifact unavailable; permissionResult preserved as recorded."
        )
      );
    }

    // Contradictions (record vs record, record vs audit).
    findings.push(...contradictionFindings(record, decisionId));

    // Audit chronology (P5-07 §21.8) — detects, reports, never repairs.
    findings.push(...validateAuditChronology(record.auditEvents));

    const result = computeResult(true, required, resolved, findings);
    const equivalence = computeEquivalence(result, record, resolved, findings);

    return this.report(decisionId, mode, result, findings, perArtifact, decisionRes, record, equivalence, resolved);
  }

  /** Map a resolution outcome to the finding classification (never a generic "not found"). */
  private toFindingType(resolution: P5ArtifactResolutionResult<unknown>): P5ReplayFindingType {
    switch (resolution.resolution) {
      case "MISSING":
        return "ARTIFACT_MISSING";
      case "UNAVAILABLE":
        return "ARTIFACT_UNAVAILABLE";
      case "VERSION_MISMATCH":
        return "ARTIFACT_VERSION_MISMATCH";
      case "HASH_MISMATCH":
        return "ARTIFACT_HASH_MISMATCH";
      case "CONTRADICTION":
        return "ARTIFACT_CONTRADICTION";
      default:
        // FOUND produces no finding.
        return "ARTIFACT_UNAVAILABLE";
    }
  }

  /** Convert a resolution into findings (with optional LIVE_CONTEXT diagnostic label). */
  private collectArtifactFindings(
    findings: P5ReplayFinding[],
    resolution: P5ArtifactResolutionResult<unknown>,
    dimension: P5ReplayDimension,
    required: boolean
  ): void {
    if (resolution.resolution === "FOUND") {
      return;
    }
    let liveContext = false;
    let detail = resolution.detail;
    // Live data may be inspected for diagnostics ONLY when a required
    // historical artifact is missing — and it is labeled, never truth.
    if (required && resolution.requestedRef !== null && this.inspectLiveContext) {
      const note = this.inspectLiveContext(dimension, resolution.requestedRef);
      if (note !== null) {
        liveContext = true;
        detail = `${detail ?? ""} LIVE_CONTEXT (diagnostic only, not reconstructed truth): ${note}`;
      }
    }
    findings.push(finding(dimension, this.toFindingType(resolution), resolution.requestedRef, detail, liveContext));
  }

  private report(
    decisionId: string,
    mode: P5ReplayMode,
    result: P5ReplayResult,
    findings: P5ReplayFinding[],
    perArtifact: P5ArtifactResolutionResult<unknown>[],
    decisionRes: P5ArtifactResolutionResult<unknown>,
    record: P5DecisionRecord | null,
    equivalence: P5ReplayEquivalence | "REPLAY_UNAVAILABLE",
    resolved: {
      p4Snapshot: P5ArtifactResolutionResult<unknown> | null;
      policy: P5ArtifactResolutionResult<unknown> | null;
      guardrail: P5ArtifactResolutionResult<unknown> | null;
      approval: P5ArtifactResolutionResult<unknown> | null;
      permission: P5ArtifactResolutionResult<unknown> | null;
    } = { p4Snapshot: null, policy: null, guardrail: null, approval: null, permission: null }
  ): P5ReplayReport {
    return {
      replayContractVersion: this.replayContractVersion,
      mode,
      decisionId,
      result,
      reconstruction: {
        decision: record,
        outcome: record?.outcome ?? null,
        suppressed: record?.suppressed ?? null,
        orthogonalStates: {
          decisionState: record?.decisionState ?? null,
          approvalState: record?.approvalState ?? null,
          executionState: record?.executionState ?? null,
        },
        identityChain: { candidateId: record?.candidateId ?? null, actionId: record?.actionId ?? null },
        snapshot: {
          state: resolved.p4Snapshot?.snapshotState ?? null,
          ref: record?.provenance.p4SnapshotRef ?? null,
        },
        references: {
          policy: resolved.policy as P5ReplayReport["reconstruction"]["references"]["policy"],
          guardrail: resolved.guardrail as P5ReplayReport["reconstruction"]["references"]["guardrail"],
          approval: resolved.approval as P5ReplayReport["reconstruction"]["references"]["approval"],
          permission: resolved.permission as P5ReplayReport["reconstruction"]["references"]["permission"],
        },
        auditEvents: record?.auditEvents ?? [],
      },
      validation: {
        perArtifact,
        findings,
        versionTupleUsed: this.versionTuple(record),
      },
      equivalence,
      sideEffects: "NONE",
    };
  }

  private versionTuple(record: P5DecisionRecord | null): Record<string, string | null> {
    if (!record) {
      return { replayContractVersion: this.replayContractVersion };
    }
    const snapshot = record.provenance.p4SnapshotRef;
    return {
      replayContractVersion: this.replayContractVersion,
      actionModelVersion: record.provenance.versions.actionModelVersion,
      p4AlgorithmVersion: snapshot?.versionTuple.algorithmVersion ?? null,
      p4SemanticVersion: snapshot?.versionTuple.semanticVersion ?? null,
      policyVersion: record.provenance.policy.policyVersion,
      guardrailVersion: record.provenance.safety.guardrailVersion,
      approvalPolicyVersion: record.provenance.approval.approvalPolicyVersion,
      authorityRef: record.provenance.approval.authorityRef,
      automationMode: record.provenance.automationMode,
    };
  }
}
