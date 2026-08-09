import type { P3AvailabilityState } from "./availability";
import type { P3Constituent } from "./context";

export interface P3ConstituentInput {
  coinId: number;
  membershipState: string;
  inclusionReason?: string | null;
  availabilityState: P3AvailabilityState;
  inputManifest?: Record<string, unknown> | null;
}

export interface P3PreparedConstituents {
  members: readonly P3Constituent[];
  memberCount: number;
  eligibleCount: number;
}

export function prepareConstituents(inputs: readonly P3ConstituentInput[]): P3PreparedConstituents {
  const seen = new Set<number>();
  const members = [...inputs]
    .sort((left, right) => left.coinId - right.coinId)
    .map((input) => {
      if (!Number.isInteger(input.coinId) || input.coinId <= 0) throw new Error("Constituent coinId must be a positive integer");
      if (seen.has(input.coinId)) throw new Error(`Duplicate constituent coinId: ${input.coinId}`);
      seen.add(input.coinId);
      return Object.freeze({ ...input });
    });
  return Object.freeze({
    members: Object.freeze(members),
    memberCount: members.length,
    eligibleCount: members.filter((member) => member.membershipState === "ELIGIBLE").length,
  });
}
