import { buildExplanation } from "../engine";
import { evidenceIdentityKey } from "../evidence";
import { BANNED_PHRASES } from "../templates";
import type {
  P4DirectionState,
  P4EvidenceReference,
  P4EvidenceValue,
  P4ExplanationItem,
  P4ExplanationResult,
  P4FiredSignal,
  P4InterpretationResult,
  P4QualitativeValue,
  P4EventScope,
} from "../../types";
import type { P3TrendState } from "@/lib/types/p3-intelligence-history";

/**
 * P4-04 §22 — semantic (not implementation) tests for the Explanation / Why
 * Engine. Every case mirrors a frozen canonical example (E1–E10) or a frozen
 * selection rule (§4, §7, §8, §11, §12, §15, §20, §21).
 *
 * Determinism: statements are asserted EXACTLY — same input ⇒ same text.
 * `generatedAt` is metadata-only and is excluded from semantic equality.
 */

const ARTIFACT = "narrative=1|7D|p3-orchestrator|v1|observed";
const WINDOW = "2026-08-16";
const PREV_WINDOW = "2026-08-09";

function ref(field: string, overrides: Partial<P4EvidenceReference> = {}): P4EvidenceReference {
  return {
    sourceLayer: "P3",
    sourceType: "P3_INTELLIGENCE",
    sourceId: "12",
    artifactIdentity: ARTIFACT,
    narrativeIdentity: "1",
    windowOrDate: WINDOW,
    field,
    status: "VALID",
    interpretationRole: "primary",
    ...overrides,
  };
}

function key(r: P4EvidenceReference): string {
  return evidenceIdentityKey(r);
}

function val(
  clause: string,
  phrase: string,
  display: string,
  numericValue: number | null = null,
  scope?: P4EventScope
): P4EvidenceValue {
  const value: P4EvidenceValue = { clause, phrase, display };
  if (numericValue !== null) value.numericValue = numericValue;
  if (scope) value.scope = scope;
  return value;
}

interface InputOpts {
  refs: P4EvidenceReference[];
  values?: Record<string, P4EvidenceValue>;
  direction?: P4DirectionState;
  opportunity?: P4QualitativeValue;
  risk?: P4QualitativeValue;
  confidence?: P4QualitativeValue;
  actionability?: P4QualitativeValue;
  signals?: P4FiredSignal[];
  degradation?: P4InterpretationResult["degradation"];
  historicalTrend?: P3TrendState | null;
  dataSufficiency?: P4InterpretationResult["context"]["dataSufficiency"];
  p2Expected?: boolean;
  conclusionEvidence?: P4InterpretationResult["conclusionEvidence"];
  status?: P4InterpretationResult["status"];
}

function input(opts: InputOpts): P4InterpretationResult {
  return {
    status: opts.status ?? "AVAILABLE",
    narrativeId: 1,
    windowEnd: WINDOW,
    direction: opts.direction ?? "POSITIVE",
    opportunity: opts.opportunity ?? "MEDIUM",
    risk: opts.risk ?? "MEDIUM",
    confidence: opts.confidence ?? "MEDIUM",
    actionability: opts.actionability ?? "MEDIUM",
    signals: opts.signals ?? [],
    evidence: opts.refs,
    values: opts.values ?? {},
    context: {
      historicalTrend: opts.historicalTrend ?? null,
      dataSufficiency: opts.dataSufficiency ?? null,
      p2Expected: opts.p2Expected ?? false,
    },
    degradation: opts.degradation ?? [],
    ...(opts.conclusionEvidence ? { conclusionEvidence: opts.conclusionEvidence } : {}),
  };
}

function semanticSnapshot(result: P4ExplanationResult): string {
  return JSON.stringify({
    items: result.items.map((i) => ({
      id: i.id,
      statement: i.statement,
      role: i.role,
      supporting: i.supportingEvidence.map(evidenceIdentityKey),
      conflicting: i.conflictingEvidence.map(evidenceIdentityKey),
      contextual: i.contextualEvidence.map(evidenceIdentityKey),
      severity: i.severity ?? null,
      sourceReferences: i.sourceReferences,
      versions: [i.semanticVersion, i.algorithmVersion, i.explanationVersion],
    })),
    attribution: result.attribution,
  });
}

