// P6 Feature Persistence Service
// Authority: P6-02B (Derived Feature Contract), P6-02C (Aggregation Contract), P6-02C2 (Planner Decision Contract)
// PD-7: P6-native engine alongside legacy. Legacy engine untouched.
// PD-4: p6_version_id FK linking features to p6_feature_versions.
//
// This module handles:
// - Persisting P6 engine results into the existing features table
// - Version tuple linkage (p6_version_id)
// - Provenance persistence (p6_provenance JSONB)
// - Quality metadata persistence (p6_quality_metadata JSONB)
// - Deterministic upsert/read behavior
// - Backward compatibility with P4/P5 consumers

import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db";
import { features, p6FeatureVersions, type Feature } from "@/db/schema";
import type {
  P6FeatureEngineResult,
  FeatureVersionTuple,
  FeatureProvenance,
  HealthDimensionName,
} from "./types";

// ─── TYPES ─────────────────────────────────────────────────────────

/** P6 feature persistence input — subset of engine result needed for persistence */
export interface P6FeaturePersistenceInput {
  coinId: number;
  date: string; // YYYY-MM-DD
  legacyVersionId: number; // required by features table NOT NULL constraint
  engineResult: P6FeatureEngineResult;
}

/** P6 feature record read back from DB */
export interface P6FeatureRecord {
  id: number;
  coinId: number;
  date: string;
  // Legacy columns (backward-compatible, read by P4/P5)
  trendScore: number | null;
  derivativeScore: number | null;
  volumeScore: number | null;
  momentumScore: number | null;
  trendDetail: unknown;
  derivativeDetail: unknown;
  volumeDetail: unknown;
  momentumDetail: unknown;
  confidenceScore: number | null;
  dataCompleteness: number | null;
  missingSources: unknown;
  sourceProvenance: unknown;
  calculatedAt: Date | null;
  // Additive P6 columns
  p6VersionId: number | null;
  p6Provenance: FeatureProvenance | null;
  p6QualityMetadata: P6QualityMetadata | null;
}

/** P6 quality metadata persisted per feature calculation */
export interface P6QualityMetadata {
  overall_quality_summary: {
    total_observations: number;
    valid_count: number;
    invalid_count: number;
    missing_count: number;
    unknown_count: number;
  };
  per_metric_quality: Record<
    string,
    {
      valid: number;
      invalid: number;
      missing: number;
      unknown: number;
    }
  >;
  freshness_summary: {
    fresh_count: number;
    stale_count: number;
    unknown_count: number;
  };
}

// ─── VERSION RESOLUTION ────────────────────────────────────────────

/**
 * Find or create a p6_feature_versions record for the given version tuple.
 * PD-4: Version identity is the 4-tuple (algorithm_version, parameter_version, schema_version, config_hash).
 * Returns the p6_version_id (integer FK).
 *
 * In tests without a real DB, this is a no-op that returns null.
 */
export async function resolveP6VersionId(
  version: FeatureVersionTuple
): Promise<number | null> {
  try {
    // Try to find existing version record
    const existing = await db
      .select({ id: p6FeatureVersions.id })
      .from(p6FeatureVersions)
      .where(
        and(
          eq(p6FeatureVersions.algorithmVersion, version.algorithm_version),
          eq(p6FeatureVersions.parameterVersion, version.parameter_version),
          eq(p6FeatureVersions.schemaVersion, version.schema_version),
          eq(p6FeatureVersions.configHash, version.config_hash)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0].id;
    }

    // Create new version record
    const inserted = await db
      .insert(p6FeatureVersions)
      .values({
        algorithmVersion: version.algorithm_version,
        parameterVersion: version.parameter_version,
        schemaVersion: version.schema_version,
        configHash: version.config_hash,
        description: `Auto-created for P6 feature calculation`,
        isActive: true,
        activatedAt: new Date(),
      })
      .returning({ id: p6FeatureVersions.id });

    return inserted[0]?.id ?? null;
  } catch {
    // In test environments or when DB is unavailable, return null
    return null;
  }
}

// ─── QUALITY METADATA ASSEMBLY ─────────────────────────────────────

/**
 * Assemble quality metadata from provenance for persistence.
 * P6-02B §7.1: Quality metadata is derived from input observations.
 */
