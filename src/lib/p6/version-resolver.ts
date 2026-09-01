/**
 * P6 Feature Version Resolver
 * 
 * Resolves or creates the active P6 feature algorithm version.
 * Used by the refresh pipeline to tag feature records with explicit
 * algorithm provenance.
 * 
 * Resolves from the p6_feature_versions table (P6-02E, PD-4).
 * The V2 entry represents the continuous derivative scoring implementation.
 * 
 * Invariant: the ACTIVE version is determined by the single-is_active row.
 * If no active version exists, V2 is created automatically as the default.
 */

import { db } from "@/db";
import { p6FeatureVersions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

/** V2 identity: continuous derivative scoring (commit 58c99ce+) */
const P6_V2_DEFAULTS = {
  algorithmVersion: "p6-feature-v2",
  parameterVersion: "continuous-derivative-v1",
  schemaVersion: "p6-features-v1",
  configHash: "v2-continuous-derivative-2026-09",
  description:
    "P6 Feature V2: Continuous derivative scoring (tanh-based), " +
    "continuous OI/funding components, accumulation bonus. " +
    "Replaces step-function V1 scoring.",
};

export type P6FeatureVersionRow = {
  id: number;
  algorithmVersion: string;
  parameterVersion: string;
  schemaVersion: string;
  configHash: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  activatedAt: Date | null;
};

/**
 * Resolve the active P6 feature version.
 * 
 * If an active version exists → return it (idempotent).
 * If no active version exists → insert V2 and return it.
 * 
 * This is safe for concurrent refresh calls: the UNIQUE constraint
 * on (algorithmVersion, parameterVersion, schemaVersion, configHash)
 * prevents duplicate V2 rows.
 */
export async function resolveActiveP6Version(): Promise<P6FeatureVersionRow> {
  // 1. Try to find the existing active version
  const [active] = await db
    .select()
    .from(p6FeatureVersions)
    .where(eq(p6FeatureVersions.isActive, true))
    .limit(1);

  if (active) {
    return active;
  }

  // 2. No active version exists — create V2 (first refresh after deploy)
  const [created] = await db
    .insert(p6FeatureVersions)
    .values({
      algorithmVersion: P6_V2_DEFAULTS.algorithmVersion,
      parameterVersion: P6_V2_DEFAULTS.parameterVersion,
      schemaVersion: P6_V2_DEFAULTS.schemaVersion,
      configHash: P6_V2_DEFAULTS.configHash,
      description: P6_V2_DEFAULTS.description,
      isActive: true,
      activatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        p6FeatureVersions.algorithmVersion,
        p6FeatureVersions.parameterVersion,
        p6FeatureVersions.schemaVersion,
        p6FeatureVersions.configHash,
      ],
      set: {
        isActive: true,
        activatedAt: new Date(),
      },
    })
    .returning();

  return created;
}

/**
 * Extract the version tuple fields from a P6FeatureVersionRow
 * for embedding in downstream snapshot/provenance records.
 */
export function p6VersionTuple(row: P6FeatureVersionRow) {
  return {
    algorithmVersion: row.algorithmVersion,
    parameterVersion: row.parameterVersion,
    schemaVersion: row.schemaVersion,
    configHash: row.configHash,
  };
}
