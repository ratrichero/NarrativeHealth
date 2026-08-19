import type { P4DecisionSupportViewModel } from "@/lib/p4/types";
import { P4_INTERPRETATION_RULE_VERSION } from "@/lib/p4/types";
import { getP4DecisionSupport } from "@/lib/p4/service";
import type {
  P5ActionDecisionReadViewModel,
  P5DecisionRecord,
  P5DecisionSummary,
  P5P4SnapshotRef,
  P5ReadAvailability,
} from "../types";
import { deriveDisplayState } from "./display-state";

/**
 * P5-06A — Action Read Service.
 *
 * READ-ONLY read model over P5 decision/audit records (P5-03/04/05 outputs).
 * The service:
 *  - never creates decisions, evaluates policy, runs safety rules, grants
 *    approval, grants execution permission, executes actions, retries
 *    commands, or mutates audit history;
 *  - never maps UNKNOWN / DEGRADED / NULL / failure / absence to NO_ACTION
 *    (P5-06 §5, §16): absence and failure surface through the explicit
 *    `availability` field;
 *  - never substitutes current live P4 data for a historical snapshot
 *    (P5-05 §11 anti-drift): the recorded snapshot is exposed only via the
 *    decision record provenance; live P4 context is exposed only under
 *    `context.source = "LIVE_P4_CONTEXT"` and only when NO decision record
 *    exists for the subject.
 *
 * STORAGE BOUNDARY: production uses `productionActionReadService`
 * (src/lib/p5/read/production.ts) which wires PgHistoricalArtifactStore
 * (P5-08) for real PostgreSQL reads. The default store (NoP5DecisionStore)
 * is used only by unit tests as an in-memory absence adapter.
 */

/** P5-06A store boundary — READ-ONLY decision/audit record lookup. */
export interface P5DecisionStore {
  /** Lookup by stable decision identity (P5-02 AD-013). */
  findByDecisionId(decisionId: string): Promise<P5DecisionRecord | null>;
  /** Lookup by subject identity (P5-02 §12.2 decision uniqueness tuple basis). */
  findBySubject(subject: { narrativeId: number }): Promise<P5DecisionRecord | null>;
}

/**
 * Default store — test-only absence adapter.
 * Always returns absence. Used by unit tests that inject in-memory stores.
 * Production uses PgP5DecisionStoreAdapter (see production.ts).
 */
export class NoP5DecisionStore implements P5DecisionStore {
  async findByDecisionId(): Promise<P5DecisionRecord | null> {
    return null;
  }
  async findBySubject(): Promise<P5DecisionRecord | null> {
    return null;
  }
}

export interface ActionReadDeps {
  store?: P5DecisionStore;
  getP4?: (narrativeId: number) => Promise<P4DecisionSupportViewModel | null>;
}

/** Build the P5-02 AD-014 snapshot reference from the frozen P4 ViewModel. */
export function buildP4SnapshotRef(vm: P4DecisionSupportViewModel): P5P4SnapshotRef {
  return {
    narrativeIdentity: { ...vm.narrativeIdentity },
    asOf: vm.asOf,
    versionTuple: {
      algorithmVersion: vm.version.algorithmVersion,
      semanticVersion: vm.version.semanticVersion,
      signalCatalogVersion: vm.version.signalCatalogVersion,
      interpretationRuleVersion: P4_INTERPRETATION_RULE_VERSION,
    },
    status: vm.status,
    // PROVISIONAL (P5-02 AD-014) — not computed in v1; never invented here.
    contentHash: null,
  };
}

/** Flatten a stored record into the read summary (1:1 field mapping, no invention). */
function toDecisionSummary(record: P5DecisionRecord): P5DecisionSummary {
  return {
    decisionId: record.decisionId,
    candidateId: record.candidateId,
    actionId: record.actionId,
    outcome: record.outcome,
    suppressed: record.suppressed,
    blockerReport: record.blockerReport,
    actionType: record.actionType,
    parameters: record.parameters,
    decisionState: record.decisionState,
    approvalState: record.approvalState,
    executionState: record.executionState,
    approvalRecord: record.approvalRecord,
    safetyResult: record.safetyResult,
    permissionResult: record.permissionResult,
    explanation: record.explanation,
    provenance: record.provenance,
    auditEvents: record.auditEvents,
  };
}