function allEvidence(item: P4ExplanationItem): P4EvidenceReference[] {
  return [...item.supportingEvidence, ...item.conflictingEvidence, ...item.contextualEvidence];
}

describe("P4-04 Explanation Engine — canonical examples (P4-04 §18)", () => {
  test("E1 — strong broad narrative: narrative signal + corroborating signals", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove");
    const breadth = ref("breadthMove");
    const regimePrev = ref("regime.previous", { sourceId: "11", windowOrDate: PREV_WINDOW });
    const regimeCurr = ref("regime.current");
    const result = buildExplanation(
      input({
        refs: [trend, momentum, breadth, regimePrev, regimeCurr],
        values: {
          [key(trend)]: val("overall trend is improving", "an improving trend", "IMPROVING"),
          [key(momentum)]: val("momentum is positive", "positive momentum", "POSITIVE", 2.4),
          [key(breadth)]: val("breadth is broadening", "broadening breadth", "BROADENING", 1.8),
          [key(regimePrev)]: val("regime was NEUTRAL", "NEUTRAL regime", "NEUTRAL"),
          [key(regimeCurr)]: val("regime is STRONG", "STRONG regime", "STRONG"),
        },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "HIGH",
        signals: [
          { id: "NARRATIVE_IMPROVEMENT", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(trend), key(momentum)] },
          { id: "REGIME_CHANGE", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(regimePrev), key(regimeCurr)] },
          { id: "BROADENING", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(breadth)] },
        ],
        historicalTrend: "IMPROVING",
        dataSufficiency: { comparableArtifacts: 4, requiredMinimum: 2, sufficient: true },
        conclusionEvidence: { direction: [key(trend), key(momentum)] },
      })
    );

    expect(result.items.map((i) => i.statement)).toEqual([
      "Narrative is improving: overall trend is improving with positive momentum.",
      "Regime moved from NEUTRAL to STRONG.",
      "Participation is broadening: breadth increased.",
    ]);
    expect(result.items[0].role).toBe("primary");
    expect(result.items[0].supportingEvidence.map((r) => r.field)).toEqual(["trend.overall", "momentumMove"]);
    expect(result.items[0].conflictingEvidence).toHaveLength(0);
    // Every material item carries ≥1 evidence reference (P4-04 §3.1).
    for (const item of result.items) expect(item.supportingEvidence.length).toBeGreaterThan(0);
    // Traceability: artifact identity is referenced (P4-04 §3.1 / §13).
    expect(result.items[0].sourceReferences).toContain(ARTIFACT);
  });

  test("E3 — clear deterioration with regime + narrowing signals", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove", { status: "PARTIAL" });
    const breadth = ref("breadthMove");
    const regimePrev = ref("regime.previous", { sourceId: "11", windowOrDate: PREV_WINDOW });
    const regimeCurr = ref("regime.current");
    const result = buildExplanation(
      input({
        refs: [trend, momentum, breadth, regimePrev, regimeCurr],
        values: {
          [key(trend)]: val("overall trend is deteriorating", "deteriorating trend", "DETERIORATING", -3.0),
          [key(momentum)]: val("momentum is deteriorating", "negative momentum", "NEGATIVE", -2.6),
          [key(breadth)]: val("breadth is narrowing", "narrowing breadth", "NARROWING", -1.2),
          [key(regimePrev)]: val("regime was NEUTRAL", "NEUTRAL regime", "NEUTRAL"),
          [key(regimeCurr)]: val("regime is WEAKENING", "WEAKENING regime", "WEAKENING"),
        },
        direction: "NEGATIVE",
        opportunity: "LOW",
        risk: "HIGH",
        confidence: "MEDIUM",
        actionability: "HIGH",
        signals: [
          { id: "NARRATIVE_DETERIORATION", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(trend), key(momentum)] },
          { id: "REGIME_CHANGE", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(regimePrev), key(regimeCurr)] },
          { id: "NARROWING", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(breadth)] },
        ],
        historicalTrend: "DETERIORATING",
      })
    );

    expect(result.items.map((i) => i.statement)).toEqual([
      "Narrative is weakening: overall trend is deteriorating with negative momentum.",
      "Regime moved from NEUTRAL to WEAKENING.",
      "Participation is narrowing: breadth declined.",
      "Confidence is moderate: evidence is partially available.",
    ]);
    expect(result.items[3].role).toBe("caveat");
  });

  test("E4 — weakening with positive relative strength: conflict kept visible", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove");
    const rotation = ref("rotationMove");
    const rs = ref("relativeStrengthMove", { interpretationRole: "conflicting" });
    const result = buildExplanation(
      input({
        refs: [trend, momentum, rotation, rs],
        values: {
          [key(trend)]: val("overall trend is deteriorating", "deteriorating trend", "DETERIORATING", -3.0),
          [key(momentum)]: val("momentum is deteriorating", "deteriorating momentum", "NEGATIVE", -2.6),
          [key(rotation)]: val("rotation is deteriorating", "deteriorating rotation", "NEGATIVE", -2.1),
          [key(rs)]: val("relative strength is improving", "improving relative strength", "POSITIVE", 1.9),
        },
        direction: "NEGATIVE",
        opportunity: "LOW",
        risk: "HIGH",
        confidence: "MEDIUM",
        actionability: "HIGH",
        signals: [
          {
            id: "NARRATIVE_DETERIORATION",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(trend), key(momentum), key(rotation)],
          },
          {
            id: "EVIDENCE_CONFLICT",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(rotation), key(momentum)],
            conflictingEvidenceKeys: [key(rs)],
            severity: "low",
          },
        ],
      })
    );

    expect(result.items[0].statement).toBe(
      "Narrative is weakening: overall trend is deteriorating with deteriorating momentum and deteriorating rotation."
    );
    // Both sides of the conflict are rendered with their own references (§7).
    const conflictItem = result.items.find((i) => i.id.startsWith("exp:signal:EVIDENCE_CONFLICT"));
    expect(conflictItem).toBeDefined();
    expect(conflictItem!.statement).toBe("Rotation is deteriorating, while relative strength is improving.");
    expect(conflictItem!.conflictingEvidence.map((r) => r.field)).toEqual(["relativeStrengthMove"]);
    expect(conflictItem!.severity).toBe("low");
    // Confidence limitation grounded in the actual conflict (not fabricated).
    expect(result.items[result.items.length - 1].statement).toBe("Confidence is moderate: evidence is conflicting.");
    expect(result.items[result.items.length - 1].supportingEvidence.map((r) => r.field)).toEqual(["relativeStrengthMove"]);
  });

  test("E5 — neutral: direction statement + stable-trend context", () => {
    const trend = ref("trend.overall");
    const result = buildExplanation(
      input({
        refs: [trend],
        values: { [key(trend)]: val("overall trend is stable", "stable trend", "STABLE") },
        direction: "NEUTRAL",
        opportunity: "LOW",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "LOW",
        historicalTrend: "STABLE",
        conclusionEvidence: { direction: [key(trend)] },
      })
    );

    expect(result.items[0].statement).toBe("Direction is neutral: evidence shows no material change.");
    expect(result.items[1].role).toBe("contextual");
    expect(result.items[1].statement).toBe("Historical trend is stable.");
  });

  test("E6 — mixed evidence: both sides rendered explicitly with references", () => {
    const momentum = ref("momentumMove");
    const rotation = ref("rotationMove");
    const result = buildExplanation(
      input({
        refs: [momentum, rotation],
        values: {
          [key(momentum)]: val("momentum is improving", "improving momentum", "POSITIVE", 2.0),
          [key(rotation)]: val("rotation is deteriorating", "deteriorating rotation", "NEGATIVE", -2.4),
        },
        direction: "MIXED",
        opportunity: "LOW",
        risk: "MEDIUM",
        confidence: "MEDIUM",
        actionability: "MEDIUM",
        signals: [
          {
            id: "EVIDENCE_CONFLICT",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(momentum)],
            conflictingEvidenceKeys: [key(rotation)],
            severity: "medium",
          },
        ],
      })
    );

    expect(result.items[0].statement).toBe("Direction is mixed: momentum is improving while rotation is deteriorating.");
    expect(result.items[0].supportingEvidence.map((r) => r.field)).toEqual(["momentumMove"]);
    expect(result.items[0].conflictingEvidence.map((r) => r.field)).toEqual(["rotationMove"]);
  });

  test("E7 — UNKNOWN from insufficient history: degraded summary + single-artifact caveat", () => {
    const trend = ref("trend.overall");
    const result = buildExplanation(
      input({
        refs: [trend],
        values: { [key(trend)]: val("overall trend is stable", "stable trend", "STABLE") },
        direction: "UNKNOWN",
        opportunity: "UNKNOWN",
        risk: "UNKNOWN",
        confidence: "LOW",
        actionability: "UNKNOWN",
        status: "DEGRADED",
        degradation: [{ code: "INSUFFICIENT_HISTORY" }],
        dataSufficiency: { comparableArtifacts: 1, requiredMinimum: 2, sufficient: false },
      })
    );

    expect(result.items[0].statement).toBe(
      "Direction is unavailable because historical evidence is insufficient to support the required interpretation."
    );
    expect(result.items[0].supportingEvidence.map((r) => r.field)).toEqual(["trend.overall"]);
    expect(result.items[1].role).toBe("caveat");
    expect(result.items[1].statement).toBe("Only one same-identity artifact is available.");
    expect(result.items[1].supportingEvidence.map((r) => r.field)).toEqual(["trend.overall"]);
  });

  test("E8 — stale data: caveat references the stale evidence; stale never supports", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove", { status: "STALE" });
    const result = buildExplanation(
      input({
        refs: [trend, momentum],
        values: {
          [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
          [key(momentum)]: val("momentum is positive", "positive momentum", "POSITIVE", 2.2),
        },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "MEDIUM",
        actionability: "HIGH",
        degradation: [{ code: "STALE" }],
        dataSufficiency: { comparableArtifacts: 4, requiredMinimum: 2, sufficient: true },
        conclusionEvidence: { direction: [key(trend), key(momentum)] },
      })
    );

    expect(result.items[0].statement).toBe("Direction is positive: overall trend is improving.");
    // STALE evidence must not support a primary statement (P4-04 §4); it may
    // only appear as caveat evidence with its status shown.
    for (const item of result.items) {
      if (item.role === "caveat") continue;
      expect(item.supportingEvidence.map((r) => r.field)).not.toContain("momentumMove");
    }
    expect(result.items[1].statement).toBe("Confidence is limited because required evidence is stale.");
    expect(result.items[1].supportingEvidence.map((r) => r.field)).toEqual(["momentumMove"]);
    expect(result.items[1].supportingEvidence[0].status).toBe("STALE");
  });

  test("E9 — coin-local P2 event risk: scope preserved, narrative risk never inflated", () => {
    const trend = ref("trend.overall");
    const p2 = ref("eventRisk", {
      sourceLayer: "P2",
      sourceType: "P2_EVENT_RISK",
      sourceId: "event-41",
      artifactIdentity: null,
      windowOrDate: "2026-08-15",
      interpretationRole: "contextual",
    });
    const result = buildExplanation(
      input({
        refs: [trend, p2],
        values: {
          [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
          [key(p2)]: val("a high event-risk signal affects BTC", "event risk on BTC", "HIGH", null, {
            kind: "coin-local",
            symbols: ["BTC"],
            riskLevel: "HIGH",
          }),
        },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "HIGH",
        p2Expected: true,
      })
    );

    const contextItem = result.items.find((i) => i.role === "contextual");
    expect(contextItem).toBeDefined();
    expect(contextItem!.statement).toBe("A high event-risk signal affects one tracked constituent (BTC).");
    expect(contextItem!.supportingEvidence[0].sourceLayer).toBe("P2");
    expect(contextItem!.supportingEvidence[0].sourceType).toBe("P2_EVENT_RISK");
    // P2 alone never becomes "the narrative is high risk".
    expect(result.items.map((i) => i.statement).join(" ")).not.toMatch(/narrative is high risk/i);
  });

  test("E10 — narrative-wide P2 event risk", () => {
    const trend = ref("trend.overall");
    const p2 = ref("eventRisk", {
      sourceLayer: "P2",
      sourceType: "P2_EVENT_RISK",
      sourceId: "event-42",
      artifactIdentity: null,
      interpretationRole: "contextual",
    });
    const result = buildExplanation(
      input({
        refs: [trend, p2],
        values: {
          [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
          [key(p2)]: val("a narrative-wide event-risk signal is active", "narrative-wide event risk", "HIGH", null, {
            kind: "narrative-wide",
            riskLevel: "HIGH",
          }),
        },
        direction: "POSITIVE",
        opportunity: "MEDIUM",
        risk: "MEDIUM",
        confidence: "HIGH",
        actionability: "MEDIUM",
      })
    );

    const contextItem = result.items.find((i) => i.role === "contextual");
    expect(contextItem!.statement).toBe("A narrative-wide event-risk signal is active.");
  });

  test("P2 multi-coin scope counts the referenced events", () => {
    const trend = ref("trend.overall");
    const p2a = ref("eventRisk.a", {
      sourceLayer: "P2",
      sourceType: "P2_EVENT_RISK",
      sourceId: "event-43",
      artifactIdentity: null,
      interpretationRole: "contextual",
    });
    const p2b = ref("eventRisk.b", {
      sourceLayer: "P2",
      sourceType: "P2_EVENT_RISK",
      sourceId: "event-44",
      artifactIdentity: null,
      interpretationRole: "contextual",
    });
    const result = buildExplanation(
      input({
        refs: [trend, p2a, p2b],
        values: {
          [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
          [key(p2a)]: val("a high event-risk signal affects BTC and ETH", "event risk on BTC/ETH", "HIGH", null, {
            kind: "multi-coin",
            symbols: ["BTC", "ETH"],
            riskLevel: "HIGH",
          }),
          [key(p2b)]: val("a high event-risk signal affects SOL and AVAX", "event risk on SOL/AVAX", "HIGH", null, {
            kind: "multi-coin",
            symbols: ["SOL", "AVAX"],
            riskLevel: "HIGH",
          }),
        },
        direction: "POSITIVE",
        opportunity: "MEDIUM",
        risk: "MEDIUM",
        confidence: "HIGH",
        actionability: "MEDIUM",
      })
    );

    const contextItem = result.items.find((i) => i.role === "contextual");
    expect(contextItem!.statement).toBe("High event-risk signals affect 2 tracked constituents.");
    expect(contextItem!.supportingEvidence).toHaveLength(2);
  });
});

describe("P4-04 Explanation Engine — selection rules (§4, §5, §7, §8)", () => {
  test("presentation limits: primary ≤ 3, conflicting ≤ 2, contextual ≤ 2, total ≤ 6", () => {
    const primaryRefs = [1, 2, 3, 4, 5].map((n) => ref(`metric.f${n}`, { sourceId: String(10 + n) }));
    const conflictRefs = [1, 2, 3, 4].map((n) =>
      ref(`conflict.c${n}`, { sourceId: String(20 + n), interpretationRole: "conflicting" })
    );
    const p2Refs = [1, 2, 3].map((n) =>
      ref(`eventRisk.e${n}`, {
        sourceLayer: "P2",
        sourceType: "P2_EVENT_RISK",
        sourceId: `event-${n}`,
        artifactIdentity: null,
        interpretationRole: "contextual",
      })
    );
    const values: Record<string, P4EvidenceValue> = {};
    for (const r of [...primaryRefs, ...conflictRefs]) values[key(r)] = val(`evidence ${r.field}`, r.field, "POSITIVE", 1);
    for (const r of p2Refs) {
      values[key(r)] = val(`event risk ${r.field}`, r.field, "HIGH", null, { kind: "narrative-wide" });
    }

    const result = buildExplanation(
      input({
        refs: [...primaryRefs, ...conflictRefs, ...p2Refs],
        values,
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "HIGH",
        dataSufficiency: { comparableArtifacts: 4, requiredMinimum: 2, sufficient: true },
        conclusionEvidence: { direction: primaryRefs.map(key) },
      })
    );

    expect(result.items.length).toBeLessThanOrEqual(6);
    for (const item of result.items) {
      expect(item.supportingEvidence.length).toBeLessThanOrEqual(3);
      expect(item.conflictingEvidence.length).toBeLessThanOrEqual(2);
      expect(item.contextualEvidence.length).toBeLessThanOrEqual(2);
    }
    // Summary is capped at 3 primary refs even though 5 were recorded.
    expect(result.items[0].supportingEvidence).toHaveLength(3);
    // Standalone conflicts capped at 2 items.
    expect(result.items.filter((i) => i.role === "conflicting")).toHaveLength(2);
    // Contextual capped at 2 items.
    expect(result.items.filter((i) => i.role === "contextual").length).toBeLessThanOrEqual(2);
  });

  test("deduplication: a reference appears once per item", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove");
    const result = buildExplanation(
      input({
        refs: [trend, momentum, trend],
        values: {
          [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
          [key(momentum)]: val("momentum is positive", "positive momentum", "POSITIVE", 2.2),
        },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "HIGH",
        signals: [
          {
            id: "NARRATIVE_IMPROVEMENT",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(trend), key(trend), key(momentum)],
          },
        ],
      })
    );

    for (const item of result.items) {
      const all = allEvidence(item);
      expect(new Set(all.map(evidenceIdentityKey)).size).toBe(all.length);
    }
  });

  test("identity isolation: cross-narrative and artifact-less P3 refs are excluded", () => {
    const trend = ref("trend.overall");
    const otherNarrative = ref("trend.overall", { narrativeIdentity: "2", sourceId: "99" });
    const noArtifact = ref("momentumMove", { artifactIdentity: null, sourceId: "98" });
    const result = buildExplanation(
      input({
        refs: [trend, otherNarrative, noArtifact],
        values: {
          [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
          [key(otherNarrative)]: val("foreign evidence", "foreign", "POSITIVE", 9.9),
          [key(noArtifact)]: val("orphan evidence", "orphan", "POSITIVE", 8.8),
        },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "HIGH",
        dataSufficiency: { comparableArtifacts: 4, requiredMinimum: 2, sufficient: true },
        conclusionEvidence: { direction: [key(trend), key(otherNarrative), key(noArtifact)] },
      })
    );

    const referenced = result.items.flatMap(allEvidence);
    expect(referenced.some((r) => r.narrativeIdentity === "2")).toBe(false);
    expect(referenced.some((r) => r.artifactIdentity === null && r.sourceLayer === "P3")).toBe(false);
    expect(result.items[0].statement).toBe("Direction is positive: overall trend is improving.");
  });

  test("INVALID evidence never supports a statement", () => {
    const trend = ref("trend.overall");
    const breadth = ref("breadthMove", { status: "INVALID" });
    const result = buildExplanation(
      input({
        refs: [trend, breadth],
        values: {
          [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
          [key(breadth)]: val("breadth is broadening", "broadening breadth", "BROADENING", 1.8),
        },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "HIGH",
        signals: [{ id: "BROADENING", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(breadth)] }],
      })
    );

    for (const item of result.items) {
      expect(item.supportingEvidence.map((r) => r.status)).not.toContain("INVALID");
    }
  });

  test("historical divergence context: POSITIVE current vs DETERIORATING trend (Direction unchanged)", () => {
    const trend = ref("trend.overall");
    const result = buildExplanation(
      input({
        refs: [trend],
        values: { [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4) },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "MEDIUM",
        actionability: "HIGH",
        historicalTrend: "DETERIORATING",
        dataSufficiency: { comparableArtifacts: 4, requiredMinimum: 2, sufficient: true },
      })
    );

    const contextItem = result.items.find((i) => i.role === "contextual");
    expect(contextItem!.statement).toBe(
      "Current conditions are positive, although historical trend remains deteriorating."
    );
    // Confidence limitation grounded in the historical divergence.
    const caveat = result.items.find((i) => i.role === "caveat");
    expect(caveat!.statement).toBe("Confidence is moderate: historical trend conflicts with current evidence.");
  });

  test("degraded reason mapping for every P4-03 degradation code", () => {
    const trend = ref("trend.overall");
    const cases: Array<[P4InterpretationResult["degradation"][number]["code"], string]> = [
      ["NO_VALID_CURRENT", "No valid P3 intelligence artifact is available for this narrative."],
      [
        "INSUFFICIENT_HISTORY",
        "Direction is unavailable because historical evidence is insufficient to support the required interpretation.",
      ],
      ["CRITICAL_EVIDENCE_MISSING", "Direction is unavailable because critical evidence (momentum) is unavailable."],
      ["INVALID", "Interpretation is unavailable because momentum evidence is INVALID."],
      ["AMBIGUOUS", "Interpretation is unavailable because momentum evidence is AMBIGUOUS."],
      ["IDENTITY_AMBIGUOUS", "Interpretation is unavailable because evidence identity is ambiguous."],
      ["STALE", "Confidence is limited because required evidence is stale."],
      ["P2_UNAVAILABLE", "Event-risk evidence is unavailable; structural narrative evidence remains available."],
    ];
    for (const [code, expected] of cases) {
      const result = buildExplanation(
        input({
          refs: [trend],
          values: { [key(trend)]: val("overall trend is stable", "stable trend", "STABLE") },
          direction: "UNKNOWN",
          opportunity: "UNKNOWN",
          risk: "UNKNOWN",
          confidence: "LOW",
          actionability: "UNKNOWN",
          status: "DEGRADED",
          degradation: [{ code, field: "momentum" }],
          dataSufficiency: { comparableArtifacts: 1, requiredMinimum: 2, sufficient: false },
        })
      );
      expect(result.items[0].statement).toBe(expected);
    }
  });

  test("P2 expected but unavailable: caveat, structural evidence still explained", () => {
    const trend = ref("trend.overall");
    const result = buildExplanation(
      input({
        refs: [trend],
        values: { [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4) },
        direction: "POSITIVE",
        opportunity: "HIGH",
        risk: "LOW",
        confidence: "HIGH",
        actionability: "HIGH",
        p2Expected: true,
      })
    );

    expect(result.items[0].statement).toBe("Direction is positive: overall trend is improving.");
    const caveat = result.items.find((i) => i.role === "caveat");
    expect(caveat!.statement).toBe(
      "Event-risk evidence is unavailable; structural narrative evidence remains available."
    );
  });

  test("leadership and rotation change templates render persisted values", () => {
    const leaderPrev = ref("leadership.previous.symbol");
    const leaderCurr = ref("leadership.current.symbol");
    const rotPrev = ref("rotation.previous");
    const rotCurr = ref("rotation.current");
    const rotDelta = ref("rotationScore.delta");
    const result = buildExplanation(
      input({
        refs: [leaderPrev, leaderCurr, rotPrev, rotCurr, rotDelta],
        values: {
          [key(leaderPrev)]: val("leader was BTC", "BTC leadership", "BTC"),
          [key(leaderCurr)]: val("leader is FET", "FET leadership", "FET"),
          [key(rotPrev)]: val("rotation was STRONG", "STRONG rotation", "STRONG"),
          [key(rotCurr)]: val("rotation is WEAKENING", "WEAKENING rotation", "WEAKENING"),
          [key(rotDelta)]: val("rotation score moved −6.0", "rotation delta −6.0", "−6.0", -6),
        },
        direction: "POSITIVE",
        opportunity: "MEDIUM",
        risk: "MEDIUM",
        confidence: "HIGH",
        actionability: "MEDIUM",
        signals: [
          {
            id: "LEADERSHIP_CHANGE",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(leaderPrev), key(leaderCurr)],
          },
          {
            id: "ROTATION_CHANGE",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(rotPrev), key(rotCurr), key(rotDelta)],
          },
        ],
      })
    );

    const statements = result.items.map((i) => i.statement);
    // ROTATION_CHANGE (priority 3) ranks above LEADERSHIP_CHANGE (5) — P4-03 §3.11.
    expect(statements[0]).toBe("Rotation moved from STRONG to WEAKENING (score −6.0).");
    expect(statements[1]).toBe("Narrative leader changed from BTC to FET.");
  });
});