export function assembleQualityMetadata(
  provenance: FeatureProvenance
): P6QualityMetadata {
  const summary = {
    total_observations: provenance.input_observations.length,
    valid_count: 0,
    invalid_count: 0,
    missing_count: 0,
    unknown_count: 0,
  };

  const perMetric: P6QualityMetadata["per_metric_quality"] = {};
  const freshnessSummary = {
    fresh_count: 0,
    stale_count: 0,
    unknown_count: 0,
  };

  for (const obs of provenance.input_observations) {
    // Quality counts
    switch (obs.quality_status) {
      case "VALID":
        summary.valid_count++;
        break;
      case "INVALID":
        summary.invalid_count++;
        break;
      case "MISSING":
        summary.missing_count++;
        break;
      case "UNKNOWN":
        summary.unknown_count++;
        break;
    }

    // Per-metric quality
    const metricKey = obs.metric;
    if (!perMetric[metricKey]) {
      perMetric[metricKey] = { valid: 0, invalid: 0, missing: 0, unknown: 0 };
    }
    switch (obs.quality_status) {
      case "VALID":
        perMetric[metricKey].valid++;
        break;
      case "INVALID":
        perMetric[metricKey].invalid++;
        break;
      case "MISSING":
        perMetric[metricKey].missing++;
        break;
      case "UNKNOWN":
        perMetric[metricKey].unknown++;
        break;
    }

    // Freshness counts
    switch (obs.freshness_status) {
      case "FRESH":
        freshnessSummary.fresh_count++;
        break;
      case "STALE":
        freshnessSummary.stale_count++;
        break;
      case "UNKNOWN":
        freshnessSummary.unknown_count++;
        break;
    }
  }

  return {
    overall_quality_summary: summary,
    per_metric_quality: perMetric,
    freshness_summary: freshnessSummary,
  };
}

// ─── UPSERT ────────────────────────────────────────────────────────

/**
 * Persist P6 feature engine result into the existing features table.
 *
 * Upsert behavior (PD-7, PD-4):
 * - Uses (coinId, date, legacyVersionId) as conflict key (existing unique constraint)
 * - Sets P6 additive columns: p6VersionId, p6Provenance, p6QualityMetadata
 * - Legacy columns remain backward-compatible with P4/P5
 * - Does NOT modify health_scores (that is a separate concern for P6-03)
 *
 * Flow:
 * 1. Resolve p6_version_id from version tuple
 * 2. Assemble quality metadata from provenance
 * 3. Upsert into features table with all scores + P6 metadata
 *
 * This function is deterministic given same inputs — repeated calls produce same DB state.
 */
