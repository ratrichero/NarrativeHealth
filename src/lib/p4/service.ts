import type {
  P4DecisionSupportViewModel,
  P4EvidenceReference,
  P4ExplanationResult,
  P4FiredSignal,
  P4InterpretationResult,
  P4Signal,
  P4SignalId,
  P4ViewModelStatus,
} from "./types";
import {
  P4_ALGORITHM_VERSION,
  P4_SEMANTIC_VERSION,
} from "./types";
import { loadP4Evidence, type P4Assembly } from "./assembler";
import { interpretP4 } from "./interpretation";
import { buildExplanation } from "./explanation/engine";
import { evidenceIdentityKey } from "./explanation/evidence";

/**
 * P4 Decision Support read service (P4-05A).
 *
 * `getP4DecisionSupport(narrativeId)` assembles persisted P3 intelligence,
 * P3 historical context and approved P2 Event Risk into the read-time derived
 * P4DecisionSupportViewModel (P4-02 §8). The service orchestrates only: all
 * evidence comes from the existing P3 read services and persisted rows, the
 * interpretation is the frozen P4-03 engine, the explanation is the existing
 * P4-04 engine.
 *
 * READ-TIME DERIVATION (P4-02 §8): no persistence, no writes, no cache, no
 * database mutation.
 *
 * FAILURE ISOLATION (P4-02 §9/§10): any load error, identity rejection or
 * unexpected failure yields `null` — a P4 failure never crashes the narrative
 * API and never affects P3 data.
 */

export const P4_SIGNAL_CATALOG_VERSION = "v1";

/** Signal display labels (P4-04 §10 — deterministic, from the frozen catalog). */
export const P4_SIGNAL_LABELS: Record<P4SignalId, string> = {
  NARRATIVE_IMPROVEMENT: "Narrative improvement",
  NARRATIVE_DETERIORATION: "Narrative deterioration",
  BROADENING: "Breadth broadening",
  NARROWING: "Breadth narrowing",
  LEADERSHIP_CHANGE: "Leadership change",
  REGIME_CHANGE: "Regime change",
  ROTATION_CHANGE: "Rotation change",
  EVIDENCE_CONFLICT: "Evidence conflict",
};

/** Map the P4-03 result + P4-04 explanation into the frozen ViewModel (P4-02 §8). */
export function toViewModel(
  assembly: P4Assembly,
  interpretation: P4InterpretationResult,
  explanation: P4ExplanationResult
): P4DecisionSupportViewModel {
  const byKey = new Map<string, P4EvidenceReference>(
    interpretation.evidence.map((ref) => [evidenceIdentityKey(ref), ref])
  );

  const signals: P4Signal[] = interpretation.signals.map((signal: P4FiredSignal) => ({
    id: signal.id,
    label: P4_SIGNAL_LABELS[signal.id],
    directionRelation: signal.directionRelation ?? interpretation.direction,
    ...(signal.severity ? { severity: signal.severity } : {}),
    evidenceRefs: [
      ...(signal.evidenceKeys ?? []),
      ...(signal.conflictingEvidenceKeys ?? []),
    ]
      .map((key) => byKey.get(key))
      .filter((ref): ref is P4EvidenceReference => ref != null),
  }));

  const { history } = assembly;
  const status: P4ViewModelStatus = interpretation.status === "DEGRADED" ? "DEGRADED" : "OK";

  return {
    status,
    version: {
      algorithmVersion: P4_ALGORITHM_VERSION,
      semanticVersion: P4_SEMANTIC_VERSION,
      signalCatalogVersion: P4_SIGNAL_CATALOG_VERSION,
    },
    narrativeIdentity: assembly.identity,
    generatedAt: explanation.generatedAt,
    asOf: assembly.current.windowEnd,
    direction: interpretation.direction,
    signals,
    opportunity: interpretation.opportunity,
    risk: interpretation.risk,
    confidence: interpretation.confidence,
    actionability: interpretation.actionability,
    explanation,
    evidence: interpretation.evidence,
    historicalContext: {
      seriesLength: history.series.length,
      steps: history.steps.length,
      overallTrend: history.trend.overall,
      dataSufficiency: history.dataSufficiency,
      current: history.current
        ? {
            artifactId: history.current.artifactId,
            windowEnd: history.current.windowEnd,
            availabilityState: history.current.availabilityState,
          }
        : null,
      previous: history.previous
        ? {
            artifactId: history.previous.artifactId,
            windowEnd: history.previous.windowEnd,
            availabilityState: history.previous.availabilityState,
          }
        : null,
    },
    provenance: {
      sourceLayer: "P4",
      derivedFrom: history.series.map((artifact) => String(artifact.artifactId)),
      p2EventRisk: assembly.p2.scope !== "none",
      semanticVersion: P4_SEMANTIC_VERSION,
    },
    degradation: interpretation.degradation,
  };
}

/**
 * Read the P4 Decision Support ViewModel for a narrative.
 *
 * Returns `null` (never throws) for: no VALID P3 evidence, incompatible
 * identity, an unavailable interpretation, or any load/interpretation
 * failure — the P4-02 §10 mandatory reliability rule.
 */
export async function getP4DecisionSupport(narrativeId: number): Promise<P4DecisionSupportViewModel | null> {
  try {
    const loaded = await loadP4Evidence(narrativeId);
    if (!loaded.ok) {
      if (loaded.reason === "IDENTITY_MISMATCH") {
        // Rejected per P4-02 §7 — the evidence cannot be interpreted safely.
        console.error(`P4 Decision Support rejected for narrative ${narrativeId}: ${loaded.detail}`);
      }
      return null;
    }

    const interpretation = interpretP4(loaded.assembly);
    if (interpretation.status === "UNAVAILABLE") return null;

    const explanation = buildExplanation(interpretation);
    return toViewModel(loaded.assembly, interpretation, explanation);
  } catch (error) {
    console.error(`P4 Decision Support read failed for narrative ${narrativeId}:`, error);
    return null;
  }
}
