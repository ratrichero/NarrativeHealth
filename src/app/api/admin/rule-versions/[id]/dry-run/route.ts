/**
 * ALERT-05 — Rule version dry-run.
 *
 * POST /api/admin/rule-versions/[id]/dry-run
 *
 * Chạy simulation: lấy điểm số gần nhất của mọi coin active (health_scores
 * + features theo ngày mới nhất có dữ liệu), xếp priority rules của version
 * được chỉ định và tính signal từng coin — rồi so sánh với signal hiện tại
 * (recommendations của ngày mới nhất). KHÔNG ghi DB, không đổi version
 * active. Dùng để đánh giá tác động của version mới trước khi activate.
 *
 * Response:
 *   data = {
 *     sampleSize, dateUsed,
 *     changed: [{ coinId, symbol, name, currentSignal, dryRunSignal, ruleId }],
 *     distribution: { current: {...}, dryRun: {...} },
 *     changedCount
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { healthScores, features, coins, recommendations } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { ruleVersionService } from "@/lib/services/rule-version.service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const versionId = Number.parseInt(rawId, 10);
    if (!Number.isFinite(versionId)) {
      return NextResponse.json({ success: false, error: "Invalid version id." }, { status: 400 });
    }

    const versions = await ruleVersionService.getAllVersions();
    const version = versions.find((v) => v.id === versionId);
    if (!version) {
      return NextResponse.json({ success: false, error: "Rule version not found." }, { status: 404 });
    }

    // Ngày mới nhất có health score (không phụ thuộc ngày business hiện tại).
    const [latest] = await db
      .select({ date: healthScores.date })
      .from(healthScores)
      .orderBy(desc(healthScores.date))
      .limit(1);
    if (!latest) {
      return NextResponse.json(
        { success: false, error: "No health scores available to dry-run against." },
        { status: 422 }
      );
    }
    const dateUsed = latest.date;

    const rows = await db
      .select({
        coinId: healthScores.coinId,
        symbol: coins.symbol,
        name: coins.name,
        healthScore: healthScores.healthScore,
        trendScore: features.trendScore,
        derivativeScore: features.derivativeScore,
        volumeScore: features.volumeScore,
        momentumScore: features.momentumScore,
        confidenceScore: healthScores.confidenceScore,
        currentSignal: recommendations.signal,
      })
      .from(healthScores)
      .innerJoin(coins, eq(coins.id, healthScores.coinId))
      .leftJoin(
        features,
        sql`${features.coinId} = ${healthScores.coinId} AND ${features.date} = ${healthScores.date}`
      )
      .leftJoin(
        recommendations,
        sql`${recommendations.coinId} = ${healthScores.coinId} AND ${recommendations.date} = ${healthScores.date}`
      )
      .where(eq(healthScores.date, dateUsed));

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "No scores found for the latest date." },
        { status: 422 }
      );
    }

    // Rules của version chỉ định (lấy qua rule-engine service để giữ logic).
    const { ruleEngineService } = await import("@/lib/services/rule-engine.service");
    const rules = await ruleEngineService.getRulesForVersion(versionId);
    if (rules.length === 0) {
      return NextResponse.json(
        { success: false, error: "This version has no active rules to evaluate." },
        { status: 422 }
      );
    }

    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
    const evaluateCondition = (
      scores: Record<string, number | null>,
      cond: { field: string; operator: string; value: number }
    ): boolean => {
      const actual = scores[cond.field];
      if (actual === undefined || actual === null) return false;
      switch (cond.operator) {
        case ">": return actual > cond.value;
        case ">=": return actual >= cond.value;
        case "<": return actual < cond.value;
        case "<=": return actual <= cond.value;
        case "==": return actual === cond.value;
        case "!=": return actual !== cond.value;
        default: return false;
      }
    };

    const distributionCurrent: Record<string, number> = {};
    const distributionDryRun: Record<string, number> = {};
    const changed: {
      coinId: number;
      symbol: string;
      name: string;
      currentSignal: string | null;
      dryRunSignal: string;
      ruleId: number | null;
    }[] = [];

    for (const row of rows) {
      const scores = {
        health: row.healthScore,
        trend: row.trendScore,
        derivative: row.derivativeScore,
        volume: row.volumeScore,
        momentum: row.momentumScore,
        confidence: row.confidenceScore,
      };

      let dryRunSignal = "OBSERVE";
      let matchedRuleId: number | null = null;
      for (const rule of sorted) {
        const matches =
          rule.logicOperator === "AND"
            ? rule.conditions.every((c) => evaluateCondition(scores, c))
            : rule.conditions.some((c) => evaluateCondition(scores, c));
        if (matches) {
          dryRunSignal = rule.signal;
          matchedRuleId = rule.id;
          break;
        }
      }

      const current = row.currentSignal ?? "NO_SIGNAL";
      distributionCurrent[current] = (distributionCurrent[current] ?? 0) + 1;
      distributionDryRun[dryRunSignal] = (distributionDryRun[dryRunSignal] ?? 0) + 1;

      if (current !== dryRunSignal) {
        changed.push({
          coinId: row.coinId,
          symbol: row.symbol,
          name: row.name,
          currentSignal: row.currentSignal,
          dryRunSignal,
          ruleId: matchedRuleId,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        versionId,
        version: version.version,
        sampleSize: rows.length,
        dateUsed,
        changedCount: changed.length,
        changed,
        distribution: { current: distributionCurrent, dryRun: distributionDryRun },
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/rule-versions/[id]/dry-run]", error);
    return NextResponse.json(
      { success: false, error: "Failed to run dry-run simulation." },
      { status: 500 }
    );
  }
}
