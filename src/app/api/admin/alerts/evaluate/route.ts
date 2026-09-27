/**
 * ALERT-01 — Admin: manual alert evaluation.
 *   POST /api/admin/alerts/evaluate          — evaluate all active rules now
 *   POST /api/admin/alerts/evaluate?ruleId=N — evaluate a single rule
 */

import { NextRequest, NextResponse } from "next/server";
import {
  evaluateAlertRules,
  evaluateSingleRule,
} from "@/lib/services/alert-evaluator.service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ruleIdRaw = request.nextUrl.searchParams.get("ruleId");

    if (ruleIdRaw !== null) {
      const ruleId = Number.parseInt(ruleIdRaw, 10);
      if (!Number.isFinite(ruleId)) {
        return NextResponse.json(
          { success: false, error: "Invalid ruleId." },
          { status: 400 }
        );
      }
      const outcome = await evaluateSingleRule(ruleId);
      return NextResponse.json({ success: true, data: outcome });
    }

    const summary = await evaluateAlertRules();
    return NextResponse.json({
      success: true,
      data: {
        rulesEvaluated: summary.rulesEvaluated,
        coinsChecked: summary.coinsChecked,
        alertsFired: summary.alertsFired,
        alertsDispatched: summary.alertsDispatched,
        errors: summary.errors,
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/alerts/evaluate]", error);
    return NextResponse.json(
      { success: false, error: "Failed to evaluate alert rules." },
      { status: 500 }
    );
  }
}
