import { describe, expect, it } from "@jest/globals";
import type { P4EvidenceReference, P4EvidenceValue } from "../../types";
import {
  CONFLICTING_EVIDENCE_LIMIT,
  CONTEXTUAL_EVIDENCE_LIMIT,
  PRIMARY_EVIDENCE_LIMIT,
  dedupeReferences,
  evidenceIdentityKey,
  filterIdentityCompatible,
  rankConflicting,
  rankContextual,
  rankSupporting,
  selectConflicting,
  selectContextual,
  selectSupporting,
} from "../evidence";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ref(overrides: Partial<P4EvidenceReference> = {}): P4EvidenceReference {
  return {
    sourceLayer: "P3",
    sourceType: "P3_ARTIFACT",
    sourceId: "10",
    artifactIdentity: "1|p3-orchestrator|1|observed|7D",
    narrativeIdentity: "1",
    windowOrDate: "2026-08-15T00:00:00.000Z",
    field: "momentumMove",
    status: "VALID",
    interpretationRole: "secondary",
    ...overrides,
  };
}

function val(overrides: Partial<P4EvidenceValue> = {}): P4EvidenceValue {
  return {
    clause: "Momentum is deteriorating",
    phrase: "deteriorating momentum",
    display: "−1.42",
    numericValue: -1.42,
    ...overrides,
  };
}

function valuesOf(refs: P4EvidenceReference[]): Record<string, P4EvidenceValue> {
  return Object.fromEntries(refs.map((r) => [evidenceIdentityKey(r), val({ numericValue: 1 })]));
}

// ---------------------------------------------------------------------------
// Identity key + dedup (P4-04 §4)
// ---------------------------------------------------------------------------

