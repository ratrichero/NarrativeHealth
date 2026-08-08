import { db } from "@/db";
import { eventRisks, coins, narratives } from "@/db/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import type { EventRisk, NewEventRisk, CoinEventRiskScore } from "@/lib/types/event-risk";

export class EventRiskService {
  async create(input: NewEventRisk): Promise<EventRisk> {
    const [risk] = await db
      .insert(eventRisks)
      .values({
        coinId: input.coinId ?? null,
        narrativeId: input.narrativeId ?? null,
        eventType: input.eventType,
        eventDate: input.eventDate,
        riskLevel: input.riskLevel,
        riskScore: input.riskScore ? String(input.riskScore) : null,
        title: input.title,
        description: input.description ?? null,
        sourceUrl: input.sourceUrl ?? null,
        isActive: input.isActive ?? true,
        expiresAt: input.expiresAt ?? null,
      } as any)
      .returning();

    return {
      ...risk,
      riskScore: risk.riskScore ? parseFloat(risk.riskScore) : null,
      coinId: risk.coinId ?? null,
      narrativeId: risk.narrativeId ?? null,
      description: risk.description ?? null,
      sourceUrl: risk.sourceUrl ?? null,
      expiresAt: risk.expiresAt ?? null,
    };
  }

  async update(id: number, updates: Partial<NewEventRisk>): Promise<EventRisk> {
    const [risk] = await db
      .update(eventRisks)
      .set({
        ...(updates.coinId !== undefined && { coinId: updates.coinId }),
        ...(updates.narrativeId !== undefined && { narrativeId: updates.narrativeId }),
        ...(updates.eventType && { eventType: updates.eventType }),
        ...(updates.eventDate && { eventDate: updates.eventDate }),
        ...(updates.riskLevel && { riskLevel: updates.riskLevel }),
        ...(updates.riskScore !== undefined && { riskScore: updates.riskScore ? String(updates.riskScore) : null }),
        ...(updates.title && { title: updates.title }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.sourceUrl !== undefined && { sourceUrl: updates.sourceUrl }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.expiresAt !== undefined && { expiresAt: updates.expiresAt }),
      } as any)
      .where(eq(eventRisks.id, id))
      .returning();

    return {
      ...risk,
      riskScore: risk.riskScore ? parseFloat(risk.riskScore) : null,
      coinId: risk.coinId ?? null,
      narrativeId: risk.narrativeId ?? null,
      description: risk.description ?? null,
      sourceUrl: risk.sourceUrl ?? null,
      expiresAt: risk.expiresAt ?? null,
    };
  }

  async deactivate(id: number): Promise<void> {
    await db
      .update(eventRisks)
      .set({ isActive: false })
      .where(eq(eventRisks.id, id));
  }

  async getActiveEvents(coinId?: number, narrativeId?: number): Promise<EventRisk[]> {
    const today = new Date().toISOString().split('T')[0];
    const conditions = [
      eq(eventRisks.isActive, true),
      sql`(${eventRisks.expiresAt} IS NULL OR ${eventRisks.expiresAt} >= ${today})`,
    ];

    if (coinId !== undefined) {
      conditions.push(eq(eventRisks.coinId, coinId));
    }
    if (narrativeId !== undefined) {
      conditions.push(eq(eventRisks.narrativeId, narrativeId));
    }

    const result = await db.select().from(eventRisks).where(and(...conditions)).orderBy(desc(eventRisks.eventDate));

    return result.map(r => ({
      ...r,
      riskScore: r.riskScore ? parseFloat(r.riskScore) : null,
      coinId: r.coinId ?? null,
      narrativeId: r.narrativeId ?? null,
      description: r.description ?? null,
      sourceUrl: r.sourceUrl ?? null,
      expiresAt: r.expiresAt ?? null,
    }));
  }

  async getCoinEventRiskScore(coinId: number, date: string): Promise<CoinEventRiskScore> {
    const activeEvents = await this.getActiveEvents(coinId);

    if (activeEvents.length === 0) {
      return { coinId, date, eventRiskScore: 0, activeEvents: [] };
    }

    const maxRisk = Math.max(...activeEvents.map(e => e.riskScore ?? 0));
    const multiEventBonus = Math.min((activeEvents.length - 1) * 5, 15);
    const score = Math.min(maxRisk + multiEventBonus, 100);

    return { coinId, date, eventRiskScore: score, activeEvents };
  }
}

export const eventRiskService = new EventRiskService();
