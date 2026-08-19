/**
 * P5-11 — Production Runtime Integration Adapter.
 *
 * Frozen contract source:
 *  - P5-11 §3 Integration Boundary
 *  - P5-11 §4 P4 Snapshot Rule
 *  - P5-11 §5-8 Upstream invocation
 *  - P5-11 §9 Commit Boundary
 *
 * Hard boundaries:
 *  - P5-11 is an ORCHESTRATOR only — no evaluation, no decision logic.
 *  - It wires frozen upstream components into a single pipeline.
 *  - It MUST NOT:
 *    - calculate scores / thresholds / ranking
 *    - select candidates independently
 *    - reinterpret P4 direction
 *    - create new policy rules
 *    - create safety / approval / permission rules
 *    - generate explanation claims
 *    - create audit event types
 *    - perform persistence directly
 *    - perform replay
 *    - perform execution
 *    - add automatic execution
 *    - mutate frozen records
 *    - access DB / PostgreSQL
 *    - import Drizzle
 *
 * Architecture:
 *   P4 snapshot (one declaration)
 *       ↓
 *   P5-11 adapter (this module — orchestration only)
 *       ↓
 *   P5-03 PolicyEvaluator (frozen)
 *       ↓
 *   P5-04 SafetyEvaluator (frozen)
 *       ↓
 *   P5-05 ExplanationEvaluator (frozen)
 *       ↓
 *   P5-10 P5DecisionProducer (frozen)
 *       ↓
 *   P5-09 P5ArtifactRecorder (frozen)
 */

import { P5PolicyEvaluator } from "@/lib/p5/policy/evaluator";
import { P5SafetyEvaluator } from "@/lib/p5/safety/evaluator";
import { P5ExplanationEvaluator } from "@/lib/p5/explanation/evaluator";
import type { P5ProducerInput } from "@/lib/p5/producer/types";
import type { P5CommitResult } from "@/lib/p5/producer/types";
import type { P5DecisionRecord } from "@/lib/p5/types";
import type { P4DecisionSupportViewModel } from "@/lib/p4/types";
import type {
  P5PolicyEvaluationInput,
  P5PolicyEvaluationResult,
  P5PolicySnapshotRef,
} from "@/lib/p5/policy/types";
import type { P5SafetyEvaluationResult } from "@/lib/p5/safety/types";
import type { P5ExplanationResult } from "@/lib/p5/explanation/types";

// ---------------------------------------------------------------------------
// V1 Policy Identity (FROZEN — ODR-1)
// ---------------------------------------------------------------------------

const P5_V1_POLICY_ID = "pol-p5-v1";
const P5_V1_POLICY_VERSION = "v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The result of a P5-11 pipeline invocation.
 * Carries either a successful decision record or a structured error.
 */
export interface P5PipelineResult {
  /** The decision record, if the pipeline succeeded. */
  decision: P5DecisionRecord | null;
  /** The commit result, if recording succeeded. */
  commit: P5CommitResult | null;
  /** Error information, if the pipeline failed. */
  error: P5PipelineError | null;
}

/**
 * Structured error from the P5 pipeline.
 */
export interface P5PipelineError {
  /** The stage where the error occurred. */
  stage: "P4_UNAVAILABLE" | "P5_03" | "P5_04" | "P5_05" | "P5_10_BUILD" | "P5_10_COMMIT";
  /** Human-readable error message. */
  message: string;
  /** Original error, if any. */
  cause?: Error;
}

/**
 * Interface for the P5-11 adapter's commit boundary.
 * Matches the P5DecisionProducer.produce() signature.
 */
export interface P5Producer {
  produce(input: P5ProducerInput): Promise<P5CommitResult>;
}

// ---------------------------------------------------------------------------
// Adapter Implementation
// ---------------------------------------------------------------------------

/**
 * P5-11 Runtime Integration Adapter.
 *
 * Wires the frozen P5-03 → P5-04 → P5-05 → P5-10 → P5-09 chain
 * into a single invocation point.
 *
 * This class is an ORCHESTRATOR — it contains zero evaluation logic.
 */
export class P5RuntimeAdapter {
  private readonly policyEvaluator: P5PolicyEvaluator;
  private readonly safetyEvaluator: P5SafetyEvaluator;
  private readonly explanationEvaluator: P5ExplanationEvaluator;

  constructor(private readonly producer: P5Producer) {
    this.policyEvaluator = new P5PolicyEvaluator();
    this.safetyEvaluator = new P5SafetyEvaluator();
    this.explanationEvaluator = new P5ExplanationEvaluator();
  }

