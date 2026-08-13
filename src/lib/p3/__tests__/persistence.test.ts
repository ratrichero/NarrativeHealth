jest.mock("@/db", () => ({ db: { transaction: jest.fn() } }));

import { db } from "@/db";
import { createCalculationContext, normalizeResult } from "../context";
import { persistP3Calculation, P3PersistenceError } from "../persistence";
import { resolveP3Window } from "../windows";

function payload(availabilityState: "VALID" | "MISSING" | "INSUFFICIENT_HISTORY" | "INVALID" = "VALID") {
  const resolved = resolveP3Window("1D", new Date("2026-08-09T00:00:00.000Z"));
  const context = createCalculationContext({
    narrativeId: 1,
    calculationMode: "observed",
    window: "1D",
    windowStart: resolved.windowStart,
    windowEnd: resolved.windowEnd,
    calculatedAt: new Date("2026-08-09T00:10:00.000Z"),
    algorithmKey: "kernel-test",
    algorithmVersion: "1",
    constituents: [],
    sourceAvailability: {},
  });
  return {
    context,
    result: normalizeResult(context, { availabilityState, confidence: null, metrics: {} }),
    membershipSource: "captured_current",
    membershipMode: "observed",
  };
}

describe("P3 persistence boundary", () => {
  test("treats duplicate calculation identity as idempotent without update", async () => {
    const returning = jest.fn().mockResolvedValue([]);
    const onConflictDoNothing = jest.fn(() => ({ returning }));
    const values = jest.fn(() => ({ onConflictDoNothing }));
    const insert = jest.fn(() => ({ values }));
    const limit = jest.fn().mockResolvedValue([{ id: 77 }]);
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    const tx = { insert, select };
    (db.transaction as jest.Mock).mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));

    await expect(persistP3Calculation(payload("VALID"))).resolves.toMatchObject({ intelligenceId: 77, inserted: false });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe("P3 persistence defense-in-depth", () => {
  test("Test 7: rejects INSUFFICIENT_HISTORY result", async () => {
    const txMock = jest.fn();
    (db.transaction as jest.Mock).mockImplementation(txMock);

    await expect(persistP3Calculation(payload("INSUFFICIENT_HISTORY")))
      .rejects.toThrow(P3PersistenceError);
    expect(txMock).not.toHaveBeenCalled();
  });

  test("Test 7: rejects MISSING result", async () => {
    const txMock = jest.fn();
    (db.transaction as jest.Mock).mockImplementation(txMock);

    await expect(persistP3Calculation(payload("MISSING")))
      .rejects.toThrow(P3PersistenceError);
    expect(txMock).not.toHaveBeenCalled();
  });

  test("Test 7: rejects INVALID result", async () => {
    const txMock = jest.fn();
    (db.transaction as jest.Mock).mockImplementation(txMock);

    await expect(persistP3Calculation(payload("INVALID")))
      .rejects.toThrow(P3PersistenceError);
    expect(txMock).not.toHaveBeenCalled();
  });

  test("Test 8: allows persistence for VALID result", async () => {
    const insertReturning = jest.fn().mockResolvedValue([{ id: 99 }]);
    const constituentReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
    const onConflictDoNothing = jest.fn(() => ({ returning: insertReturning }));
    const values = jest.fn(() => ({ onConflictDoNothing, returning: constituentReturning }));
    const insert = jest.fn(() => ({ values }));
    const limit = jest.fn().mockResolvedValue([{ id: 99 }]);
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));
    const tx = { insert, select };
    (db.transaction as jest.Mock).mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));

    const result = await persistP3Calculation(payload("VALID"));
    expect(result.intelligenceId).toBe(99);
    expect(result.inserted).toBe(true);
  });
});
