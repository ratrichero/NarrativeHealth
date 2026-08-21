// P6 Source Registry — Query Service
// Frozen contract: P6-01C (commit 18fb0f0)

import { db } from "@/db";
import { eq, and } from "drizzle-orm";
import {
  p6SourceDefinitions,
  p6SourceCapabilities,
  p6RegistryConfigVersions,
  type P6SourceDefinition,
  type P6SourceCapability,
  type P6RegistryConfigVersion,
} from "@/db/schema";
import {
  type SourceId,
  type CanonicalMetric,
  type Timeframe,
  type SourceRegistryStatus,
  type SourceType,
  isValidSourceId,
  isValidCanonicalMetric,
  isValidTimeframe,
  isValidRegistryStatus,
  isValidSourceType,
} from "./types";

// ============================================================
// Registry Query Functions
// ============================================================

/**
 * Get a source definition by source_id.
 * Returns undefined if source does not exist.
 */
export async function getSourceDefinition(
  sourceId: SourceId
): Promise<P6SourceDefinition | undefined> {
  const [row] = await db
    .select()
    .from(p6SourceDefinitions)
    .where(eq(p6SourceDefinitions.sourceId, sourceId))
    .limit(1);
  return row;
}

/**
 * Get all source definitions.
 */
export async function getAllSourceDefinitions(): Promise<P6SourceDefinition[]> {
  return db.select().from(p6SourceDefinitions);
}

/**
 * Get all ACTIVE source definitions.
 */
export async function getActiveSourceDefinitions(): Promise<P6SourceDefinition[]> {
  return db
    .select()
    .from(p6SourceDefinitions)
    .where(eq(p6SourceDefinitions.status, "ACTIVE"));
}

/**
 * Get capabilities for a specific source.
 */
export async function getSourceCapabilities(
  sourceId: SourceId
): Promise<P6SourceCapability[]> {
  return db
    .select()
    .from(p6SourceCapabilities)
    .where(eq(p6SourceCapabilities.sourceId, sourceId));
}

/**
 * Get all capabilities for a specific metric across all sources.
 */
export async function getCapabilitiesForMetric(
  metric: CanonicalMetric
): Promise<P6SourceCapability[]> {
  return db
    .select()
    .from(p6SourceCapabilities)
    .where(eq(p6SourceCapabilities.metric, metric));
}

/**
 * Check if a source supports a specific metric at a specific timeframe.
 */
export async function isSourceCapabilitySupported(
  sourceId: SourceId,
  metric: CanonicalMetric,
  timeframe: Timeframe
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(p6SourceCapabilities)
    .where(
      and(
        eq(p6SourceCapabilities.sourceId, sourceId),
        eq(p6SourceCapabilities.metric, metric),
        eq(p6SourceCapabilities.timeframe, timeframe)
      )
    )
    .limit(1);
  return row?.isSupported ?? false;
}

/**
 * Get all supported (source, metric, timeframe) combinations.
 */
export async function getAllSupportedCapabilities(): Promise<P6SourceCapability[]> {
  return db
    .select()
    .from(p6SourceCapabilities)
    .where(eq(p6SourceCapabilities.isSupported, true));
}

/**
 * Get the active registry config version.
 */
export async function getActiveConfigVersion(): Promise<P6RegistryConfigVersion | undefined> {
  const [row] = await db
    .select()
    .from(p6RegistryConfigVersions)
    .where(eq(p6RegistryConfigVersions.isActive, true))
    .limit(1);
  return row;
}

/**
 * Get all registry config versions.
 */
export async function getAllConfigVersions(): Promise<P6RegistryConfigVersion[]> {
  return db.select().from(p6RegistryConfigVersions);
}

// ============================================================
// Validation Functions
// ============================================================

/**
 * Validate that a source_id exists in the registry and is ACTIVE.
 */
export async function validateSourceActive(sourceId: string): Promise<{
  valid: boolean;
  source?: P6SourceDefinition;
  error?: string;
}> {
  if (!isValidSourceId(sourceId)) {
    return { valid: false, error: `Invalid source_id: ${sourceId}` };
  }
  const source = await getSourceDefinition(sourceId as SourceId);
  if (!source) {
    return { valid: false, error: `Source not found in registry: ${sourceId}` };
  }
  if (source.status !== "ACTIVE") {
    return { valid: false, source, error: `Source ${sourceId} is ${source.status}, not ACTIVE` };
  }
  return { valid: true, source };
}

/**
 * Get all sources that support a specific metric at a specific timeframe.
 */
export async function getSourcesForCapability(
  metric: CanonicalMetric,
  timeframe: Timeframe
): Promise<P6SourceDefinition[]> {
  const caps = await db
    .select({ sourceId: p6SourceCapabilities.sourceId })
    .from(p6SourceCapabilities)
    .where(
      and(
        eq(p6SourceCapabilities.metric, metric),
        eq(p6SourceCapabilities.timeframe, timeframe),
        eq(p6SourceCapabilities.isSupported, true)
      )
    );

  if (caps.length === 0) return [];

  const sourceIds = [...new Set(caps.map((c) => c.sourceId))];
  const sources: P6SourceDefinition[] = [];
  for (const sid of sourceIds) {
    const source = await getSourceDefinition(sid as SourceId);
    if (source) sources.push(source);
  }
  return sources;
}

// ============================================================
// Pure Validation (no DB)
// ============================================================

/**
 * Validate source type against frozen vocabulary (pure function).
 */
export function validateSourceType(value: string): boolean {
  return isValidSourceType(value);
}

/**
 * Validate source status against frozen vocabulary (pure function).
 */
export function validateSourceStatus(value: string): boolean {
  return isValidRegistryStatus(value);
}

/**
 * Validate metric against frozen vocabulary (pure function).
 */
export function validateMetric(value: string): boolean {
  return isValidCanonicalMetric(value);
}

/**
 * Validate timeframe against frozen vocabulary (pure function).
 */
export function validateTimeframe(value: string): boolean {
  return isValidTimeframe(value);
}

/**
 * Check if a runtime status (OK/PARTIAL/FAILED) is NOT a valid registry status.
 */
export function isRuntimeStatusInvalidForRegistry(value: string): boolean {
  const { RUNTIME_ONLY_STATUSES } = require("./types");
  return RUNTIME_ONLY_STATUSES.has(value);
}