describe("P4-04 Explanation Engine — determinism, versioning, failure isolation (§15, §20, §21)", () => {
  test("deterministic output: same input ⇒ identical explanation (modulo generatedAt)", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove");
    const breadth = ref("breadthMove");
    const make = () =>
      buildExplanation(
        input({
          refs: [trend, momentum, breadth],
          values: {
            [key(trend)]: val("overall trend is improving", "improving trend", "IMPROVING", 1.4),
            [key(momentum)]: val("momentum is positive", "positive momentum", "POSITIVE", 2.2),
            [key(breadth)]: val("breadth is broadening", "broadening breadth", "BROADENING", 1.8),
          },
          direction: "POSITIVE",
          opportunity: "HIGH",
          risk: "LOW",
          confidence: "HIGH",
          actionability: "HIGH",
          signals: [
            { id: "NARRATIVE_IMPROVEMENT", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(trend), key(momentum)] },
            { id: "BROADENING", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(breadth)] },
          ],
          dataSufficiency: { comparableArtifacts: 4, requiredMinimum: 2, sufficient: true },
        })
      );

    const first = make();
    const second = make();
    expect(semanticSnapshot(first)).toBe(semanticSnapshot(second));
    // Versioning (§21): full attribution contract.
    expect(first.attribution).toEqual({
      algorithmVersion: "p4-decision-support",
      semanticVersion: "1",
      interpretationRuleVersion: "p4-03/v1",
      explanationVersion: "1",
    });
    for (const item of first.items) {
      expect(item.semanticVersion).toBe("1");
      expect(item.algorithmVersion).toBe("p4-decision-support");
      expect(item.explanationVersion).toBe("1");
    }
  });

  test("failure isolation: null input ⇒ empty explanation, never throws", () => {
    const result = buildExplanation(null);
    expect(result.items).toEqual([]);
    expect(result.attribution.explanationVersion).toBe("1");
  });

  test("no unsupported/prediction language in any generated statement (§15)", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove");
    const rs = ref("relativeStrengthMove", { interpretationRole: "conflicting" });
    const p2 = ref("eventRisk", {
      sourceLayer: "P2",
      sourceType: "P2_EVENT_RISK",
      sourceId: "event-50",
      artifactIdentity: null,
      interpretationRole: "contextual",
    });
    const result = buildExplanation(
      input({
        refs: [trend, momentum, rs, p2],
        values: {
          [key(trend)]: val("overall trend is deteriorating", "deteriorating trend", "DETERIORATING", -3.0),
          [key(momentum)]: val("momentum is deteriorating", "negative momentum", "NEGATIVE", -2.6),
          [key(rs)]: val("relative strength is improving", "improving relative strength", "POSITIVE", 1.9),
          [key(p2)]: val("a narrative-wide event-risk signal is active", "narrative-wide event risk", "HIGH", null, {
            kind: "narrative-wide",
          }),
        },
        direction: "NEGATIVE",
        opportunity: "LOW",
        risk: "HIGH",
        confidence: "MEDIUM",
        actionability: "HIGH",
        signals: [
          {
            id: "NARRATIVE_DETERIORATION",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(trend), key(momentum)],
          },
          {
            id: "EVIDENCE_CONFLICT",
            narrativeId: 1,
            windowEnd: WINDOW,
            evidenceKeys: [key(momentum)],
            conflictingEvidenceKeys: [key(rs)],
            severity: "low",
          },
        ],
        p2Expected: true,
      })
    );

    const text = result.items.map((i) => i.statement).join(" ").toLowerCase();
    for (const banned of BANNED_PHRASES) {
      expect(text).not.toContain(banned);
    }
  });

  test("explanation/P4-03 consistency: NEGATIVE direction never claims improvement without context (§14)", () => {
    const trend = ref("trend.overall");
    const momentum = ref("momentumMove");
    const result = buildExplanation(
      input({
        refs: [trend, momentum],
        values: {
          [key(trend)]: val("overall trend is deteriorating", "deteriorating trend", "DETERIORATING", -3.0),
          [key(momentum)]: val("momentum is deteriorating", "negative momentum", "NEGATIVE", -2.6),
        },
        direction: "NEGATIVE",
        opportunity: "LOW",
        risk: "HIGH",
        confidence: "HIGH",
        actionability: "HIGH",
        signals: [
          { id: "NARRATIVE_DETERIORATION", narrativeId: 1, windowEnd: WINDOW, evidenceKeys: [key(trend), key(momentum)] },
        ],
        historicalTrend: "IMPROVING",
      })
    );

    // The improving historical trend appears ONLY in the explicitly framed
    // contextual item, never as a current-state claim.
    const summary = result.items[0].statement;
    expect(summary).toContain("weakening");
    expect(summary).not.toMatch(/improving/);
    const contextItem = result.items.find((i) => i.role === "contextual");
    expect(contextItem!.statement).toBe(
      "Current conditions are negative, although historical trend has been improving."
    );
  });
});
