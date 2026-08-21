// P6 Freshness Policy Service — DB-backed policy lookup + evaluation
// Frozen contract: P6-01C-C (commit 6179135)

import { db } from "@/db";
import { eq, and } from "drizzle-orm";
import { p6FreshnessPolicies, type P6FreshnessPolicy } from "@/db/schema";
import type {
  FreshnessPolicy,
  FreshnessEvaluationResult,
  PolicyIdentity,
} from "./types";
import { evaluateFreshness, resolvePolicy } from "./evaluator";
import type { SourceId, CanonicalMetric, Timeframe } from "../registry/types";

// ============================================================
// Policy Conversion (DB row → domain model)
// ============================================================

function dbRowToPolicy(row: P6FreshnessPolicy): FreshnessPolicy {
  return {
    sourceId: row.sourceId as SourceId,
    metric: row.metric as CanonicalMetric,
    timeframe: row.timeframe as Timeframe,
    expectedIntervalMs: row.expectedIntervalMs,
    staleAfterMs: row.staleAfterMs,
    configVersion: row.configVersion,
    description: row.description,
  };
}

// ============================================================
// Policy Lookup
// ============================================================

/**
 * Get all freshness policies for a specific config version.
 */
export async function getPoliciesForConfigVersion(
  configVersion: number
): Promise<FreshnessPolicy[]> {
  const rows = await db
    .select()
    .from(p6FreshnessPolicies)
    .where(eq(p6FreshnessPolicies.configVersion, configVersion));
  return rows.map(dbRowToPolicy);
}

/**
 * Get the active freshness policies (for the active config version).
 */
export async function getActivePolicies(): Promise<FreshnessPolicy[]> {
  // Get the active config version
  const { p6RegistryConfigVersions } = await import("@/db/schema");
  const [activeVersion] = await db
    .select()
    .from(p6RegistryConfigVersions)
    .where(eq(p6RegistryConfigVersions.isActive, true))
    .limit(1);

  if (!activeVersion) return [];
  return getPoliciesForConfigVersion(activeVersion.version);
}

/**
 * Get a specific freshness policy by identity.
 */
export async function getPolicy(
  identity: PolicyIdentity
): Promise<FreshnessPolicy | null> {
  const [row] = await db
    .select()
    .from(p6FreshnessPolicies)
    .where(
      and(
        eq(p6FreshnessPolicies.sourceId, identity.sourceId),
        eq(p6FreshnessPolicies.metric, identity.metric),
        eq(p6FreshnessPolicies.timeframe, identity.timeframe),
        eq(p6FreshnessPolicies.configVersion, identity.configVersion)
      )
    )
    .limit(1);

  return row ? dbRowToPolicy(row) : null;
}

// ============================================================
// Freshness Evaluation (DB-backed)
// ============================================================

/**
 * Evaluate freshness for an observation using DB-backed policy lookup.
 */
export async function evaluateObservationFreshnessDB(params: {
  sourceId: SourceId;
  metric: CanonicalMetric;
  timeframe: Timeframe;
  configVersion: number;
  observedAt: Date | null;
  observedAtIsUnknown: boolean;
  evaluationTime?: Date;
}): Promise<FreshnessEvaluationResult> {
  const evaluationTime = params.evaluationTime ?? new Date();
  const policy = await getPolicy({
    sourceId: params.sourceId,
    metric: params.metric,
    timeframe: params.timeframe,
    configVersion: params.configVersion,
  });

  return evaluateFreshness({
    observedAt: params.observedAt,
    observedAtIsUnknown: params.observedAtIsUnknown,
    evaluationTime,
    policy,
  });
}

// ============================================================
// Policy CRUD (for admin/seed use)
// ============================================================

/**
 * Insert a freshness policy. Fails on duplicate identity.
 */
export async function insertPolicy(
  policy: FreshnessPolicy
): Promise<P6FreshnessPolicy> {
  const [row] = await db
    .insert(p6FreshnessPolicies)
    .values({
      sourceId: policy.sourceId,
      metric: policy.metric,
      timeframe: policy.timeframe,
      expectedIntervalMs: policy.expectedIntervalMs,
      staleAfterMs: policy.staleAfterMs,
      configVersion: policy.configVersion,
      description: policy.description,
    })
    .returning();
  return row;
}

/**
 * Upsert a freshness policy (insert or update on conflict).
 */
export async function upsertPolicy(
  policy: FreshnessPolicy
): Promise<P6FreshnessPolicy> {
  const [row] = await db
    .insert(p6FreshnessPolicies)
    .values({
      sourceId: policy.sourceId,
      metric: policy.metric,
      timeframe: policy.timeframe,
      expectedIntervalMs: policy.expectedIntervalMs,
      staleAfterMs: policy.staleAfterMs,
      configVersion: policy.configVersion,
      description: policy.description,
    })
    .onConflictDoUpdate({
      target: [
        p6FreshnessPolicies.sourceId,
        p6FreshnessPolicies.metric,
        p6FreshnessPolicies.timeframe,
        p6FreshnessPolicies.configVersion,
      ],
      set: {
        expectedIntervalMs: policy.expectedIntervalMs,
        staleAfterMs: policy.staleAfterMs,
        description: policy.description,
      },
    })
    .returning();
  return row;
}

/**
 * Delete all policies for a config version.
 */
export async function deletePoliciesForConfigVersion(
  configVersion: number
): Promise<void> {
  await db
    .delete(p6FreshnessPolicies)
    .where(eq(p6FreshnessPolicies.configVersion, configVersion));
}
