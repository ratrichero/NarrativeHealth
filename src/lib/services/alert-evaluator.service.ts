/**
 * ALERT-01 — Alert rule evaluator.
 *
 * Quét các alert rule đang active, so ngưỡng với điểm số mới nhất của từng
 * coin (health_scores + features của ngày hiện tại), và ghi alert_history
 * khi vượt ngưỡng. Trước đây rules chỉ tồn tại trong DB — không có gì tự
 * động so ngưỡng nên alert không bao giờ fire.
 *
 * Idempotent theo ngày: một rule chỉ ghi MỘT alert mỗi ngày cho mỗi coin
 * (kiểm tra alert_history gần nhất của rule trước khi ghi). Evaluation
 * failure của từng rule được cô lập — không làm vỡ vòng lặp.
 *
 * Delivery: sau khi ghi history, dispatch qua các kênh đã cấu hình
 * (Telegram / webhook / email — xem alert-delivery.service.ts).
 */

import { db } from "@/db";
import { alertRules, alertHistory, healthScores, features, coins } from "@/db/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { alertService } from "./alert.service";
import { dispatchAlert } from "./alert-delivery.service";

/**
 * Ngày mới nhất có điểm số — KHÔNG dùng business date hiện tại vì đầu ngày
 * (trước khi refresh chạy) business date mới chưa có dữ liệu. Evaluate trên
 * dữ liệu mới nhất có sẵn là đúng ý nghĩa cảnh báo.
 */
async function latestScoreDate(): Promise<string | null> {
  const [row] = await db
    .select({ date: healthScores.date })
    .from(healthScores)
    .orderBy(desc(healthScores.date))
    .limit(1);
  return row?.date ?? null;
}

export interface AlertEvaluationOutcome {
  ruleId: number;
  ruleName: string;
  fired: boolean;
  coinId?: number;
  triggerDetail?: Record<string, unknown>;
  error?: string;
}

export interface AlertEvaluationSummary {
  rulesEvaluated: number;
  coinsChecked: number;
  alertsFired: number;
  alertsDispatched: number;
  errors: string[];
  outcomes: AlertEvaluationOutcome[];
}

const TRIGGER_FIELD_MAP: Record<string, "healthScore" | "trendScore" | "derivativeScore"> = {
  health_below: "healthScore",
  health_above: "healthScore",
  trend_below: "trendScore",
  derivative_below: "derivativeScore",
};

function shouldFire(
  triggerType: string,
  value: number,
  threshold: number
): boolean {
  switch (triggerType) {
    case "health_below":
    case "trend_below":
    case "derivative_below":
      return value < threshold;
    case "health_above":
      return value > threshold;
    default:
      return false;
  }
}

async function hasAlertToday(ruleId: number, coinId: number | null): Promise<boolean> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const conditions = [
    eq(alertHistory.ruleId, ruleId),
    sql`${alertHistory.triggeredAt} >= ${todayStart}`,
  ];
  if (coinId !== null) {
    conditions.push(sql`${alertHistory.triggerDetail} ->> 'coinId' = ${String(coinId)}`);
  }

  const rows = await db
    .select({ id: alertHistory.id })
    .from(alertHistory)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

/**
 * Evaluate all active alert rules against the latest scores.
 * Called post-refresh (additive, non-blocking) and from the manual admin endpoint.
 */
