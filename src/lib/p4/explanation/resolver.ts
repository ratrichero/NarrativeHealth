import type { P4EvidenceReference, P4EvidenceValue } from "../types";
import { evidenceIdentityKey } from "./evidence";

/**
 * Evidence value resolver (P4-04 §8 — Alternative B).
 *
 * `humanValue` was rejected on EvidenceReference (P4-MASTER §25); display
 * values are resolved HERE, outside the reference, from values supplied by the
 * P4-05 read path (which composes them from existing P3 read-model display
 * fields — `deltaDisplay`, `scoreDisplay`, persisted classifications, etc.).
 *
 * The engine never formats numbers itself and never invents values: an
 * unresolved reference falls back to its own `field` name (deterministic,
 * never a fabricated number).
 */

export function resolveEvidenceValue(
  ref: P4EvidenceReference,
  values: Record<string, P4EvidenceValue>
): P4EvidenceValue | null {
  return values[evidenceIdentityKey(ref)] ?? null;
}

/** Full readable clause, e.g. "Momentum is deteriorating". Falls back to the field name. */
export function clauseOf(ref: P4EvidenceReference, values: Record<string, P4EvidenceValue>): string {
  const value = resolveEvidenceValue(ref, values);
  return value ? value.clause : ref.field;
}

/** Compact corroborator phrase, e.g. "deteriorating momentum". Falls back to the field name. */
export function phraseOf(ref: P4EvidenceReference, values: Record<string, P4EvidenceValue>): string {
  const value = resolveEvidenceValue(ref, values);
  return value ? value.phrase : ref.field;
}

/** Default display value, e.g. "NEUTRAL", "BLUAI", "−6.0". Falls back to the field name. */
export function displayOf(ref: P4EvidenceReference, values: Record<string, P4EvidenceValue>): string {
  const value = resolveEvidenceValue(ref, values);
  return value ? value.display : ref.field;
}

/** Sentence-capitalize the first character (deterministic, for join slots). */
export function capitalizeFirst(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Lowercase the first character (deterministic, for mid-sentence slots). */
export function lowercaseFirst(text: string): string {
  if (text.length === 0) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Join phrases with commas and a final "and" (deterministic). */
export function joinPhrases(phrases: string[]): string {
  const filtered = phrases.filter((p) => p.length > 0);
  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`;
}
