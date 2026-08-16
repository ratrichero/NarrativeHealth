import type { P4EvidenceReference, P4EvidenceValue } from "../types";

/**
 * Evidence selection & deterministic ranking (P4-04 §4/§5 — frozen).
 *
 * - Selection limits are presentation limits only; they never change the
 *   underlying P4-03 result.
 * - Ranking is ordered precedence (tiers), NOT arithmetic weights and NOT a
 *   numeric evidence score.
 * - INVALID/STALE evidence is excluded from supporting; it may only appear as
 *   contextual/caveat (with its status shown).
 * - Conflict is never silently discarded.
 */

export const PRIMARY_EVIDENCE_LIMIT = 3;
export const CONFLICTING_EVIDENCE_LIMIT = 2;
export const CONTEXTUAL_EVIDENCE_LIMIT = 2;

/** Canonical identity key — full evidence identity (all fields, P4-04 §4). */
export function evidenceIdentityKey(ref: P4EvidenceReference): string {
  return JSON.stringify({
    sourceLayer: ref.sourceLayer,
    sourceType: ref.sourceType,
    sourceId: ref.sourceId,
    artifactIdentity: ref.artifactIdentity,
    narrativeIdentity: ref.narrativeIdentity,
    windowOrDate: ref.windowOrDate,
    field: ref.field,
    status: ref.status,
    interpretationRole: ref.interpretationRole,
  });
}