export async function evaluateAlertRules(): Promise<AlertEvaluationSummary> {
  const summary: AlertEvaluationSummary = {
    rulesEvaluated: 0,
    coinsChecked: 0,
    alertsFired: 0,
    alertsDispatched: 0,
    errors: [],
    outcomes: [],
  };

  const rules = await alertService.getActiveRules();
  if (rules.length === 0) return summary;

  const today = await latestScoreDate();
  if (!today) {
    summary.errors.push("No health scores available to evaluate against.");
    return summary;
  }

  const activeCoins = await db
    .select({ id: coins.id, symbol: coins.symbol, name: coins.name })
    .from(coins)
    .where(eq(coins.isActive, true));

  for (const rule of rules) {
    summary.rulesEvaluated++;
    const field = TRIGGER_FIELD_MAP[rule.triggerType];
    if (!field) {
      summary.outcomes.push({
        ruleId: rule.id,
        ruleName: rule.name,
        fired: false,
        error: `Unknown trigger type: ${rule.triggerType}`,
      });
      continue;
    }
    const threshold = rule.triggerValue ? Number(rule.triggerValue) : null;
    if (threshold === null) {
      summary.outcomes.push({
        ruleId: rule.id,
        ruleName: rule.name,
        fired: false,
        error: "Rule has no trigger value",
      });
      continue;
    }

    // Scope: global → mọi coin active; coin/narrative → lọc theo scopeId
    // (narrative scope: coin thuộc narrative qua coin_narratives).
    let scopedCoins = activeCoins;
    if (rule.scope === "coin" && rule.scopeId !== null) {
      scopedCoins = activeCoins.filter((c) => c.id === rule.scopeId);
    } else if (rule.scope === "narrative" && rule.scopeId !== null) {
      const { coinNarratives } = await import("@/db/schema");
      const members = await db
        .select({ coinId: coinNarratives.coinId })
        .from(coinNarratives)
        .where(eq(coinNarratives.narrativeId, rule.scopeId));
      const memberIds = new Set(members.map((m) => m.coinId));
      scopedCoins = activeCoins.filter((c) => memberIds.has(c.id));
    }

    for (const coin of scopedCoins) {
      summary.coinsChecked++;
      try {
        const [score] = await db
          .select({
            healthScore: healthScores.healthScore,
            trendScore: features.trendScore,
            derivativeScore: features.derivativeScore,
          })
          .from(healthScores)
          .leftJoin(
            features,
            and(
              eq(features.coinId, healthScores.coinId),
              eq(features.date, healthScores.date)
            )
          )
          .where(and(eq(healthScores.coinId, coin.id), eq(healthScores.date, today)))
          .limit(1);

        if (!score) continue;
        const raw = score[field];
        if (raw === null || raw === undefined) continue;
        const value = Number(raw);

        if (!shouldFire(rule.triggerType, value, threshold)) continue;
        if (await hasAlertToday(rule.id, coin.id)) continue;

        const triggerDetail = {
          coinId: coin.id,
          coinSymbol: coin.symbol,
          coinName: coin.name,
          triggerType: rule.triggerType,
          field,
          value,
          threshold,
          date: today,
        };

        await alertService.recordAlert(rule.id, triggerDetail);
        summary.alertsFired++;
        summary.outcomes.push({ ruleId: rule.id, ruleName: rule.name, fired: true, coinId: coin.id, triggerDetail });

        const dispatched = await dispatchAlert(rule, triggerDetail);
        summary.alertsDispatched += dispatched;
      } catch (error) {
        const msg = `${rule.name}/${coin.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`;
        summary.errors.push(msg);
        summary.outcomes.push({ ruleId: rule.id, ruleName: rule.name, fired: false, coinId: coin.id, error: msg });
      }
    }
  }

  return summary;
}

/** Evaluate a single rule against the latest scores (admin "Test now"). */
export async function evaluateSingleRule(ruleId: number): Promise<AlertEvaluationOutcome & { summary: Omit<AlertEvaluationSummary, "outcomes"> }> {
  const emptySummary = { rulesEvaluated: 1, coinsChecked: 0, alertsFired: 0, alertsDispatched: 0, errors: [] as string[] };
  const rules = await alertService.getActiveRules();
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    return { ruleId, ruleName: `#${ruleId}`, fired: false, error: "Rule not found or inactive", summary: emptySummary };
  }

  const { name: ruleName } = rule;
  const today = await latestScoreDate();
  if (!today) {
    return { ruleId, ruleName, fired: false, error: "No health scores available", summary: emptySummary };
  }
  const field = TRIGGER_FIELD_MAP[rule.triggerType];
  if (!field) {
    return { ruleId, ruleName, fired: false, error: `Unknown trigger type: ${rule.triggerType}`, summary: emptySummary };
  }
  const threshold = rule.triggerValue ? Number(rule.triggerValue) : null;
  if (threshold === null) {
    return { ruleId, ruleName, fired: false, error: "Rule has no trigger value", summary: emptySummary };
  }

  const activeCoins = await db
    .select({ id: coins.id, symbol: coins.symbol, name: coins.name })
    .from(coins)
    .where(eq(coins.isActive, true));

  let coinsChecked = 0;
  let alertsFired = 0;
  const errors: string[] = [];

  for (const coin of activeCoins) {
    coinsChecked++;
    try {
      const [score] = await db
        .select({
          healthScore: healthScores.healthScore,
          trendScore: features.trendScore,
          derivativeScore: features.derivativeScore,
        })
        .from(healthScores)
        .leftJoin(
          features,
          and(eq(features.coinId, healthScores.coinId), eq(features.date, healthScores.date))
        )
        .where(and(eq(healthScores.coinId, coin.id), eq(healthScores.date, today)))
        .limit(1);
      if (!score) continue;
      const raw = score[field];
      if (raw === null || raw === undefined) continue;
      const value = Number(raw);

      if (!shouldFire(rule.triggerType, value, threshold)) continue;
      if (await hasAlertToday(rule.id, coin.id)) continue;

      const triggerDetail = {
        coinId: coin.id,
        coinSymbol: coin.symbol,
        coinName: coin.name,
        triggerType: rule.triggerType,
        field,
        value,
        threshold,
        date: today,
      };
      await alertService.recordAlert(rule.id, triggerDetail);
      alertsFired++;
    } catch (error) {
      errors.push(`${coin.symbol}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return {
    ruleId,
    ruleName,
    fired: alertsFired > 0,
    triggerDetail: { coinsChecked, alertsFired, errors },
    summary: { rulesEvaluated: 1, coinsChecked, alertsFired, alertsDispatched: 0, errors },
  };
}