export class ActionReadService {
  private readonly store: P5DecisionStore;
  private readonly getP4: (narrativeId: number) => Promise<P4DecisionSupportViewModel | null>;

  constructor(deps: ActionReadDeps = {}) {
    this.store = deps.store ?? new NoP5DecisionStore();
    this.getP4 = deps.getP4 ?? getP4DecisionSupport;
  }

  /**
   * A. Decision lookup by stable decision identity (P5-02 AD-013).
   * A missing record yields availability DECISION_NOT_FOUND — never NO_ACTION.
   */
  async getDecisionByDecisionId(decisionId: string): Promise<P5ActionDecisionReadViewModel> {
    try {
      const record = await this.store.findByDecisionId(decisionId);
      if (!record) {
        return this.absentView(
          "DECISION_NOT_FOUND",
          `No P5 decision record exists for decisionId "${decisionId}".`
        );
      }
      return this.presentView(record);
    } catch (error) {
      return this.failureView(error);
    }
  }

  /**
   * Narrative-scoped read view (P5-06C input). Returns the recorded decision
   * when one exists; otherwise ABSENT with the live P4 context (labeled —
   * never a decision basis) or an explicit availability state.
   */
  async getNarrativeActionReadView(
    narrativeId: number
  ): Promise<P5ActionDecisionReadViewModel> {
    try {
      const record = await this.store.findBySubject({ narrativeId });
      if (record) {
        return this.presentView(record);
      }

      // No decision record: derive the live P4 context for display only.
      // If the P4 context is unavailable (null / degraded-to-null), that is
      // P4_CONTEXT_UNAVAILABLE — never NO_ACTION and never a silent "ok".
      let p4: P4DecisionSupportViewModel | null = null;
      try {
        p4 = await this.getP4(narrativeId);
      } catch (error) {
        console.error(`P5 Action Read: P4 context read failed for narrative ${narrativeId}:`, error);
      }

      const snapshot = p4 ? buildP4SnapshotRef(p4) : null;
      if (!snapshot) {
        return this.absentView(
          "P4_CONTEXT_UNAVAILABLE",
          "No P5 decision record exists and the P4 context could not be derived."
        );
      }

      return {
        decisionPresence: "ABSENT",
        decision: null,
        context: { source: "LIVE_P4_CONTEXT", p4SnapshotRef: snapshot },
        availability: "NO_DECISION_RECORD",
        displayState: "ABSENT",
        error: null,
      };
    } catch (error) {
      return this.failureView(error);
    }
  }

  /** Present view — record is authoritative; its own snapshot is the only snapshot used. */
  private presentView(record: P5DecisionRecord): P5ActionDecisionReadViewModel {
    const decision = toDecisionSummary(record);
    const view: P5ActionDecisionReadViewModel = {
      decisionPresence: "PRESENT",
      decision,
      context: {
        source: "DECISION_RECORD",
        p4SnapshotRef: record.provenance.p4SnapshotRef,
      },
      availability: "OK",
      displayState: "ABSENT", // placeholder — replaced below via deriveDisplayState
      error: null,
    };
    view.displayState = deriveDisplayState(view);
    return view;
  }

  private absentView(
    availability: Exclude<P5ReadAvailability, "OK" | "SERVICE_ERROR">,
    message: string
  ): P5ActionDecisionReadViewModel {
    return {
      decisionPresence: "ABSENT",
      decision: null,
      context: null,
      availability,
      // P4 context unavailability is an inability to establish the state —
      // UNAVAILABLE, never ABSENT-as-no-action and never NO_ACTION.
      displayState: availability === "P4_CONTEXT_UNAVAILABLE" ? "UNAVAILABLE" : "ABSENT",
      error: null,
    };
  }

  private failureView(error: unknown): P5ActionDecisionReadViewModel {
    const message = error instanceof Error ? error.message : String(error);
    console.error("P5 Action Read service failure:", error);
    return {
      decisionPresence: "ABSENT",
      decision: null,
      context: null,
      availability: "SERVICE_ERROR",
      displayState: "UNAVAILABLE",
      error: { code: "SERVICE_ERROR", message },
    };
  }
}

/** Default singleton (test-only absence store). Production uses productionActionReadService. */
export const actionReadService = new ActionReadService();
