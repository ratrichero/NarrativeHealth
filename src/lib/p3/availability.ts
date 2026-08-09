export const P3_AVAILABILITY_STATES = [
  "VALID",
  "MISSING",
  "INVALID",
  "STALE",
  "INSUFFICIENT_HISTORY",
  "NOT_APPLICABLE",
  "AMBIGUOUS",
] as const;

export type P3AvailabilityState = (typeof P3_AVAILABILITY_STATES)[number];

export type P3Window = "1D" | "3D" | "7D" | "14D";

export interface P3Availability<T> {
  value: T | null;
  state: P3AvailabilityState;
  reason?: string;
  confidenceContribution?: number | null;
  provenance?: Record<string, unknown>;
}

export function valid<T>(value: T, provenance?: Record<string, unknown>): P3Availability<T> {
  return { value, state: "VALID", provenance };
}

export function unavailable<T>(state: Exclude<P3AvailabilityState, "VALID">, reason: string, provenance?: Record<string, unknown>): P3Availability<T> {
  return { value: null, state, reason, provenance };
}

export function propagateAvailability<T>(inputs: Array<P3Availability<unknown>>, value: T | null = null): P3Availability<T> {
  const firstUnavailable = inputs.find((input) => input.state !== "VALID");
  if (firstUnavailable) {
    return {
      value: null,
      state: firstUnavailable.state,
      reason: firstUnavailable.reason ?? "Required input is unavailable",
      confidenceContribution: firstUnavailable.confidenceContribution,
      provenance: firstUnavailable.provenance,
    };
  }
  return { value, state: "VALID" };
}