describe("evidence identity & deduplication (P4-04 §4)", () => {
  it("identity key covers the full evidence identity", () => {
    const a = ref();
    const b = ref({ interpretationRole: "conflicting" });
    expect(evidenceIdentityKey(a)).not.toBe(evidenceIdentityKey(b));
    expect(evidenceIdentityKey(a)).toBe(evidenceIdentityKey(ref()));
  });

  it("deduplicates by full identity; a deduped reference appears once", () => {
    const refs = [ref(), ref(), ref({ field: "breadthMove" })];
    const deduped = dedupeReferences(refs);
    expect(deduped).toHaveLength(2);
  });

  it("identity compatibility: different narrative excluded; P3 refs require artifact identity", () => {
    const compatible = ref();
    const otherNarrative = ref({ narrativeIdentity: "2" });
    const p3WithoutArtifact = ref({ artifactIdentity: null });
    const p2Ref = ref({ artifactIdentity: null, sourceLayer: "P2", sourceType: "P2_EVENT_RISK", sourceId: "evt-1" });
    const filtered = filterIdentityCompatible([compatible, otherNarrative, p3WithoutArtifact, p2Ref], 1);
    // Only the same-narrative P3 ref (with identity) and the P2 ref (no artifact identity needed) pass.
    expect(filtered.map((r) => evidenceIdentityKey(r)).sort()).toEqual(
      [evidenceIdentityKey(compatible), evidenceIdentityKey(p2Ref)].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Ranking precedence (P4-04 §5)
// ---------------------------------------------------------------------------

describe("supporting ranking — ordered precedence, no weights (P4-04 §5)", () => {
  it("Tier 1 direct driver (primary) ranks above Tier 2 corroborator (secondary)", () => {
    const primary = ref({ interpretationRole: "primary", sourceId: "10" });
    const secondary = ref({ interpretationRole: "secondary", sourceId: "9" });
    const ranked = rankSupporting([secondary, primary], {});
    expect(ranked[0]).toBe(primary);
  });

  it("Tier 3 current relevance: latest window first within the same tier", () => {
    const newer = ref({ sourceId: "10", windowOrDate: "2026-08-15T00:00:00.000Z" });
    const older = ref({ sourceId: "9", windowOrDate: "2026-08-13T00:00:00.000Z" });
    const ranked = rankSupporting([older, newer], {});
    expect(ranked[0]).toBe(newer);
  });

  it("Tier 4 explanatory value: largest |delta| first among Tier-1/2 candidates", () => {
    const big = ref({ sourceId: "10", field: "rotationScoreMove" });
    const small = ref({ sourceId: "9", field: "momentumMove" });
    const values = {
      [evidenceIdentityKey(big)]: val({ numericValue: -11 }),
      [evidenceIdentityKey(small)]: val({ numericValue: -1.4 }),
    };
    const ranked = rankSupporting([small, big], values);
    expect(ranked[0]).toBe(big);
  });

  it("Tier 5 provenance: VALID before PARTIAL", () => {
    const valid = ref({ sourceId: "10", status: "VALID" });
    const partial = ref({ sourceId: "9", status: "PARTIAL" });
    const ranked = rankSupporting([partial, valid], {});
    expect(ranked[0]).toBe(valid);
  });

  it("tie-breaks: P3 before P2, then sourceType, then sourceId asc", () => {
    const p2 = ref({ sourceLayer: "P2", sourceType: "P2_EVENT_RISK", sourceId: "evt-1", artifactIdentity: null });
    const p3 = ref({ sourceId: "10" });
    const p3Other = ref({ sourceId: "9" });
    const ranked = rankSupporting([p2, p3Other, p3], {});
    expect(ranked.map((r) => r.sourceId)).toEqual(["9", "10", "evt-1"]);
  });

  it("STALE/INVALID evidence is excluded from the supporting pool", () => {
    const valid = ref({ sourceId: "10", status: "VALID" });
    const stale = ref({ sourceId: "9", status: "STALE" });
    const invalid = ref({ sourceId: "8", status: "INVALID" });
    const ranked = rankSupporting([stale, valid, invalid], {});
    expect(ranked.map((r) => r.sourceId)).toEqual(["10"]);
  });

  it("STALE evidence may appear in the contextual pool (never as supporting)", () => {
    const stale = ref({ sourceId: "9", status: "STALE" });
    const contextual = ref({ sourceId: "10", interpretationRole: "contextual" });
    const pool = rankContextual([stale, contextual]);
    expect(pool.map((r) => r.sourceId).sort()).toEqual(["10", "9"]);
  });

  it("conflicting ranking keeps the strongest opposing evidence first", () => {
    const strong = ref({ sourceId: "10", interpretationRole: "conflicting" });
    const weak = ref({ sourceId: "9", interpretationRole: "conflicting" });
    const values = {
      [evidenceIdentityKey(strong)]: val({ numericValue: -0.08 }),
      [evidenceIdentityKey(weak)]: val({ numericValue: -0.01 }),
    };
    const ranked = rankConflicting([weak, strong], values);
    expect(ranked[0]).toBe(strong);
  });
});

// ---------------------------------------------------------------------------
// Presentation limits (P4-04 §4 — never change the P4-03 result)
// ---------------------------------------------------------------------------

describe("selection limits (frozen presentation bounds)", () => {
  it("primary ≤ 3, conflicting ≤ 2, contextual ≤ 2", () => {
    expect(PRIMARY_EVIDENCE_LIMIT).toBe(3);
    expect(CONFLICTING_EVIDENCE_LIMIT).toBe(2);
    expect(CONTEXTUAL_EVIDENCE_LIMIT).toBe(2);
  });

  it("selectSupporting truncates from the lowest-ranked items", () => {
    const refs = [ref({ sourceId: "1" }), ref({ sourceId: "2" }), ref({ sourceId: "3" }), ref({ sourceId: "4" })];
    expect(selectSupporting(refs)).toHaveLength(3);
    expect(selectSupporting(refs)[2].sourceId).toBe("3");
  });

  it("selection helpers respect their per-role limits", () => {
    const conflicting = [ref({ sourceId: "1" }), ref({ sourceId: "2" }), ref({ sourceId: "3" })];
    const contextual = [ref({ sourceId: "1" }), ref({ sourceId: "2" }), ref({ sourceId: "3" })];
    expect(selectConflicting(conflicting)).toHaveLength(2);
    expect(selectContextual(contextual)).toHaveLength(2);
  });

  it("limit enforcement is deterministic for identical input", () => {
    const refs = [ref({ sourceId: "1" }), ref({ sourceId: "2" }), ref({ sourceId: "3" }), ref({ sourceId: "4" })];
    const a = selectSupporting(refs).map((r) => r.sourceId);
    const b = selectSupporting(refs).map((r) => r.sourceId);
    expect(a).toEqual(b);
  });
});

describe("values resolver (Alternative B — humanValue NOT on EvidenceReference)", () => {
  it("resolved values are keyed by full evidence identity, outside the reference", () => {
    const momentum = ref({ field: "momentumMove" });
    const breadth = ref({ field: "breadthMove" });
    const values = {
      [evidenceIdentityKey(momentum)]: val({ clause: "Momentum is deteriorating", numericValue: -1.4 }),
      [evidenceIdentityKey(breadth)]: val({ clause: "Breadth is narrowing", numericValue: -0.14 }),
    };
    expect(values[evidenceIdentityKey(momentum)]?.clause).toBe("Momentum is deteriorating");
    expect(values[evidenceIdentityKey(breadth)]?.clause).toBe("Breadth is narrowing");
    // The reference itself never carries a display value.
    expect("humanValue" in momentum).toBe(false);
  });
});
