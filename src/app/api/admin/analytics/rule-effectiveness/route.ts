import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { recommendationRules, ruleVersions } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await db
      .select({
        ruleId: recommendationRules.id,
        priority: recommendationRules.priority,
        signal: recommendationRules.signal,
        logicOperator: recommendationRules.logicOperator,
        isActive: recommendationRules.isActive,
        createdAt: recommendationRules.createdAt,
        ruleVersionId: recommendationRules.ruleVersionId,
        fireCount: sql<number>`count(*)::int`,
      })
      .from(recommendationRules)
      .innerJoin(ruleVersions, eq(ruleVersions.id, recommendationRules.ruleVersionId))
      .groupBy(recommendationRules.id)
      .orderBy(desc(recommendationRules.priority));

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("[GET /api/admin/analytics/rule-effectiveness]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch rule effectiveness" },
      { status: 500 }
    );
  }
}
