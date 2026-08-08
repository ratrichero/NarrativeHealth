import { NextRequest, NextResponse } from "next/server";
import { ruleEngineService } from "@/lib/services/rule-engine.service";
import { db } from "@/db";
import { ruleVersions } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { CreateRuleInput } from "@/lib/types/recommendation-rule";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const activeVersion = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.isActive, true))
      .limit(1);

    if (!activeVersion.length) {
      return NextResponse.json({ success: true, data: [] });
    }

    const rules = await ruleEngineService.getRulesForVersion(activeVersion[0].id);
    return NextResponse.json({ success: true, data: rules });
  } catch (error) {
    console.error("[GET /api/admin/recommendation-rules]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch recommendation rules" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { priority, signal, logicOperator, conditions, reasonTemplate } = body;

    if (priority == null || !signal || !logicOperator || !Array.isArray(conditions) || !reasonTemplate) {
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 422 }
      );
    }

    const input: CreateRuleInput = {
      priority: Number(priority),
      signal: String(signal),
      logicOperator: String(logicOperator) as 'AND' | 'OR',
      conditions: conditions,
      reasonTemplate: String(reasonTemplate),
    };

    const activeVersion = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.isActive, true))
      .limit(1);

    if (!activeVersion.length) {
      return NextResponse.json(
        { success: false, error: "No active rule version found" },
        { status: 400 }
      );
    }

    const rule = await ruleEngineService.createRule(input, activeVersion[0].id);

    return NextResponse.json({ success: true, data: rule }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/recommendation-rules]", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 422 }
    );
  }
}
