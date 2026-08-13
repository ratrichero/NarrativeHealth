jest.mock("@/db", () => ({
  db: {
    transaction: jest.fn(),
    select: jest.fn(),
  },
}));

import { db } from "@/db";
import {
  getIntelligenceCorrection,
  isIntelligenceSuperseded,
  resolveEffectiveSnapshotId,
  type P3HistoricalCorrection,
} from "../membership";

function setupSelectMock(responses: Array<unknown[] | null>) {
  const queue = [...responses];
  (db.select as jest.Mock).mockImplementation(() => {
    const data = queue.shift() ?? [];
    const builder: any = {
      from: () => builder,
      where: () => builder,
      limit: () => builder,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(data).then(resolve),
    };
    return builder;
  });
}

describe("P3-10E.17 Historical Correction Ledger", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getIntelligenceCorrection", () => {
    test("returns null when no correction exists for valid intelligenceId", async () => {
      setupSelectMock([[]]);

      const result = await getIntelligenceCorrection(1);
      expect(result).toBeNull();
    });

    test("returns correction record when one exists", async () => {
      const correctionRow = {
        id: 1,
        originalIntelligenceId: 1,
        originalSnapshotId: 7,
        correctedSnapshotId: 2,
        reason: "Invalid 0-member snapshot referenced by failed P3-10E.11 execution.",
        correctedAt: new Date("2026-08-11T12:00:00.000Z"),
        algorithmKey: "p3-orchestrator",
        algorithmVersion: "1",
        correctedBy: "P3-10E.17",
        provenance: { originalAvailabilityState: "INSUFFICIENT_HISTORY", originalMemberCount: 0 },
      };
      setupSelectMock([[correctionRow]]);

      const result = await getIntelligenceCorrection(1);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(1);
      expect(result!.originalIntelligenceId).toBe(1);
      expect(result!.originalSnapshotId).toBe(7);
      expect(result!.correctedSnapshotId).toBe(2);
      expect(result!.reason).toContain("Invalid 0-member snapshot");
    });

    test("returns null for invalid intelligenceId", async () => {
      const result = await getIntelligenceCorrection(0);
      expect(result).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });

    test("returns null for negative intelligenceId", async () => {
      const result = await getIntelligenceCorrection(-1);
      expect(result).toBeNull();
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe("resolveEffectiveSnapshotId", () => {
    test("returns original snapshot when no correction exists", async () => {
      setupSelectMock([[{ membershipSnapshotId: 2 }], []]);

      const result = await resolveEffectiveSnapshotId(1);
      expect(result.intelligenceId).toBe(1);
      expect(result.originalSnapshotId).toBe(2);
      expect(result.effectiveSnapshotId).toBe(2);
      expect(result.isSuperseded).toBe(false);
      expect(result.correction).toBeNull();
    });

    test("returns corrected snapshot when correction exists", async () => {
      setupSelectMock([
        [{ membershipSnapshotId: 7 }],
        [{
          id: 1,
          originalIntelligenceId: 1,
          originalSnapshotId: 7,
          correctedSnapshotId: 2,
          reason: "Invalid 0-member snapshot referenced by failed P3-10E.11 execution.",
          correctedAt: new Date("2026-08-11T12:00:00.000Z"),
          algorithmKey: "p3-orchestrator",
          algorithmVersion: "1",
          correctedBy: "P3-10E.17",
          provenance: { originalAvailabilityState: "INSUFFICIENT_HISTORY", originalMemberCount: 0 },
        }],
      ]);

      const result = await resolveEffectiveSnapshotId(1);
      expect(result.intelligenceId).toBe(1);
      expect(result.originalSnapshotId).toBe(7);
      expect(result.effectiveSnapshotId).toBe(2);
      expect(result.isSuperseded).toBe(true);
      expect(result.correction).not.toBeNull();
      expect(result.correction!.correctedSnapshotId).toBe(2);
    });

    test("returns nulls for intelligenceId that does not exist", async () => {
      setupSelectMock([null, []]);

      const result = await resolveEffectiveSnapshotId(9999);
      expect(result.intelligenceId).toBe(9999);
      expect(result.originalSnapshotId).toBeNull();
      expect(result.effectiveSnapshotId).toBeNull();
      expect(result.isSuperseded).toBe(false);
      expect(result.correction).toBeNull();
    });

    test("returns nulls for invalid intelligenceId", async () => {
      const result = await resolveEffectiveSnapshotId(0);
      expect(result.intelligenceId).toBe(0);
      expect(result.originalSnapshotId).toBeNull();
      expect(result.effectiveSnapshotId).toBeNull();
      expect(result.isSuperseded).toBe(false);
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe("isIntelligenceSuperseded", () => {
    test("returns false when no correction exists", async () => {
      setupSelectMock([[{ membershipSnapshotId: 2 }], []]);

      const result = await isIntelligenceSuperseded(1);
      expect(result).toBe(false);
    });

    test("returns true when correction exists", async () => {
      setupSelectMock([
        [{ membershipSnapshotId: 7 }],
        [{
          id: 1,
          originalIntelligenceId: 1,
          originalSnapshotId: 7,
          correctedSnapshotId: 2,
          reason: "Invalid 0-member snapshot referenced by failed P3-10E.11 execution.",
          correctedAt: new Date("2026-08-11T12:00:00.000Z"),
          algorithmKey: "p3-orchestrator",
          algorithmVersion: "1",
          correctedBy: "P3-10E.17",
          provenance: { originalAvailabilityState: "INSUFFICIENT_HISTORY", originalMemberCount: 0 },
        }],
      ]);

      const result = await isIntelligenceSuperseded(1);
      expect(result).toBe(true);
    });

    test("returns false for non-existent intelligence", async () => {
      setupSelectMock([null, []]);

      const result = await isIntelligenceSuperseded(9999);
      expect(result).toBe(false);
    });
  });

  describe("Consumer read semantics", () => {
    test("downstream can detect supersession via isSuperseded flag", async () => {
      setupSelectMock([
        [{ membershipSnapshotId: 7 }],
        [{
          id: 1,
          originalIntelligenceId: 1,
          originalSnapshotId: 7,
          correctedSnapshotId: 2,
          reason: "Invalid 0-member snapshot referenced by failed P3-10E.11 execution.",
          correctedAt: new Date("2026-08-11T12:00:00.000Z"),
          algorithmKey: "p3-orchestrator",
          algorithmVersion: "1",
          correctedBy: "P3-10E.17",
          provenance: { originalAvailabilityState: "INSUFFICIENT_HISTORY", originalMemberCount: 0 },
        }],
      ]);

      const resolution = await resolveEffectiveSnapshotId(1);
      expect(resolution.isSuperseded).toBe(true);
      expect(resolution.correction!.reason).toBeDefined();
      expect(resolution.correction!.correctedSnapshotId).toBe(2);
    });

    test("downstream can distinguish authoritative from invalid snapshot via correction ledger", async () => {
      setupSelectMock([
        [{ membershipSnapshotId: 7 }],
        [{
          id: 1,
          originalIntelligenceId: 1,
          originalSnapshotId: 7,
          correctedSnapshotId: 2,
          reason: "Invalid 0-member snapshot referenced by failed P3-10E.11 execution.",
          correctedAt: new Date("2026-08-11T12:00:00.000Z"),
          algorithmKey: "p3-orchestrator",
          algorithmVersion: "1",
          correctedBy: "P3-10E.17",
          provenance: { originalAvailabilityState: "INSUFFICIENT_HISTORY", originalMemberCount: 0 },
        }],
      ]);

      const resolution = await resolveEffectiveSnapshotId(1);

      expect(resolution.originalSnapshotId).toBe(7);
      expect(resolution.effectiveSnapshotId).toBe(2);
      expect(resolution.isSuperseded).toBe(true);
    });
  });
});
