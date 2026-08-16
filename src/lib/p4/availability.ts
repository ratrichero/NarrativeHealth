import type { P4EvidenceStatus, P4Move } from "./types";
import type { P3AvailabilityState } from "@/lib/types/p3-intelligence";
import type { P3TrendState } from "@/lib/types/p3-intelligence-history";

/**
 * P4 evidence availability normalization (P4-03 §2.1 — frozen mapping).
 *
 * Raw P3 read-model availability states → P4 semantic evidence states. This
 * module performs NO interpretation and NO fallback semantics of its own: it
 * only maps and merges states exactly as the frozen contract prescribes.
 * `PARTIAL` is a derived semantic state (present-but-incomplete member
 * detail, e.g. leader score present while symbol null) — the assembler emits
 * it explicitly; it is never produced by this mapping.
 */

/** Map a persisted P3 availability state to its P4 semantic state (P4-03 §2.1). */
export function normalizeP3State(state: P3AvailabilityState): P4EvidenceStatus {
  switch (state) {
    case "VALID":
      return "VALID";
    case "MISSING":
      return "UNAVAILABLE";
    case "INVALID":
      return "INVALID";
    case "STALE":
      return "STALE";
    case "INSUFFICIENT_HISTORY":
      return "INSUFFICIENT_HISTORY";
    case "NOT_APPLICABLE":
      return "NOT_APPLICABLE";
    case "AMBIGUOUS":
      return "AMBIGUOUS";
  }
}

/**
 * Precedence when multiple states could apply (P4-03 §2.2 — frozen order,
 * first match wins when merging):
 *
 *   INVALID > AMBIGUOUS > NOT_APPLICABLE > INSUFFICIENT_HISTORY
 *       > STALE > UNAVAILABLE(MISSING) > PARTIAL > VALID
 *
 * Rationale (verbatim from contract): a value that exists but violates the
 * contract (INVALID) is the worst case; a merely old value (STALE) is still
 * evidence but never "as fresh as VALID"; a present-but-incomplete value
 * (PARTIAL) is weakest but usable. STALE never behaves as fully VALID.
 */
const PRECEDENCE: Record<P4EvidenceStatus, number> = {
  INVALID: 7,
  AMBIGUOUS: 6,
  NOT_APPLICABLE: 5,
  INSUFFICIENT_HISTORY: 4,
  STALE: 3,
  UNAVAILABLE: 2,
  PARTIAL: 1,
  VALID: 0,
};

/** Merge multiple states by the §2.2 precedence — the worst (highest) wins. */
export function mergeStates(states: P4EvidenceStatus[]): P4EvidenceStatus {
  let worst: P4EvidenceStatus = "VALID";
  for (const state of states) {
    if (PRECEDENCE[state] > PRECEDENCE[worst]) worst = state;
  }
  return worst;
}

/**
 * Translate a frozen P3 trend state into the P4 move vocabulary (P3-18
 * classification of the same frozen epsilon deltas — P4-03 §2.3). A step
 * whose delta/classification is unavailable (or transitional, e.g. leader
 * identity change with undefined score comparison) yields UNKNOWN, never a
 * guessed sign.
 */
export function moveFromTrendState(state: P3TrendState): P4Move {
  switch (state) {
    case "IMPROVING":
      return "POSITIVE";
    case "DETERIORATING":
      return "NEGATIVE";
    case "STABLE":
      return "NEUTRAL";
    case "TRANSITION":
      return "UNKNOWN";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

/** All moves UNKNOWN — used when the latest step is unavailable. */
export const UNKNOWN_MOVES = {
  regime: "UNKNOWN",
  rotationScore: "UNKNOWN",
  momentum: "UNKNOWN",
  breadth: "UNKNOWN",
  relativeStrength: "UNKNOWN",
  leadershipScore: "UNKNOWN",
} as const satisfies Record<keyof import("./types").P4Moves, P4Move>;
