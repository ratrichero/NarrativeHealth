jest.mock("@/db", () => ({ db: { transaction: jest.fn() } }));

import {
  resolveMembershipEventsAt,
  resolveP3Membership,
  type P3MembershipEventForResolution,
} from "../membership";
import { db } from "@/db";

function event(
  id: number,
  coinId: number,
  eventType: P3MembershipEventForResolution["eventType"],
  effectiveAt: string,
  isPrimary: boolean | null = true,
): P3MembershipEventForResolution {
  return { id, coinId, eventType, effectiveAt: new Date(effectiveAt), isPrimary };
}

describe("P3 historical membership resolution", () => {
  test("resolves changing membership at the requested effective time", () => {
    const events = [
      event(1, 1, "ADDED", "2026-08-01T00:00:00Z"),
      event(2, 2, "ADDED", "2026-08-02T00:00:00Z"),
      event(3, 1, "REMOVED", "2026-08-03T00:00:00Z", null),
    ];

    expect(resolveMembershipEventsAt(events, new Date("2026-08-01T00:00:00Z")).members.map((m) => m.coinId)).toEqual([1]);
    expect(resolveMembershipEventsAt(events, new Date("2026-08-02T00:00:00Z")).members.map((m) => m.coinId)).toEqual([1, 2]);
    expect(resolveMembershipEventsAt(events, new Date("2026-08-03T00:00:00Z")).members.map((m) => m.coinId)).toEqual([2]);
  });

  test("is deterministic regardless of event input order", () => {
    const events = [
      event(2, 2, "ADDED", "2026-08-02T00:00:00Z"),
      event(1, 1, "ADDED", "2026-08-01T00:00:00Z"),
    ];
    const windowEnd = new Date("2026-08-02T00:00:00Z");
    const first = resolveMembershipEventsAt(events, windowEnd);
    const second = resolveMembershipEventsAt([...events].reverse(), windowEnd);
    expect(first).toEqual(second);
  });

  test("invalid primary transition is explicit partial history", () => {
    const result = resolveMembershipEventsAt([
      event(1, 1, "PRIMARY_SET", "2026-08-01T00:00:00Z", true),
    ], new Date("2026-08-02T00:00:00Z"));
    expect(result.availability).toBe("PARTIAL_HISTORY");
    expect(result.members).toEqual([]);
  });

  test("missing coverage returns NO_SNAPSHOT and never reads current membership", async () => {
    const responses: unknown[][] = [[], []];
    const tx = {
      select: jest.fn(() => {
        const response = responses.shift() ?? [];
        const builder: any = {
          from: () => builder,
          where: () => builder,
          orderBy: () => builder,
          limit: () => Promise.resolve(response),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
        };
        return builder;
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));

    const result = await resolveP3Membership(1, new Date("2026-08-03T00:00:00Z"));
    expect(result.availability).toBe("NO_SNAPSHOT");
    expect(result.constituents).toEqual([]);
    expect(tx.select).toHaveBeenCalledTimes(2);
  });
});