  /**
   * Execute the full P5 decision pipeline for a single narrative.
   *
   * @param narrativeId - The narrative to evaluate.
   * @param p4Snapshot - The P4 snapshot to consume (single declaration).
   * @returns Pipeline result with decision record or error.
   *
   * Invariants:
   *  - One P4 snapshot per invocation (no re-querying).
   *  - Outcome comes ONLY from P5-03.
   *  - Safety/approval/permission come ONLY from P5-04.
   *  - Explanation/provenance/audit come ONLY from P5-05.
   *  - Single commit boundary through P5-10/P5-09.
   */
  async evaluate(
    narrativeId: number,
    p4Snapshot: P4DecisionSupportViewModel,
  ): Promise<P5PipelineResult> {
    // ---- Stage 1: Construct P5-03 input from P4 snapshot ----
    const p503Input = this.buildPolicyInput(narrativeId, p4Snapshot);

    // ---- Stage 2: P5-03 Policy Evaluation ----
    let policyResult: P5PolicyEvaluationResult;
    try {
      policyResult = this.policyEvaluator.evaluate(p503Input);
    } catch (err) {
      return {
        decision: null,
        commit: null,
        error: {
          stage: "P5_03",
          message: "Policy evaluation failed",
          cause: err instanceof Error ? err : new Error(String(err)),
        },
      };
    }

    // ---- Stage 3: P5-04 Safety / Approval / Permission Evaluation ----
    let safetyResult: P5SafetyEvaluationResult;
    try {
      safetyResult = this.safetyEvaluator.evaluate({ policyResult });
    } catch (err) {
      return {
        decision: null,
        commit: null,
        error: {
          stage: "P5_04",
          message: "Safety evaluation failed",
          cause: err instanceof Error ? err : new Error(String(err)),
        },
      };
    }

    // ---- Stage 4: P5-05 Explanation / Audit Generation ----
    let explanationResult: P5ExplanationResult;
    try {
      explanationResult = this.explanationEvaluator.evaluate({
        decisionId: "", // will be set by producer
        candidateId: policyResult.selectedCandidate?.candidateId ?? null,
        actionId: policyResult.outcome === "SELECTED" ? "" : null,
        subject: { narrativeId },
        policyResult,
        safetyResult,
        decisionState: "DECIDED",
      });
    } catch (err) {
      return {
        decision: null,
        commit: null,
        error: {
          stage: "P5_05",
          message: "Explanation/audit evaluation failed",
          cause: err instanceof Error ? err : new Error(String(err)),
        },
      };
    }

    // ---- Stage 5: P5-10 Build + Commit ----
    const producerInput: P5ProducerInput = {
      subject: { narrativeId },
      policyResult,
      safetyResult,
      explanationResult,
    };

    let commitResult: P5CommitResult;
    try {
      commitResult = await this.producer.produce(producerInput);
    } catch (err) {
      return {
        decision: null,
        commit: null,
        error: {
          stage: "P5_10_BUILD",
          message: "Decision build/commit failed",
          cause: err instanceof Error ? err : new Error(String(err)),
        },
      };
    }

    return {
      decision: commitResult.decision,
      commit: commitResult,
      error: null,
    };
  }

  // -----------------------------------------------------------------------
  // P4 → P5-03 Input Mapping
  // -----------------------------------------------------------------------

  /**
   * Construct P5PolicyEvaluationInput from P4 snapshot.
   *
   * This mapping is deterministic:
   *  - Same P4 snapshot → same P5-03 input.
   *  - No invented values — only fields present in P4 are mapped.
   *  - Candidate is deterministic per narrativeId (V1 advisory MONITOR).
   */
  private buildPolicyInput(
    narrativeId: number,
    p4: P4DecisionSupportViewModel,
  ): P5PolicyEvaluationInput {
    // Build snapshot reference (AD-014) — mapped directly from P4 ViewModel
    const p4SnapshotRef: P5PolicySnapshotRef = {
      narrativeIdentity: p4.narrativeIdentity,
      asOf: p4.asOf,
      versionTuple: {
        algorithmVersion: p4.version.algorithmVersion,
        semanticVersion: p4.version.semanticVersion,
        signalCatalogVersion: p4.version.signalCatalogVersion,
        interpretationRuleVersion: "p4-03/v1",
      },
      status: p4.status,
    };

    // Deterministic V1 candidate per narrativeId
    const candidateId = `candidate-mon-${narrativeId}-v1`;

    return {
      policy: {
        policyId: P5_V1_POLICY_ID,
        policyVersion: P5_V1_POLICY_VERSION,
        effectiveAt: p4.generatedAt,
      },
      p4SnapshotRef,
      status: p4.status,
      direction: p4.direction,
      opportunity: p4.opportunity,
      risk: p4.risk,
      confidence: p4.confidence,
      actionability: p4.actionability,
      signalIds: p4.signals.map((s) => s.id),
      degradation: p4.degradation ?? null,
      candidate: {
        candidateId,
        actionType: "MONITOR",
        parameters: {},
        subject: { narrativeId },
      },
      declaredContext: {},
    };
  }
}
