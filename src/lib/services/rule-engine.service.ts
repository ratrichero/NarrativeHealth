import { db } from "@/db";
import { recommendationRules, ruleVersions } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { RecommendationRule, RuleCondition, ScoreInput, RecommendationResult, CreateRuleInput } from "@/lib/types/recommendation-rule";

const VALID_SIGNALS = ['STRONG_WATCH', 'WATCH', 'OBSERVE', 'CAUTION', 'WEAK'] as const;
const VALID_FIELDS = ['health', 'trend', 'derivative', 'volume', 'momentum', 'confidence'] as const;
const VALID_OPERATORS = ['>', '>=', '<', '<=', '==', '!='] as const;

export class RuleEngineService {
  async getRulesForVersion(versionId: number): Promise<RecommendationRule[]> {
    const rows = await db
      .select()
      .from(recommendationRules)
      .where(and(
        eq(recommendationRules.ruleVersionId, versionId),
        eq(recommendationRules.isActive, true)
      ))
      .orderBy(desc(recommendationRules.priority));

    return rows.map(r => ({
      ...r,
      logicOperator: r.logicOperator as 'AND' | 'OR',
      createdAt: r.createdAt ?? new Date(),
      conditions: (r.conditions as unknown as RuleCondition[]),
    }));
  }

  evaluate(scores: ScoreInput, versionId: number): Promise<RecommendationResult> {
    return this.getRulesForVersion(versionId).then(rules => {
      const sorted = [...rules].sort((a, b) => b.priority - a.priority);

      for (const rule of sorted) {
        const matches = rule.logicOperator === 'AND'
          ? rule.conditions.every(c => this.evaluateCondition(scores, c))
          : rule.conditions.some(c => this.evaluateCondition(scores, c));

        if (matches) {
          return {
            signal: rule.signal,
            reason: this.formatReason(rule.reasonTemplate, scores),
            ruleId: rule.id,
            matched: true,
          };
        }
      }

      return {
        signal: 'OBSERVE',
        reason: 'No matching rule',
        ruleId: null,
        matched: false,
      };
    });
  }

  private evaluateCondition(scores: ScoreInput, cond: RuleCondition): boolean {
    const actual = scores[cond.field as keyof ScoreInput];
    if (actual === undefined || actual === null) return false;

    switch (cond.operator) {
      case '>':  return actual >  cond.value;
      case '>=': return actual >= cond.value;
      case '<':  return actual <  cond.value;
      case '<=': return actual <= cond.value;
      case '==': return actual === cond.value;
      case '!=': return actual !== cond.value;
      default:   return false;
    }
  }

  formatReason(template: string, scores: ScoreInput): string {
    return template
      .replace(/\{health\}/g, scores.health.toFixed(1))
      .replace(/\{trend\}/g, scores.trend.toFixed(1))
      .replace(/\{derivative\}/g, scores.derivative.toFixed(1))
      .replace(/\{volume\}/g, scores.volume.toFixed(1))
      .replace(/\{momentum\}/g, scores.momentum.toFixed(1))
      .replace(/\{confidence\}/g, scores.confidence.toFixed(1));
  }

  async createRule(input: CreateRuleInput, ruleVersionId: number): Promise<RecommendationRule> {
    this.validateRuleInput(input);

    const [rule] = await db
      .insert(recommendationRules)
      .values({
        ruleVersionId,
        priority: input.priority,
        signal: input.signal,
        logicOperator: input.logicOperator,
        conditions: input.conditions as unknown as any,
        reasonTemplate: input.reasonTemplate,
      })
      .returning();

    return {
      ...rule,
      logicOperator: rule.logicOperator as 'AND' | 'OR',
      createdAt: rule.createdAt ?? new Date(),
      conditions: rule.conditions as unknown as RuleCondition[],
    };
  }

  async updateRule(id: number, updates: Partial<CreateRuleInput>): Promise<RecommendationRule> {
    if (updates.priority !== undefined || updates.signal !== undefined || updates.logicOperator !== undefined || updates.conditions !== undefined || updates.reasonTemplate !== undefined) {
      const input: CreateRuleInput = {
        priority: updates.priority ?? 50,
        signal: updates.signal ?? 'OBSERVE',
        logicOperator: updates.logicOperator ?? 'AND',
        conditions: updates.conditions ?? [],
        reasonTemplate: updates.reasonTemplate ?? '',
      };
      this.validateRuleInput(input);
    }

    const [rule] = await db
      .update(recommendationRules)
      .set({
        ...(updates.priority !== undefined && { priority: updates.priority }),
        ...(updates.signal !== undefined && { signal: updates.signal }),
        ...(updates.logicOperator !== undefined && { logicOperator: updates.logicOperator }),
        ...(updates.conditions !== undefined && { conditions: updates.conditions as unknown as any }),
        ...(updates.reasonTemplate !== undefined && { reasonTemplate: updates.reasonTemplate }),
      })
      .where(eq(recommendationRules.id, id))
      .returning();

    return {
      ...rule,
      logicOperator: rule.logicOperator as 'AND' | 'OR',
      createdAt: rule.createdAt ?? new Date(),
      conditions: rule.conditions as unknown as RuleCondition[],
    };
  }

  async deactivateRule(id: number): Promise<void> {
    await db
      .update(recommendationRules)
      .set({ isActive: false })
      .where(eq(recommendationRules.id, id));
  }

  private validateRuleInput(input: CreateRuleInput): void {
    if (input.priority <= 0) {
      throw new Error('Priority must be greater than 0');
    }
    if (!Array.isArray(input.conditions) || input.conditions.length === 0) {
      throw new Error('Conditions array must not be empty');
    }
    if (!VALID_SIGNALS.includes(input.signal as typeof VALID_SIGNALS[number])) {
      throw new Error(`Invalid signal: ${input.signal}`);
    }
    if (!['AND', 'OR'].includes(input.logicOperator)) {
      throw new Error('Logic operator must be AND or OR');
    }
    for (const cond of input.conditions) {
      if (!VALID_FIELDS.includes(cond.field as typeof VALID_FIELDS[number])) {
        throw new Error(`Invalid condition field: ${cond.field}`);
      }
      if (!VALID_OPERATORS.includes(cond.operator as typeof VALID_OPERATORS[number])) {
        throw new Error(`Invalid condition operator: ${cond.operator}`);
      }
      if (typeof cond.value !== 'number' || cond.value < 0 || cond.value > 100) {
        throw new Error('Condition value must be a number between 0 and 100');
      }
    }
  }
}

export const ruleEngineService = new RuleEngineService();
