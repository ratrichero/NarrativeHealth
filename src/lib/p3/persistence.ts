import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { p3ConstituentSnapshotMembers, p3ConstituentSnapshots, p3NarrativeIntelligence } from "@/db/schema";
import type { P3CalculationContext, P3CalculationResult } from "./context";
import { calculationIdentity } from "./context";

export interface P3PersistencePayload {
  context: P3CalculationContext;
  result: P3CalculationResult;
  membershipSource: string;
  membershipMode: string;
}

export interface P3PersistenceOutcome {
  intelligenceId: number;
  identity: string;
  inserted: boolean;
}

function metricNumber(result: P3CalculationResult, key: string): string | null {
  const metric = result.metrics[key];
  return metric?.state === "VALID" && typeof metric.value === "number" ? String(metric.value) : null;
}

function metricString(result: P3CalculationResult, key: string): string | null {
  const metric = result.metrics[key];
  return metric?.state === "VALID" && typeof metric.value === "string" ? metric.value : null;
}

export async function persistP3Calculation(payload: P3PersistencePayload): Promise<P3PersistenceOutcome> {
  const { context, result } = payload;
  const identity = calculationIdentity(context);
  if (result.narrativeId !== context.narrativeId || result.windowEnd.getTime() !== context.windowEnd.getTime()) {
    throw new Error("Result does not match calculation context");
  }

  return db.transaction(async (tx) => {
    const inserted = await tx.insert(p3NarrativeIntelligence).values({
      narrativeId: context.narrativeId,
      windowEnd: context.windowEnd,
      periodStart: context.windowStart,
      periodEnd: context.windowEnd,
      algorithmKey: context.algorithmKey,
      algorithmVersion: context.algorithmVersion,
      ruleVersionId: context.ruleVersionId ?? null,
      featureVersionId: context.featureVersionId ?? null,
      scoreConfigId: context.scoreConfigId ?? null,
      calculationMode: context.calculationMode,
      availabilityState: result.availabilityState,
      confidence: result.confidence == null ? null : String(result.confidence),
      breadth: metricNumber(result, "breadth"),
      strongBreadth: metricNumber(result, "strongBreadth"),
      momentum1d: metricNumber(result, "momentum1d"),
      momentum3d: metricNumber(result, "momentum3d"),
      momentum7d: metricNumber(result, "momentum7d"),
      momentum14d: metricNumber(result, "momentum14d"),
      acceleration: metricNumber(result, "acceleration"),
      relativeStrength1d: metricNumber(result, "relativeStrength1d"),
      relativeStrength3d: metricNumber(result, "relativeStrength3d"),
      relativeStrength7d: metricNumber(result, "relativeStrength7d"),
      relativeStrength14d: metricNumber(result, "relativeStrength14d"),
      concentrationTop1: metricNumber(result, "concentrationTop1"),
      concentrationTop3: metricNumber(result, "concentrationTop3"),
      regime: metricString(result, "regime"),
      rotation: metricString(result, "rotation"),
      explanation: result.explanation ?? null,
      provenance: result.provenance,
      calculatedAt: context.calculatedAt,
    }).onConflictDoNothing({ target: [
      p3NarrativeIntelligence.narrativeId,
      p3NarrativeIntelligence.windowEnd,
      p3NarrativeIntelligence.algorithmKey,
      p3NarrativeIntelligence.algorithmVersion,
      p3NarrativeIntelligence.calculationMode,
    ] }).returning({ id: p3NarrativeIntelligence.id });

    if (inserted[0]) {
      const [snapshot] = await tx.insert(p3ConstituentSnapshots).values({
        intelligenceId: inserted[0].id,
        capturedAt: context.calculatedAt,
        membershipSource: payload.membershipSource,
        membershipMode: payload.membershipMode,
        memberCount: context.constituents.length,
        eligibleCount: context.constituents.filter((member) => member.membershipState === "ELIGIBLE").length,
        provenance: { calculationIdentity: identity, constituents: context.constituents.length },
      }).returning({ id: p3ConstituentSnapshots.id });

      if (context.constituents.length > 0) {
        await tx.insert(p3ConstituentSnapshotMembers).values(context.constituents.map((member) => ({
          snapshotId: snapshot.id,
          coinId: member.coinId,
          membershipState: member.membershipState,
          inclusionReason: member.inclusionReason ?? null,
          availabilityState: member.availabilityState,
          inputManifest: member.inputManifest ?? null,
        })));
      }
      return { intelligenceId: inserted[0].id, identity, inserted: true };
    }

    const [existing] = await tx.select({ id: p3NarrativeIntelligence.id }).from(p3NarrativeIntelligence).where(and(
      eq(p3NarrativeIntelligence.narrativeId, context.narrativeId),
      eq(p3NarrativeIntelligence.windowEnd, context.windowEnd),
      eq(p3NarrativeIntelligence.algorithmKey, context.algorithmKey),
      eq(p3NarrativeIntelligence.algorithmVersion, context.algorithmVersion),
      eq(p3NarrativeIntelligence.calculationMode, context.calculationMode),
    )).limit(1);
    if (!existing) throw new Error("P3 idempotent insert conflict did not resolve to an existing record");
    return { intelligenceId: existing.id, identity, inserted: false };
  });
}
