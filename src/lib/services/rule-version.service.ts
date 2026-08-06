import { db } from "@/db";
import { ruleVersions } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import type {
  RuleVersion,
  HealthWeights,
  ConfidenceWeights,
  RecommendationThresholds,
  CreateRuleVersionInput,
} from "@/lib/types/rule-version";

/**
 * RuleVersionService - Manages rule version lifecycle (P0B)
 *
 * Responsibilities:
 * - Retrieve active/all rule versions
 * - Create new versions with validation
 * - Activate versions atomically (transaction ensures exactly one active)
 */
export class RuleVersionService {
  /**
   * Get the currently active rule version.
   * @throws Error if no active version exists
   */
  async getActiveVersion(): Promise<RuleVersion> {
    const [row] = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.isActive, true))
      .limit(1);

    if (!row) {
      throw new Error("No active rule version found.");
    }

    return this.mapRow(row);
  }

  /**
   * Get all rule versions, ordered by version descending.
   */
  async getAllVersions(): Promise<RuleVersion[]> {
    const rows = await db
      .select()
      .from(ruleVersions)
      .orderBy(desc(ruleVersions.version));

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Get a specific rule version by ID.
   * @returns RuleVersion or null if not found
   */
  async getVersionById(id: number): Promise<RuleVersion | null> {
    const [row] = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.id, id))
      .limit(1);

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  /**
   * Get a specific rule version by version number.
   * @returns RuleVersion or null if not found
   */
  async getVersionByVersionNumber(
    versionNumber: number
  ): Promise<RuleVersion | null> {
    const [row] = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.version, versionNumber))
      .limit(1);

    if (!row) {
      return null;
    }

    return this.mapRow(row);
  }

  /**
   * Create a new rule version with validation.
   * @param input - Version data (weights, thresholds, description)
   * @param activateImmediately - If true, activates the new version after creation
   * @returns The created RuleVersion
   */
  async createVersion(
    input: CreateRuleVersionInput,
    activateImmediately = false
  ): Promise<RuleVersion> {
    // Validate weights
    this.validateWeights(input.healthWeights, "healthWeights");
    this.validateWeights(input.confidenceWeights, "confidenceWeights");

    // Validate thresholds
    this.validateThresholds(input.recommendationThresholds);

    // Get next version number
    const maxVersionResult = await db
      .select({ maxVersion: sql<number>`coalesce(max(${ruleVersions.version}), 0)` })
      .from(ruleVersions);

    const nextVersion = (maxVersionResult[0]?.maxVersion ?? 0) + 1;

    // Insert new record (isActive = false by default)
    const [newRow] = await db
      .insert(ruleVersions)
      .values({
        version: nextVersion,
        description: input.description ?? null,
        healthWeights: input.healthWeights,
        confidenceWeights: input.confidenceWeights,
        recommendationThresholds: input.recommendationThresholds,
        isActive: false,
      })
      .returning();

    const created = this.mapRow(newRow);

    // Activate immediately if requested
    if (activateImmediately) {
      await this.activate(created.id);
      // Re-fetch to get updated isActive/activatedAt
      const refreshed = await this.getVersionById(created.id);
      if (refreshed) {
        return refreshed;
      }
    }

    return created;
  }

  /**
   * Activate a specific rule version atomically.
   * Uses a transaction to ensure exactly one active version at all times.
   * @throws Error if version not found
   */
  async activate(versionId: number): Promise<void> {
    // Verify version exists
    const version = await this.getVersionById(versionId);
    if (!version) {
      throw new Error(`Rule version with id ${versionId} not found.`);
    }

    // Use transaction for atomicity
    await db.transaction(async (tx) => {
      // Step 1: Deactivate all versions
      await tx.update(ruleVersions).set({ isActive: false });

      // Step 2: Activate the target version
      await tx
        .update(ruleVersions)
        .set({
          isActive: true,
          activatedAt: new Date(),
        })
        .where(eq(ruleVersions.id, versionId));
    });
  }

  /**
   * Map a database row to a RuleVersion object.
   * Handles JSONB field typing.
   */
  private mapRow(row: typeof ruleVersions.$inferSelect): RuleVersion {
    return {
      id: row.id,
      version: row.version,
      description: row.description,
      healthWeights: row.healthWeights as HealthWeights,
      confidenceWeights: row.confidenceWeights as ConfidenceWeights,
      recommendationThresholds:
        row.recommendationThresholds as RecommendationThresholds,
      isActive: row.isActive,
      createdAt: row.createdAt,
      activatedAt: row.activatedAt,
    };
  }

  /**
   * Validate that weights sum to 1.0 (±0.001 tolerance) and all values are in [0, 1].
   * @throws Error with descriptive message if invalid
   */
  private validateWeights(
    weights: HealthWeights | ConfidenceWeights,
    fieldName: string
  ): void {
    const values = Object.values(weights);

    // Check all values between 0 and 1
    for (const [key, value] of Object.entries(weights)) {
      if (value < 0 || value > 1) {
        throw new Error(
          `Invalid ${fieldName}: ${key}=${value} must be between 0 and 1.`
        );
      }
    }

    // Check sum ≈ 1.0 (±0.001 floating point tolerance)
    const sum = values.reduce((acc, v) => acc + v, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(
        `Invalid ${fieldName}: weights must sum to 1.0 (±0.001), got ${sum}.`
      );
    }
  }

  /**
   * Validate recommendation thresholds ordering and range.
   * Rules: strong_watch > watch > observe, observe >= 0, strong_watch <= 100
   * @throws Error with descriptive message if invalid
   */
  private validateThresholds(thresholds: RecommendationThresholds): void {
    const { strong_watch, watch, observe } = thresholds;

    // Check: strong_watch > watch
    if (strong_watch <= watch) {
      throw new Error(
        `Invalid recommendationThresholds: strong_watch (${strong_watch}) must be greater than watch (${watch}).`
      );
    }

    // Check: watch > observe
    if (watch <= observe) {
      throw new Error(
        `Invalid recommendationThresholds: watch (${watch}) must be greater than observe (${observe}).`
      );
    }

    // Check: observe >= 0
    if (observe < 0) {
      throw new Error(
        `Invalid recommendationThresholds: observe (${observe}) must be >= 0.`
      );
    }

    // Check: strong_watch <= 100
    if (strong_watch > 100) {
      throw new Error(
        `Invalid recommendationThresholds: strong_watch (${strong_watch}) must be <= 100.`
      );
    }
  }
}

// Export singleton instance
export const ruleVersionService = new RuleVersionService();