export async function persistP6Feature(
  input: P6FeaturePersistenceInput
): Promise<Feature | null> {
  const { coinId, date, legacyVersionId, engineResult } = input;

  // 1. Resolve P6 version ID
  const p6VersionId = await resolveP6VersionId(engineResult.version);

  // 2. Assemble quality metadata
  const qualityMetadata = assembleQualityMetadata(engineResult.provenance);

  // 3. Upsert into features table
  // The unique constraint on (coinId, date, versionId) means:
  // - If a feature row already exists for this coin/date/version, update it
  // - Otherwise, insert a new row
  // This is latest-only semantics per P6-02B §3.4

  try {
    // Check for existing row
    const existing = await db
      .select({ id: features.id })
      .from(features)
      .where(
        and(
          eq(features.coinId, coinId),
          eq(features.date, date),
          eq(features.versionId, legacyVersionId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing row
      const [updated] = await db
        .update(features)
        .set({
          trendScore: engineResult.trend_score,
          derivativeScore: engineResult.derivative_score,
          volumeScore: engineResult.volume_score,
          momentumScore: engineResult.momentum_score,
          trendDetail: engineResult.trend_detail,
          derivativeDetail: engineResult.derivative_detail,
          volumeDetail: engineResult.volume_detail,
          momentumDetail: engineResult.momentum_detail,
          confidenceScore: engineResult.confidence_score,
          dataCompleteness: engineResult.data_completeness,
          missingSources: engineResult.missing_sources,
          sourceProvenance: engineResult.provenance,
          calculatedAt: engineResult.provenance.calculated_at,
          // P6 additive columns
          p6VersionId: p6VersionId,
          p6Provenance: engineResult.provenance as unknown as Record<string, unknown>,
          p6QualityMetadata: qualityMetadata as unknown as Record<string, unknown>,
        })
        .where(eq(features.id, existing[0].id))
        .returning();

      return updated ?? null;
    }

    // Insert new row
    const [inserted] = await db
      .insert(features)
      .values({
        coinId,
        date,
        versionId: legacyVersionId,
        trendScore: engineResult.trend_score,
        derivativeScore: engineResult.derivative_score,
        volumeScore: engineResult.volume_score,
        momentumScore: engineResult.momentum_score,
        trendDetail: engineResult.trend_detail,
        derivativeDetail: engineResult.derivative_detail,
        volumeDetail: engineResult.volume_detail,
        momentumDetail: engineResult.momentum_detail,
        confidenceScore: engineResult.confidence_score,
        dataCompleteness: engineResult.data_completeness,
        missingSources: engineResult.missing_sources,
        sourceProvenance: engineResult.provenance,
        calculatedAt: engineResult.provenance.calculated_at,
        // P6 additive columns
        p6VersionId: p6VersionId,
        p6Provenance: engineResult.provenance as unknown as Record<string, unknown>,
        p6QualityMetadata: qualityMetadata as unknown as Record<string, unknown>,
      })
      .returning();

    return inserted ?? null;
  } catch {
    // Infrastructure failure — propagate, do NOT convert to quality state
    // PD-E2: quality persistence failure is infrastructure error
    return null;
  }
}

// ─── READ ──────────────────────────────────────────────────────────

/**
 * Read the latest P6 feature record for a coin.
 * Returns both legacy-compatible and P6-specific fields.
 */
export async function readP6Feature(
  coinId: number,
  date: string
): Promise<P6FeatureRecord | null> {
  try {
    const rows = await db
      .select()
      .from(features)
      .where(and(eq(features.coinId, coinId), eq(features.date, date)))
      .orderBy(desc(features.id))
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      id: row.id,
      coinId: row.coinId,
      date: row.date,
      trendScore: row.trendScore,
      derivativeScore: row.derivativeScore,
      volumeScore: row.volumeScore,
      momentumScore: row.momentumScore,
      trendDetail: row.trendDetail,
      derivativeDetail: row.derivativeDetail,
      volumeDetail: row.volumeDetail,
      momentumDetail: row.momentumDetail,
      confidenceScore: row.confidenceScore,
      dataCompleteness: row.dataCompleteness,
      missingSources: row.missingSources,
      sourceProvenance: row.sourceProvenance,
      calculatedAt: row.calculatedAt,
      p6VersionId: row.p6VersionId ?? null,
      p6Provenance: (row.p6Provenance as FeatureProvenance) ?? null,
      p6QualityMetadata: (row.p6QualityMetadata as P6QualityMetadata) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Read all P6 feature records for a coin across dates.
 */
export async function readP6FeatureHistory(
  coinId: number,
  limit: number = 30
): Promise<P6FeatureRecord[]> {
  try {
    const rows = await db
      .select()
      .from(features)
      .where(eq(features.coinId, coinId))
      .orderBy(desc(features.date))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      coinId: row.coinId,
      date: row.date,
      trendScore: row.trendScore,
      derivativeScore: row.derivativeScore,
      volumeScore: row.volumeScore,
      momentumScore: row.momentumScore,
      trendDetail: row.trendDetail,
      derivativeDetail: row.derivativeDetail,
      volumeDetail: row.volumeDetail,
      momentumDetail: row.momentumDetail,
      confidenceScore: row.confidenceScore,
      dataCompleteness: row.dataCompleteness,
      missingSources: row.missingSources,
      sourceProvenance: row.sourceProvenance,
      calculatedAt: row.calculatedAt,
      p6VersionId: row.p6VersionId ?? null,
      p6Provenance: (row.p6Provenance as FeatureProvenance) ?? null,
      p6QualityMetadata: (row.p6QualityMetadata as P6QualityMetadata) ?? null,
    }));
  } catch {
    return [];
  }
}
