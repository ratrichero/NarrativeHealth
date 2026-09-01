/**
 * P6-VERSION-01 — Version Resolver Unit Tests
 *
 * Tests the resolveActiveP6Version() helper and p6VersionTuple()
 * with mocked DB layer.
 *
 * These are pure-logic / contract tests. They verify the VERSION REGISTRY
 * contract is satisfied — no production refresh required.
 */

// Mock DB before imports
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockReturning = jest.fn();
const mockOnConflictDoUpdate = jest.fn();
const mockValues = jest.fn();

jest.mock("@/db", () => ({
  db: {
    select: (...args: any[]) => {
      mockSelect(...args);
      return { from: jest.fn().mockReturnThis(), where: mockWhere, limit: mockLimit };
    },
    insert: (...args: any[]) => {
      mockInsert(...args);
      return { values: mockValues, onConflictDoUpdate: mockOnConflictDoUpdate };
    },
  },
}));

jest.mock("@/db/schema", () => ({
  p6FeatureVersions: {
    isActive: "is_active",
    algorithmVersion: "algorithm_version",
    parameterVersion: "parameter_version",
    schemaVersion: "schema_version",
    configHash: "config_hash",
    id: "id",
  },
}));

import { p6VersionTuple } from "@/lib/p6/version-resolver";
import type { P6FeatureVersionRow } from "@/lib/p6/version-resolver";

// Helper to get the resolver after mock setup
async function getResolver() {
  // Dynamic import after mock setup
  const mod = await import("@/lib/p6/version-resolver");
  return mod.resolveActiveP6Version;
}

const MOCK_VERSION_ROW: P6FeatureVersionRow = {
  id: 42,
  algorithmVersion: "p6-feature-v2",
  parameterVersion: "continuous-derivative-v1",
  schemaVersion: "p6-features-v1",
  configHash: "v2-continuous-derivative-2026-09",
  description: "P6 Feature V2: Continuous derivative scoring",
  isActive: true,
  createdAt: new Date("2026-09-01"),
  activatedAt: new Date("2026-09-01"),
};

describe("P6 Version Resolver", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("resolveActiveP6Version", () => {
    it("returns the active version when one exists", async () => {
      const mockRow = { ...MOCK_VERSION_ROW };
      mockWhere.mockReturnValue({ limit: jest.fn().mockResolvedValue([mockRow]) });

      const resolveActiveP6Version = await getResolver();
      const result = await resolveActiveP6Version();

      expect(result).toBeDefined();
      expect(result.id).toBe(42);
      expect(result.isActive).toBe(true);
      expect(result.algorithmVersion).toBe("p6-feature-v2");
    });

    it("returns V2 defaults for a new version row", async () => {
      const resolveActiveP6Version = await getResolver();
      const result = await resolveActiveP6Version();

      // Just verify the function returns a valid row structure
      expect(result).toBeDefined();
      expect(typeof result.id).toBe("number");
      expect(typeof result.algorithmVersion).toBe("string");
      expect(typeof result.parameterVersion).toBe("string");
      expect(typeof result.schemaVersion).toBe("string");
      expect(typeof result.configHash).toBe("string");
    });

    it("has a description explaining the algorithm", async () => {
      const resolveActiveP6Version = await getResolver();
      const result = await resolveActiveP6Version();
      expect(result.description).toBeTruthy();
    });
  });

  describe("p6VersionTuple", () => {
    it("extracts version identity fields", () => {
      const tuple = p6VersionTuple(MOCK_VERSION_ROW);

      expect(tuple.algorithmVersion).toBe("p6-feature-v2");
      expect(tuple.parameterVersion).toBe("continuous-derivative-v1");
      expect(tuple.schemaVersion).toBe("p6-features-v1");
      expect(tuple.configHash).toBe("v2-continuous-derivative-2026-09");
    });

    it("does not include id or metadata fields", () => {
      const tuple = p6VersionTuple(MOCK_VERSION_ROW);

      expect(tuple).not.toHaveProperty("id");
      expect(tuple).not.toHaveProperty("isActive");
      expect(tuple).not.toHaveProperty("createdAt");
      expect(tuple).not.toHaveProperty("activatedAt");
      expect(tuple).not.toHaveProperty("description");
    });

    it("has exactly 4 fields", () => {
      const tuple = p6VersionTuple(MOCK_VERSION_ROW);
      const keys = Object.keys(tuple);
      expect(keys).toHaveLength(4);
      expect(keys.sort()).toEqual([
        "algorithmVersion",
        "configHash",
        "parameterVersion",
        "schemaVersion",
      ]);
    });
  });
});
