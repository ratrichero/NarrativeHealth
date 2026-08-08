import { db } from "@/db";
import { alertRules, alertHistory } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import type { AlertRule, AlertHistory, AlertFired } from "@/lib/types/alert";

export class AlertService {
  async createRule(rule: Omit<AlertRule, 'id' | 'createdAt'>): Promise<AlertRule> {
    const [result] = await db
      .insert(alertRules)
      .values(rule as any)
      .returning();
    return result as AlertRule;
  }

  async updateRule(id: number, updates: Partial<AlertRule>): Promise<AlertRule> {
    const [result] = await db
      .update(alertRules)
      .set(updates as any)
      .where(eq(alertRules.id, id))
      .returning();
    return result as AlertRule;
  }

  async deactivateRule(id: number): Promise<void> {
    await db
      .update(alertRules)
      .set({ isActive: false })
      .where(eq(alertRules.id, id));
  }

  async getActiveRules(): Promise<AlertRule[]> {
    return db.select().from(alertRules).where(eq(alertRules.isActive, true)).orderBy(desc(alertRules.createdAt)) as Promise<AlertRule[]>;
  }

  async getRuleHistory(limit: number = 50): Promise<AlertFired[]> {
    const result = await db
      .select({
        id: alertHistory.id,
        ruleId: alertHistory.ruleId,
        ruleName: alertRules.name,
        triggerType: alertRules.triggerType,
        triggeredAt: alertHistory.triggeredAt,
        triggerDetail: alertHistory.triggerDetail,
        acknowledgedAt: alertHistory.acknowledgedAt,
        acknowledgedBy: alertHistory.acknowledgedBy,
      })
      .from(alertHistory)
      .innerJoin(alertRules, eq(alertRules.id, alertHistory.ruleId))
      .orderBy(desc(alertHistory.triggeredAt))
      .limit(limit);

    return result.map(r => ({
      ...r,
      acknowledged: !!r.acknowledgedAt,
    })) as AlertFired[];
  }

  async recordAlert(ruleId: number, triggerDetail: Record<string, unknown>): Promise<void> {
    await db
      .insert(alertHistory)
      .values({
        ruleId,
        triggerDetail: triggerDetail as any,
      } as any);
  }

  async acknowledgeAlert(historyId: number, acknowledgedBy: string): Promise<void> {
    await db
      .update(alertHistory)
      .set({
        acknowledgedAt: new Date(),
        acknowledgedBy,
      } as any)
      .where(eq(alertHistory.id, historyId));
  }

  async getUnacknowledgedCount(): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertHistory)
      .where(sql`${alertHistory.acknowledgedAt} IS NULL`);

    return result[0]?.count ?? 0;
  }
}

export const alertService = new AlertService();
