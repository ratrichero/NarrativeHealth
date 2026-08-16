import type {
  P4DirectionState,
  P4EvidenceReference,
  P4EvidenceValue,
  P4ExplanationAttribution,
  P4ExplanationItem,
  P4ExplanationResult,
  P4FiredSignal,
  P4InterpretationResult,
  P4SignalId,
} from "../types";
import {
  P4_ALGORITHM_VERSION,
  P4_EXPLANATION_VERSION,
  P4_INTERPRETATION_RULE_VERSION,
  P4_SEMANTIC_VERSION,
} from "../types";
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
} from "./evidence";
import {
  capitalizeFirst,
  clauseOf,
  displayOf,
  joinPhrases,
  lowercaseFirst,
  phraseOf,
} from "./resolver";
import {
  renderCaveatSingleArtifact,
  renderConfidence,
  renderContextNegativeVsImprovingTrend,
  renderContextPositiveVsDeterioratingTrend,
  renderContextStableTrend,
  renderDegradedAmbiguous,
  renderDegradedCriticalEvidenceMissing,
  renderDegradedIdentityAmbiguous,
  renderDegradedInsufficientHistory,
  renderDegradedInvalid,
  renderDegradedNoValidCurrent,
  renderDegradedP2Unavailable,
  renderDegradedStaleConfidence,
  renderDirection,
  renderDirectionMixed,
  renderP2CoinLocal,
  renderP2MultiCoin,
  renderP2NarrativeWide,
  renderSignalBroadening,
  renderSignalEvidenceConflict,
  renderSignalLeadershipChange,
  renderSignalNarrowing,
  renderSignalNarrativeDeterioration,
  renderSignalNarrativeImprovement,
  renderSignalRegimeChange,
  renderSignalRotationChange,
} from "./templates";

/**
 * P4-04 Explanation / Why Engine (P4-04-IMPL).
 *
 * Consumes the typed P4-03 interpretation result + its evidence references and
 * produces `ExplanationItem`s (P4-04 §16 composition: Summary / Supporting /
 * Conflicts / Context / Caveat). It NEVER recomputes a P4-03 decision and
 * NEVER recalculates P3 metrics.
 *
 * Determinism: same input ⇒ identical statements, ordering and references.
 * The `generatedAt` timestamp is metadata-only and excluded from semantic
 * equality (P4-04 §21).
 *
 * Failure isolation (P4-04 §20): a null input yields `items: []`; expected
 * missing/partial evidence never throws (degraded items are produced from
 * actual evidence status); unexpected programming errors propagate to the
 * future P4 read service boundary.
 */

export const MAX_EXPLANATION_ITEMS = 6;

/** UI ordering priority (P4-03 §3.11). */
const SIGNAL_PRIORITY: Record<P4SignalId, number> = {
  NARRATIVE_IMPROVEMENT: 1,
  NARRATIVE_DETERIORATION: 1,
  REGIME_CHANGE: 2,
  ROTATION_CHANGE: 3,
  BROADENING: 4,
  NARROWING: 4,
  LEADERSHIP_CHANGE: 5,
  EVIDENCE_CONFLICT: 6,
};

export function signalPriority(signal: P4FiredSignal): number {
  return SIGNAL_PRIORITY[signal.id];
}