/** Deduplicate by full identity — a deduped reference appears once per item. */
export function dedupeReferences(refs: P4EvidenceReference[]): P4EvidenceReference[] {
  const seen = new Set<string>();
  const out: P4EvidenceReference[] = [];
  for (const ref of refs) {
    const key = evidenceIdentityKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

/**
 * Identity compatibility (P4-04 §4): only references belonging to the same
 * narrativeIdentity are eligible; P3 references must carry a non-null artifact
 * identity (same algorithm/mode/window is encoded in `artifactIdentity` by the
 * P3 read path — the engine re-verifies the mandatory part).
 */
export function filterIdentityCompatible(
  refs: P4EvidenceReference[],
  narrativeId: number | string
): P4EvidenceReference[] {
  const id = String(narrativeId);
  return refs.filter(
    (ref) =>
      ref.narrativeIdentity === id &&
      (ref.sourceLayer !== "P3" || (ref.artifactIdentity !== null && ref.artifactIdentity.length > 0))
  );
}

function sourceLayerRank(layer: P4EvidenceReference["sourceLayer"]): number {
  return layer === "P3" ? 0 : layer === "P2" ? 1 : 2;
}

function windowMs(ref: P4EvidenceReference): number {
  const ms = Date.parse(ref.windowOrDate);
  return Number.isNaN(ms) ? 0 : ms;
}

function valueFor(ref: P4EvidenceReference, values: Record<string, P4EvidenceValue>): P4EvidenceValue | null {
  const value = values[evidenceIdentityKey(ref)];
  return value ?? null;
}

/** |delta| over the frozen ε comparison — null when the reference is non-numeric. */
function absDelta(ref: P4EvidenceReference, values: Record<string, P4EvidenceValue>): number | null {
  const value = valueFor(ref, values);
  return value && typeof value.numericValue === "number" ? Math.abs(value.numericValue) : null;
}

/** P4-04 §5 ordered precedence for the supporting pool (roles primary/secondary). */
export function rankSupporting(
  refs: P4EvidenceReference[],
  values: Record<string, P4EvidenceValue>
): P4EvidenceReference[] {
  const candidates = refs.filter(
    (ref) =>
      (ref.interpretationRole === "primary" || ref.interpretationRole === "secondary") &&
      (ref.status === "VALID" || ref.status === "PARTIAL")
  );
  return [...candidates].sort((a, b) => compareSupporting(a, b, values));
}

function compareSupporting(
  a: P4EvidenceReference,
  b: P4EvidenceReference,
  values: Record<string, P4EvidenceValue>
): number {
  // Tier 1/2 — direct driver (primary) beats corroborator (secondary).
  const tierA = a.interpretationRole === "primary" ? 1 : 2;
  const tierB = b.interpretationRole === "primary" ? 1 : 2;
  if (tierA !== tierB) return tierA - tierB;

  // Tier 3 — current relevance: latest window first.
  const windowDiff = windowMs(b) - windowMs(a);
  if (windowDiff !== 0) return windowDiff;

  // Tier 4 — explanatory value: largest |delta| first, ordinal only (nulls last).
  const deltaA = absDelta(a, values);
  const deltaB = absDelta(b, values);
  if (deltaA !== deltaB) {
    if (deltaA === null) return 1;
    if (deltaB === null) return -1;
    return deltaB - deltaA;
  }

  // Tier 5 — provenance: VALID before PARTIAL.
  const statusRank = (ref: P4EvidenceReference) => (ref.status === "VALID" ? 0 : 1);
  const provenanceDiff = statusRank(a) - statusRank(b);
  if (provenanceDiff !== 0) return provenanceDiff;

  // Deterministic tie-breaks (P4-04 §4): sourceLayer (P3 before P2), sourceType, sourceId.
  return tieBreak(a, b);
}

/**
 * Conflicting pool — strongest opposing evidence first (P4-04 §4 conflict
 * preference: the strongest opposing evidence is kept even if a stronger
 * supporting item exists). INVALID/STALE excluded (P4-04 §4).
 */
export function rankConflicting(
  refs: P4EvidenceReference[],
  values: Record<string, P4EvidenceValue>,
  conflictKeys: ReadonlySet<string> = new Set()
): P4EvidenceReference[] {
  const candidates = refs.filter(
    (ref) =>
      (ref.interpretationRole === "conflicting" || conflictKeys.has(evidenceIdentityKey(ref))) &&
      (ref.status === "VALID" || ref.status === "PARTIAL")
  );
  return [...candidates].sort((a, b) => {
    const deltaA = absDelta(a, values);
    const deltaB = absDelta(b, values);
    if (deltaA !== deltaB) {
      if (deltaA === null) return 1;
      if (deltaB === null) return -1;
      return deltaB - deltaA;
    }
    const windowDiff = windowMs(b) - windowMs(a);
    if (windowDiff !== 0) return windowDiff;
    return tieBreak(a, b);
  });
}

/**
 * Contextual pool — historical/secondary evidence; STALE refs may appear here
 * (with their status shown, P4-04 §4) but never as supporting.
 */
export function rankContextual(refs: P4EvidenceReference[]): P4EvidenceReference[] {
  const candidates = refs.filter(
    (ref) => ref.interpretationRole === "contextual" || ref.sourceLayer === "P2" || ref.status === "STALE"
  );
  return [...candidates].sort((a, b) => {
    const windowDiff = windowMs(b) - windowMs(a);
    if (windowDiff !== 0) return windowDiff;
    return tieBreak(a, b);
  });
}

/** Deterministic tie-break: sourceLayer (P3 before P2), then sourceType, then sourceId asc. */
function tieBreak(a: P4EvidenceReference, b: P4EvidenceReference): number {
  const layerDiff = sourceLayerRank(a.sourceLayer) - sourceLayerRank(b.sourceLayer);
  if (layerDiff !== 0) return layerDiff;
  const typeDiff = a.sourceType.localeCompare(b.sourceType);
  if (typeDiff !== 0) return typeDiff;
  // Numeric-aware ascending for persisted numeric ids (P3 artifacts), else lexicographic.
  const idA = Number(a.sourceId);
  const idB = Number(b.sourceId);
  if (!Number.isNaN(idA) && !Number.isNaN(idB) && idA !== idB) return idA - idB;
  return a.sourceId.localeCompare(b.sourceId);
}

/** Presentation limit enforcement — deterministic truncation from the lowest-ranked items. */
export function selectSupporting(refs: P4EvidenceReference[], limit = PRIMARY_EVIDENCE_LIMIT): P4EvidenceReference[] {
  return refs.slice(0, limit);
}

export function selectConflicting(refs: P4EvidenceReference[], limit = CONFLICTING_EVIDENCE_LIMIT): P4EvidenceReference[] {
  return refs.slice(0, limit);
}

export function selectContextual(refs: P4EvidenceReference[], limit = CONTEXTUAL_EVIDENCE_LIMIT): P4EvidenceReference[] {
  return refs.slice(0, limit);
}
