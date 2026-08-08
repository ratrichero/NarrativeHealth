import { db } from "@/db";
import { decisionSignals, healthScores, eventRisks } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { eventRiskService } from "./event-risk.service";
import { correlationService } from "./correlation.service";
import type { DecisionInput, DecisionResult } from "@/lib/types/decision-signal";

export class DecisionEngineService {
  calculateAdjustedScore(input: DecisionInput): DecisionResult {
    let score = input.healthScore;
    let reason = '';

    if (input.eventRiskScore >= 80) {
      const penalty = 25;
      score -= penalty;
      reason += `Critical event risk (-${penalty}pts). `;
    } else if (input.eventRiskScore >= 60) {
      const penalty = 15;
      score -= penalty;
      reason += `High event risk (-${penalty}pts). `;
    } else if (input.eventRiskScore >= 40) {
      const penalty = 8;
      score -= penalty;
      reason += `Moderate event risk (-${penalty}pts). `;
    }

    if (input.correlationRisk >= 80) {
      const penalty = 10;
      score -= penalty;
      reason += `High narrative correlation (-${penalty}pts). `;
    }

    score = Math.max(5, Math.min(100, score));

    return {
      adjustedScore: Math.round(score * 100) / 100,
      adjustmentReason: reason.trim() || 'No risk adjustments applied',
    };
  }

  async calculateDecisionSignal(input: DecisionInput): Promise<DecisionResult> {
    const eventRisk = await eventRiskService.getCoinEventRiskScore(input.coinId, input.date);
    const correlationRisk = 0;

    const result = this.calculateAdjustedScore({
      ...input,
      eventRiskScore: eventRisk.eventRiskScore,
      correlationRisk,
    });

    await db
      .insert(decisionSignals)
      .values({
        coinId: input.coinId,
        date: input.date,
        baseHealth: String(input.healthScore),
        eventRiskScore: String(eventRisk.eventRiskScore),
        adjustedScore: String(result.adjustedScore),
        adjustmentReason: result.adjustmentReason,
        activeEvents: eventRisk.activeEvents as any,
      } as any)
      .onConflictDoUpdate({
        target: [decisionSignals.coinId, decisionSignals.date],
        set: {
          baseHealth: String(input.healthScore),
          eventRiskScore: String(eventRisk.eventRiskScore),
          adjustedScore: String(result.adjustedScore),
          adjustmentReason: result.adjustmentReason,
          activeEvents: eventRisk.activeEvents as any,
        } as any,
      });

    return result;
  }

  async getDecisionSignal(coinId: number, date: string) {
    const [signal] = await db
      .select()
      .from(decisionSignals)
      .where(and(eq(decisionSignals.coinId, coinId), eq(decisionSignals.date, date)))
      .limit(1);

    return signal;
  }
}

export const decisionEngineService = new DecisionEngineService();