function sortSignals(signals: P4FiredSignal[]): P4FiredSignal[] {
  // Deduplicate by signal identity (signalId, narrativeId, windowEnd) — P4-03 §3.11.
  const seen = new Set<string>();
  const unique: P4FiredSignal[] = [];
  for (const signal of signals) {
    const key = `${signal.id}|${signal.narrativeId}|${signal.windowEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(signal);
  }
  return [...unique].sort((a, b) => {
    const priorityDiff = signalPriority(a) - signalPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.id.localeCompare(b.id);
  });
}

interface EngineContext {
  input: P4InterpretationResult;
  byKey: Map<string, P4EvidenceReference>;
  values: Record<string, P4EvidenceValue>;
  generatedAt: string;
}

export function buildExplanation(input: P4InterpretationResult | null): P4ExplanationResult {
  const generatedAt = new Date().toISOString();
  const attribution: P4ExplanationAttribution = {
    algorithmVersion: P4_ALGORITHM_VERSION,
    semanticVersion: P4_SEMANTIC_VERSION,
    interpretationRuleVersion: P4_INTERPRETATION_RULE_VERSION,
    explanationVersion: P4_EXPLANATION_VERSION,
  };

  // Failure isolation (P4-04 §20): absent input ⇒ empty explanation, no throw.
  if (!input) return { items: [], attribution, generatedAt };

  const refs = dedupeReferences(filterIdentityCompatible(input.evidence, input.narrativeId));
  const byKey = new Map<string, P4EvidenceReference>(refs.map((ref) => [evidenceIdentityKey(ref), ref]));
  const ctx: EngineContext = { input, byKey, values: input.values, generatedAt };

  const signals = sortSignals(input.signals);

  const summary = buildSummaryItem(ctx, signals);
  const supporting = buildSupportingItems(ctx, signals, summary.usedFields, summary.signalId, summary.reasonUsed);
  const conflicting = buildConflictingItems(ctx, summary.usedFields);
  const contextual = buildContextualItems(ctx);
  const caveat = buildCaveatItem(ctx, summary.reasonUsed);

  const all = [summary.item, ...supporting, ...conflicting, ...contextual];
  if (caveat) all.push(caveat.item);

  const items = enforceTotalCap(all);

  return { items, attribution, generatedAt };
}

// ---------------------------------------------------------------------------
// Item construction helpers
// ---------------------------------------------------------------------------

function item(
  id: string,
  statement: string,
  role: P4ExplanationItem["role"],
  supportingEvidence: P4EvidenceReference[],
  ctx: EngineContext,
  opts: {
    conflictingEvidence?: P4EvidenceReference[];
    contextualEvidence?: P4EvidenceReference[];
    severity?: "low" | "medium" | "high";
  } = {}
): P4ExplanationItem {
  return {
    id,
    statement,
    role,
    supportingEvidence,
    conflictingEvidence: opts.conflictingEvidence ?? [],
    contextualEvidence: opts.contextualEvidence ?? [],
    ...(opts.severity ? { severity: opts.severity } : {}),
    sourceReferences: sourceReferencesOf(supportingEvidence, opts.conflictingEvidence ?? [], opts.contextualEvidence ?? []),
    semanticVersion: P4_SEMANTIC_VERSION,
    algorithmVersion: P4_ALGORITHM_VERSION,
    explanationVersion: P4_EXPLANATION_VERSION,
    generatedAt: ctx.generatedAt,
  };
}

function sourceReferencesOf(...groups: P4EvidenceReference[][]): string[] {
  const refs = groups.flat();
  const ids = new Set<string>();
  for (const ref of refs) {
    if (ref.sourceLayer === "P3" && ref.artifactIdentity) ids.add(ref.artifactIdentity);
    else ids.add(ref.sourceId);
  }
  return [...ids].sort();
}

function refsByKeys(ctx: EngineContext, keys: string[]): P4EvidenceReference[] {
  // Deduplicate by identity key: a reference appears once per item (P4-04 §4).
  const seen = new Set<string>();
  const out: P4EvidenceReference[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = ctx.byKey.get(key);
    if (ref) out.push(ref);
  }
  return out;
}

/**
 * Supporting-eligible refs for a set of identity keys (P4-04 §4): only
 * VALID/PARTIAL evidence can support a statement; STALE/INVALID may only
 * appear as contextual/caveat with their status shown.
 */
function supportingRefsByKeys(ctx: EngineContext, keys: string[]): P4EvidenceReference[] {
  return refsByKeys(ctx, keys).filter((ref) => ref.status === "VALID" || ref.status === "PARTIAL");
}

function refsByField(ctx: EngineContext, field: string): P4EvidenceReference[] {
  return [...ctx.byKey.values()].filter((ref) => ref.field === field);
}

function firstRef(refs: P4EvidenceReference[], fields: string[]): P4EvidenceReference | null {
  for (const field of fields) {
    const found = refs.find((ref) => ref.field === field);
    if (found) return found;
  }
  return null;
}

/** Fields already rendered, to avoid duplicating an evidence clause as a separate item. */
function usedFieldSet(...fields: string[]): Set<string> {
  return new Set(fields.filter(Boolean));
}

// ---------------------------------------------------------------------------
// 1. Summary item (P4-04 §16)
// ---------------------------------------------------------------------------

interface SummaryResult {
  item: P4ExplanationItem;
  signalId: P4SignalId | null;
  usedFields: Set<string>;
  reasonUsed: boolean;
}

function buildSummaryItem(ctx: EngineContext, signals: P4FiredSignal[]): SummaryResult {
  const { input } = ctx;

  // UNKNOWN direction — degraded summary from the actual reason (P4-04 §11).
  if (input.direction === "UNKNOWN") {
    const reason = pickDegradationReason(ctx);
    const statement = renderDegradedReason(reason.code, reason.field);
    const refs = refsForDegradation(ctx, reason.code);
    return {
      item: item("exp:summary:1", statement, "primary", refs, ctx),
      signalId: null,
      usedFields: usedFieldSet(),
      reasonUsed: true,
    };
  }

  // MIXED direction — both sides rendered explicitly (P4-04 §7, P4-03 §16 E6).
  if (input.direction === "MIXED") {
    const sides = mixedSides(ctx, signals);
    if (sides) {
      const { supporting, conflicting, positiveRefs, negativeRefs } = sides;
      return {
        item: item(
          "exp:summary:1",
          renderDirectionMixed(supporting, conflicting),
          "primary",
          positiveRefs,
          ctx,
          { conflictingEvidence: negativeRefs }
        ),
        signalId: "EVIDENCE_CONFLICT",
        usedFields: usedFieldSet(...positiveRefs.map((r) => r.field), ...negativeRefs.map((r) => r.field)),
        reasonUsed: false,
      };
    }
    // Defensive fallback: no conflict trace ⇒ no invented split.
    return {
      item: item("exp:summary:1", "Direction is mixed: evidence is conflicting.", "primary", [], ctx),
      signalId: null,
      usedFields: usedFieldSet(),
      reasonUsed: false,
    };
  }

  // NARRATIVE_* signal — the most decision-relevant statement.
  const narrativeSignal = signals.find(
    (signal) => signal.id === "NARRATIVE_IMPROVEMENT" || signal.id === "NARRATIVE_DETERIORATION"
  );
  if (narrativeSignal) {
    const { statement, supporting, conflicting } = renderNarrativeSignal(ctx, narrativeSignal);
    // Presentation limits (P4-04 §4): primary ≤ 3, conflicting ≤ 2.
    const supportingCapped = selectSupporting(supporting);
    const conflictingCapped = selectConflicting(conflicting);
    const fields = [...supportingCapped.map((r) => r.field), ...conflictingCapped.map((r) => r.field)];
    return {
      item: item("exp:summary:1", statement, "primary", supportingCapped, ctx, { conflictingEvidence: conflictingCapped }),
      signalId: narrativeSignal.id,
      usedFields: usedFieldSet(...fields, "trend.overall"),
      reasonUsed: false,
    };
  }

  // Any other fired signal (highest priority first).
  if (signals.length > 0) {
    const top = signals[0];
    const statement = renderSignal(ctx, top);
    const supporting = selectSupporting(supportingRefsByKeys(ctx, top.evidenceKeys));
    const conflicting = selectConflicting(supportingRefsByKeys(ctx, top.conflictingEvidenceKeys ?? []));
    return {
      item: item("exp:summary:1", statement, "primary", supporting, ctx, { conflictingEvidence: conflicting }),
      signalId: top.id,
      usedFields: usedFieldSet(...supporting.map((r) => r.field), ...conflicting.map((r) => r.field)),
      reasonUsed: false,
    };
  }

  // No signals — Direction statement with the deciding evidence (P4-04 §9.1).
  const deciding = decidingEvidence(ctx, "direction");
  const evidenceSummary = evidenceSummaryForDirection(ctx);
  return {
    item: item(
      "exp:summary:1",
      renderDirection(input.direction as P4DirectionState, evidenceSummary),
      "primary",
      deciding,
      ctx
    ),
    signalId: null,
    usedFields: usedFieldSet(...deciding.map((r) => r.field)),
    reasonUsed: false,
  };
}

function mixedSides(
  ctx: EngineContext,
  signals: P4FiredSignal[]
): { supporting: string; conflicting: string; positiveRefs: P4EvidenceReference[]; negativeRefs: P4EvidenceReference[] } | null {
  const conflictSignal = signals.find((signal) => signal.id === "EVIDENCE_CONFLICT");
  if (conflictSignal) {
    const positive = supportingRefsByKeys(ctx, conflictSignal.evidenceKeys);
    const negative = supportingRefsByKeys(ctx, conflictSignal.conflictingEvidenceKeys ?? []);
    if (positive.length > 0 && negative.length > 0) {
      // Presentation limits (P4-04 §4): primary ≤ 3 per side, conflicting ≤ 2.
      return {
        supporting: lowercaseFirst(clauseOf(positive[0], ctx.values)),
        conflicting: lowercaseFirst(clauseOf(negative[0], ctx.values)),
        positiveRefs: selectSupporting(positive),
        negativeRefs: selectConflicting(negative),
      };
    }
  }
  // Fallback: direction conclusion evidence split is not determinable without
  // a conflict trace — represent the mixed state without inventing a split.
  return null;
}

function evidenceSummaryForDirection(ctx: EngineContext): string {
  const refs = decidingEvidence(ctx, "direction").slice(0, 3);
  if (refs.length === 0) return "";
  return lowercaseFirst(joinPhrases(refs.map((ref) => lowercaseFirst(clauseOf(ref, ctx.values)))));
}

function decidingEvidence(ctx: EngineContext, conclusion: "direction"): P4EvidenceReference[] {
  const keys = ctx.input.conclusionEvidence?.[conclusion] ?? [];
  const byKeys = refsByKeys(ctx, keys).filter(
    (ref) => ref.status === "VALID" || ref.status === "PARTIAL"
  );
  if (byKeys.length > 0) return selectSupporting(byKeys);
  // Fallback: highest-ranked supporting evidence (deterministic).
  return rankSupporting([...ctx.byKey.values()], ctx.values).slice(0, PRIMARY_EVIDENCE_LIMIT);
}

// ---------------------------------------------------------------------------
// 2. Supporting items (≤3): remaining signals, then deciding-evidence clauses
// ---------------------------------------------------------------------------

function buildSupportingItems(
  ctx: EngineContext,
  signals: P4FiredSignal[],
  usedFields: Set<string>,
  summarySignalId: P4SignalId | null,
  summaryReasonUsed: boolean
): P4ExplanationItem[] {
  const items: P4ExplanationItem[] = [];

  // A degraded summary (UNKNOWN direction explained from the actual reason)
  // replaces the standard composition: no evidence-clause items are emitted
  // on top of the degradation (P4-04 §11, E7).
  if (summaryReasonUsed) return items;

  // Remaining fired signals (priority order), excluding the one used in the summary.
  for (const signal of signals) {
    if (items.length >= PRIMARY_EVIDENCE_LIMIT) break;
    if (signal.id === summarySignalId) continue;
    // MIXED summaries already rendered the conflict both sides.
    if (signal.id === "EVIDENCE_CONFLICT" && ctx.input.direction === "MIXED") continue;
    const statement = renderSignal(ctx, signal);
    // Presentation limits (P4-04 §4): primary ≤ 3, conflicting ≤ 2 per item;
    // INVALID/STALE may not support a statement.
    const supporting = selectSupporting(supportingRefsByKeys(ctx, signal.evidenceKeys));
    const conflicting = selectConflicting(supportingRefsByKeys(ctx, signal.conflictingEvidenceKeys ?? []));
    for (const ref of [...supporting, ...conflicting]) usedFields.add(ref.field);
    items.push(
      item(`exp:signal:${signal.id}:${items.length + 1}`, statement, "primary", supporting, ctx, {
        conflictingEvidence: conflicting,
        ...(signal.id === "EVIDENCE_CONFLICT" && signal.severity ? { severity: signal.severity } : {}),
      })
    );
  }

  // Top-ranked deciding-evidence clauses (fields not already rendered).
  const ranked = rankSupporting([...ctx.byKey.values()], ctx.values);
  let clauseIndex = 0;
  for (const ref of ranked) {
    if (items.length >= PRIMARY_EVIDENCE_LIMIT) break;
    if (usedFields.has(ref.field)) continue;
    usedFields.add(ref.field);
    items.push(
      item(`exp:evidence:${clauseIndex + 1}`, `${capitalizeFirst(clauseOf(ref, ctx.values))}.`, "primary", [ref], ctx)
    );
    clauseIndex += 1;
  }

  return items;
}

// ---------------------------------------------------------------------------
// 3. Conflicting items (≤2) — opposing evidence kept visible (P4-04 §7)
// ---------------------------------------------------------------------------

function buildConflictingItems(ctx: EngineContext, usedFields: Set<string>): P4ExplanationItem[] {
  // Standalone conflicts: refs P4-03 marked as opposing corroborators, not
  // already rendered inside a fired EVIDENCE_CONFLICT signal (which shows both
  // sides in one item) and not already rendered elsewhere (no duplicate
  // statements — the conflict stays visible through those items).
  const conflictKeysOfSignals = new Set(
    ctx.input.signals
      .filter((signal) => signal.id === "EVIDENCE_CONFLICT")
      .flatMap((signal) => [...signal.evidenceKeys, ...(signal.conflictingEvidenceKeys ?? [])])
  );
  const pool = rankConflicting(
    [...ctx.byKey.values()],
    ctx.values,
    new Set()
  ).filter(
    (ref) =>
      ref.interpretationRole === "conflicting" &&
      !conflictKeysOfSignals.has(evidenceIdentityKey(ref)) &&
      !usedFields.has(ref.field)
  );

  const items: P4ExplanationItem[] = [];
  for (const ref of pool.slice(0, CONFLICTING_EVIDENCE_LIMIT)) {
    items.push(
      item(`exp:conflict:${items.length + 1}`, `${capitalizeFirst(clauseOf(ref, ctx.values))}.`, "conflicting", [ref], ctx)
    );
  }
  return items;
}

// ---------------------------------------------------------------------------
// 4. Contextual items (≤2) — historical context + P2 secondary evidence
// ---------------------------------------------------------------------------

function buildContextualItems(ctx: EngineContext): P4ExplanationItem[] {
  const items: P4ExplanationItem[] = [];

  // Historical divergence / stability (P4-04 §8) — Direction unchanged.
  const trend = ctx.input.context.historicalTrend;
  if (trend) {
    if (ctx.input.direction === "POSITIVE" && trend === "DETERIORATING") {
      items.push(
        item(
          `exp:context:${items.length + 1}`,
          renderContextPositiveVsDeterioratingTrend(),
          "contextual",
          selectContextual(refsByField(ctx, "trend.overall")),
          ctx
        )
      );
    } else if (ctx.input.direction === "NEGATIVE" && trend === "IMPROVING") {
      items.push(
        item(
          `exp:context:${items.length + 1}`,
          renderContextNegativeVsImprovingTrend(),
          "contextual",
          selectContextual(refsByField(ctx, "trend.overall")),
          ctx
        )
      );
    } else if (ctx.input.direction === "NEUTRAL" && trend === "STABLE") {
      items.push(
        item(
          `exp:context:${items.length + 1}`,
          renderContextStableTrend(),
          "contextual",
          selectContextual(refsByField(ctx, "trend.overall")),
          ctx
        )
      );
    }
  }

  // P2 Event Risk — secondary evidence, scope preserved (P4-04 §12).
  const p2Refs = rankContextual([...ctx.byKey.values()]).filter(
    (ref) => ref.sourceLayer === "P2" && ref.sourceType === "P2_EVENT_RISK"
  );
  if (p2Refs.length > 0 && items.length < CONTEXTUAL_EVIDENCE_LIMIT) {
    const scopes = new Set(p2Refs.map((ref) => ctx.values[evidenceIdentityKey(ref)]?.scope?.kind).filter(Boolean));
    const kind: "coin-local" | "multi-coin" | "narrative-wide" = scopes.has("narrative-wide")
      ? "narrative-wide"
      : scopes.has("multi-coin")
        ? "multi-coin"
        : "coin-local";
    const first = ctx.values[evidenceIdentityKey(p2Refs[0])];
    const statement =
      kind === "coin-local"
        ? renderP2CoinLocal(first?.scope?.symbols?.[0] ?? "a constituent")
        : kind === "multi-coin"
          ? renderP2MultiCoin(p2Refs.length)
          : renderP2NarrativeWide();
    items.push(item(`exp:context:${items.length + 1}`, statement, "contextual", p2Refs.slice(0, 2), ctx));
  }

  return items.slice(0, CONTEXTUAL_EVIDENCE_LIMIT);
}

// ---------------------------------------------------------------------------
// 5. Caveat item (≤1) — degraded/partial transparency (P4-04 §11, §16)
// ---------------------------------------------------------------------------

interface CaveatResult {
  item: P4ExplanationItem;
}

function buildCaveatItem(ctx: EngineContext, summaryReasonUsed: boolean): CaveatResult | null {
  const { input } = ctx;

  // Remaining degradation reasons not already used in the summary.
  if (!summaryReasonUsed && input.degradation.length > 0) {
    const reason = pickDegradationReason(ctx);
    if (reason.code !== "INSUFFICIENT_HISTORY" || input.direction !== "UNKNOWN") {
      return {
        item: item(
          "exp:caveat:1",
          renderDegradedReason(reason.code, reason.field),
          "caveat",
          refsForDegradation(ctx, reason.code),
          ctx
        ),
      };
    }
  }

  // Insufficient history with a single artifact (P4-04 §18 E7) — a distinct,
  // additional fact on top of the UNKNOWN summary reason.
  const sufficiency = input.context.dataSufficiency;
  if (sufficiency && !sufficiency.sufficient && sufficiency.comparableArtifacts === 1) {
    return {
      item: item(
        "exp:caveat:1",
        renderCaveatSingleArtifact(),
        "caveat",
        selectSupporting(refsByField(ctx, "trend.overall"), 2),
        ctx
      ),
    };
  }

  // P2 expected but unavailable (P4-04 §11).
  if (input.context.p2Expected && !hasP2Evidence(ctx)) {
    return {
      item: item("exp:caveat:1", renderDegradedP2Unavailable(), "caveat", [], ctx),
    };
  }

  // Confidence limitation (P4-04 §9.4) — from actual evidence status, never fabricated.
  if (input.confidence === "LOW" || input.confidence === "MEDIUM") {
    const limitation = confidenceLimitation(ctx);
    return {
      item: item(
        "exp:caveat:1",
        renderConfidence(input.confidence, limitation),
        "caveat",
        caveatEvidenceForLimitation(ctx, limitation),
        ctx
      ),
    };
  }

  return null;
}

/** Evidence for a confidence limitation — grounded in the actual cause (P4-04 §3.1). */
function caveatEvidenceForLimitation(ctx: EngineContext, limitation: string): P4EvidenceReference[] {
  const refs = [...ctx.byKey.values()];
  if (limitation.includes("stale")) {
    return refs.filter((ref) => ref.status === "STALE").slice(0, 2);
  }
  if (limitation.includes("conflicting")) {
    return refs.filter((ref) => ref.interpretationRole === "conflicting").slice(0, 2);
  }
  if (limitation.includes("historical trend conflicts")) {
    return refsByField(ctx, "trend.overall").slice(0, 1);
  }
  // Insufficient/partial coverage: the deciding confidence evidence, else the
  // highest-ranked supporting evidence (deterministic fallback).
  const keys = ctx.input.conclusionEvidence?.confidence ?? [];
  const byKeys = refsByKeys(ctx, keys).filter((ref) => ref.status === "VALID" || ref.status === "PARTIAL");
  if (byKeys.length > 0) return byKeys.slice(0, 2);
  return rankSupporting(refs, ctx.values).slice(0, 2);
}

function hasP2Evidence(ctx: EngineContext): boolean {
  return [...ctx.byKey.values()].some((ref) => ref.sourceLayer === "P2");
}

function confidenceLimitation(ctx: EngineContext): string {
  const { input } = ctx;
  const refs = [...ctx.byKey.values()];
  if (refs.some((ref) => ref.status === "STALE")) return "required evidence is stale";
  const sufficiency = input.context.dataSufficiency;
  if (sufficiency && !sufficiency.sufficient) return "historical evidence is insufficient";
  // Historical divergence (P4-03 §6 contradiction role) — grounded, never fabricated.
  const trend = input.context.historicalTrend;
  if (input.direction === "POSITIVE" && trend === "DETERIORATING") return "historical trend conflicts with current evidence";
  if (input.direction === "NEGATIVE" && trend === "IMPROVING") return "historical trend conflicts with current evidence";
  // Formal EVIDENCE_CONFLICT (P4-03 §9) — material or minor, both are conflicts.
  if (input.signals.some((signal) => signal.id === "EVIDENCE_CONFLICT")) return "evidence is conflicting";
  if (refs.some((ref) => ref.interpretationRole === "conflicting")) return "evidence is conflicting";
  return input.confidence === "LOW" ? "evidence is insufficient" : "evidence is partially available";
}

// ---------------------------------------------------------------------------
// Degraded reason resolution
// ---------------------------------------------------------------------------

function pickDegradationReason(ctx: EngineContext): { code: string; field?: string } {
  const { input } = ctx;
  const explicit = input.degradation[0];
  if (explicit) return explicit;
  // Deterministic derivation when P4-03 did not record a reason.
  if (input.status === "UNAVAILABLE") return { code: "NO_VALID_CURRENT" };
  const sufficiency = input.context.dataSufficiency;
  if (sufficiency && !sufficiency.sufficient) return { code: "INSUFFICIENT_HISTORY" };
  return { code: "CRITICAL_EVIDENCE_MISSING" };
}

function renderDegradedReason(code: string, field?: string): string {
  switch (code) {
    case "NO_VALID_CURRENT":
      return renderDegradedNoValidCurrent();
    case "INSUFFICIENT_HISTORY":
      return renderDegradedInsufficientHistory();
    case "CRITICAL_EVIDENCE_MISSING":
      return renderDegradedCriticalEvidenceMissing(field ?? "");
    case "INVALID":
      return renderDegradedInvalid(field ?? "required");
    case "AMBIGUOUS":
      return renderDegradedAmbiguous(field ?? "required");
    case "IDENTITY_AMBIGUOUS":
      return renderDegradedIdentityAmbiguous();
    case "STALE":
      return renderDegradedStaleConfidence();
    case "P2_UNAVAILABLE":
      return renderDegradedP2Unavailable();
    default:
      return renderDegradedCriticalEvidenceMissing("");
  }
}

function refsForDegradation(ctx: EngineContext, code: string): P4EvidenceReference[] {
  const { input } = ctx;
  if (code === "STALE") {
    return [...ctx.byKey.values()].filter((ref) => ref.status === "STALE").slice(0, 2);
  }
  if (code === "INSUFFICIENT_HISTORY" || code === "NO_VALID_CURRENT") {
    return input.evidence.length > 0 ? input.evidence.slice(0, 1) : [];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Signal rendering (P4-04 §10 — only fired signals, placeholders from evidence)
// ---------------------------------------------------------------------------

function renderNarrativeSignal(
  ctx: EngineContext,
  signal: P4FiredSignal
): { statement: string; supporting: P4EvidenceReference[]; conflicting: P4EvidenceReference[] } {
  const keys = signal.evidenceKeys;
  const refs = refsByKeys(ctx, keys);
  // Only VALID/PARTIAL evidence can support a statement (P4-04 §4); STALE/INVALID
  // may only appear as contextual/caveat with its status shown.
  const usable = refs.filter((ref) => ref.status === "VALID" || ref.status === "PARTIAL");
  // Primary driver = frozen trend.overall; corroborators = the remaining moves.
  const trendRef = usable.find((ref) => ref.field === "trend.overall") ?? null;
  const corroborators = usable.filter((ref) => ref !== trendRef).slice(0, 2);
  const corroboratorText = joinPhrases(corroborators.map((ref) => phraseOf(ref, ctx.values)));

  const opposingKeys = signal.conflictingEvidenceKeys ?? [];
  const opposingRefs = refsByKeys(ctx, opposingKeys).filter(
    (ref) => ref.status === "VALID" || ref.status === "PARTIAL"
  );
  const opposing = opposingRefs.length > 0 ? lowercaseFirst(clauseOf(opposingRefs[0], ctx.values)) : null;

  const statement =
    signal.id === "NARRATIVE_IMPROVEMENT"
      ? renderSignalNarrativeImprovement(corroboratorText, opposing)
      : renderSignalNarrativeDeterioration(corroboratorText, opposing);

  return { statement, supporting: usable, conflicting: opposingRefs };
}

function renderSignal(ctx: EngineContext, signal: P4FiredSignal): string {
  const keys = signal.evidenceKeys;
  const refs = refsByKeys(ctx, keys);
  switch (signal.id) {
    case "BROADENING":
      return renderSignalBroadening();
    case "NARROWING":
      return renderSignalNarrowing();
    case "LEADERSHIP_CHANGE": {
      const previous = firstRef(refs, ["leadership.previous.symbol"]) ?? null;
      const current = firstRef(refs, ["leadership.current.symbol"]) ?? null;
      return renderSignalLeadershipChange(
        previous ? displayOf(previous, ctx.values) : "unavailable",
        current ? displayOf(current, ctx.values) : "unavailable"
      );
    }
    case "REGIME_CHANGE": {
      const previous = firstRef(refs, ["regime.previous"]) ?? null;
      const current = firstRef(refs, ["regime.current"]) ?? null;
      return renderSignalRegimeChange(
        previous ? displayOf(previous, ctx.values) : "unavailable",
        current ? displayOf(current, ctx.values) : "unavailable"
      );
    }
    case "ROTATION_CHANGE": {
      const previous = firstRef(refs, ["rotation.previous"]) ?? null;
      const current = firstRef(refs, ["rotation.current"]) ?? null;
      const delta = firstRef(refs, ["rotationScore.delta"]) ?? null;
      return renderSignalRotationChange(
        previous ? displayOf(previous, ctx.values) : "unavailable",
        current ? displayOf(current, ctx.values) : "unavailable",
        delta ? displayOf(delta, ctx.values) : ""
      );
    }
    case "EVIDENCE_CONFLICT": {
      const positive = refsByKeys(ctx, keys);
      const negative = refsByKeys(ctx, signal.conflictingEvidenceKeys ?? []);
      if (positive.length > 0 && negative.length > 0) {
        return renderSignalEvidenceConflict(
          capitalizeFirst(clauseOf(positive[0], ctx.values)),
          lowercaseFirst(clauseOf(negative[0], ctx.values))
        );
      }
      return "Conflicting evidence is present.";
    }
    default:
      return renderSignalStatementDefault(signal.id, refs, ctx);
  }
}

/** Defensive fallback for NARRATIVE_* when rendered outside the summary path. */
function renderSignalStatementDefault(
  id: P4SignalId,
  refs: P4EvidenceReference[],
  ctx: EngineContext
): string {
  const corroboratorText = joinPhrases(refs.slice(0, 2).map((ref) => phraseOf(ref, ctx.values)));
  if (id === "NARRATIVE_IMPROVEMENT") return renderSignalNarrativeImprovement(corroboratorText, null);
  if (id === "NARRATIVE_DETERIORATION") return renderSignalNarrativeDeterioration(corroboratorText, null);
  return `Signal ${id} is active.`;
}

// ---------------------------------------------------------------------------
// Total item cap (P4-04 §17 / P4-03 §15: maximum 6 per ViewModel)
// ---------------------------------------------------------------------------

function enforceTotalCap(items: P4ExplanationItem[]): P4ExplanationItem[] {
  if (items.length <= MAX_EXPLANATION_ITEMS) return items;
  const summary = items.filter((i) => i.id.startsWith("exp:summary:"));
  const caveat = items.filter((i) => i.id.startsWith("exp:caveat:"));
  const supporting = items.filter((i) => i.role === "primary" && !i.id.startsWith("exp:summary:"));
  const conflicting = items.filter((i) => i.role === "conflicting");
  const contextual = items.filter((i) => i.role === "contextual");
  // Keep-priority (deterministic): summary + caveat always kept, then
  // supporting, then conflicting, then contextual — until the ≤6 cap.
  const kept: P4ExplanationItem[] = [...summary, ...caveat];
  for (const group of [supporting, conflicting, contextual]) {
    for (const candidate of group) {
      if (kept.length >= MAX_EXPLANATION_ITEMS) break;
      kept.push(candidate);
    }
    if (kept.length >= MAX_EXPLANATION_ITEMS) break;
  }
  // Display order (P4-04 §16): Summary, Supporting, Conflicts, Context, Caveat.
  const keptIds = new Set(kept.map((i) => i.id));
  return [...summary, ...supporting, ...conflicting, ...contextual, ...caveat].filter((i) => keptIds.has(i.id));
}
