// Square Pipeline — Production Wiring — SQ-OPERATE-02 Enhanced
// Post-refresh hook: evaluates opportunities after data refresh completes
// Now includes: pipeline execution summary, quota warnings, observability

import { evaluateOpportunities, buildContentBrief, type SquareOpportunity } from "./opportunity-engine";
import { persistOpportunity, publishContent, getQuotaStatus, generateThesisFingerprint } from "./publisher";
import { generateContent, type GeneratedContent } from "./content-generator";
import { DEFAULT_SCORING_CONFIG } from "./opportunity-engine";
import { resolveChartCoin, generateChartMetadata } from "./chart-utils";
import { db } from "@/db";
import { squarePipelineExecutions } from "@/db/schema";

export interface SquarePipelineResult {
  evaluated: number;
  opportunities: number;
  published: number;
  suppressed: number;
  errors: string[];
}

// ─── Pipeline Execution Summary (P5 — Failure-rate visibility) ─────

export interface PipelineExecutionSummary {
  /** Timestamp of this pipeline execution */
  executedAt: string;
  /** Duration of the full pipeline in ms */
  durationMs: number;
  /** Opportunities evaluated by the engine */
  evaluated: number;
  /** Opportunities that passed quality gates */
  qualified: number;
  /** Opportunities that were persisted */
  persisted: number;
  /** Posts successfully published */
  published: number;
  /** Posts that failed publication */
  failed: number;
  /** Posts suppressed by deduplication */
  deduplicated: number;
  /** Posts blocked by quota */
  quotaBlocked: number;
  /** Posts pending retry */
  retryPending: number;
  /** Quota status at start of cycle */
  quotaRemaining: number;
  /** Quota warning triggered */
  quotaWarning: boolean;
  /** LLM usage: how many used LLM vs template */
  llmUsedCount: number;
  llmFallbackCount: number;
  /** Per-opportunity results */
  details: PipelineDetail[];
}

export interface PipelineDetail {
  opportunityId: number;
  coinSymbol?: string;
  type: string;
  score: number;
  result: "PUBLISHED" | "FAILED" | "DEDUPED" | "QUOTA_BLOCKED" | "RETRY_PENDING" | "SKIPPED";
  retryCount: number;
  failureCategory?: string;
  latencyMs?: number;
}

let _lastSummary: PipelineExecutionSummary | null = null;

/**
 * Get the last pipeline execution summary.
 * Returns null if no pipeline has been executed yet.
 */
export function getLastPipelineSummary(): PipelineExecutionSummary | null {
  return _lastSummary;
}

function extractSignal(rationale: string[]): string {
  const signalEntry = rationale.find((r) => r.startsWith("Signal: "));
  return signalEntry ? signalEntry.replace("Signal: ", "") : "OBSERVE";
}

export async function runSquarePipeline(): Promise<SquarePipelineResult> {
  const errors: string[] = [];
  let published = 0;
  const startTime = Date.now();
  const details: PipelineDetail[] = [];

  try {
    // 1. Check quota
    const quota = await getQuotaStatus();
    if (quota.postsRemaining <= 0) {
      const summary: PipelineExecutionSummary = {
        executedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        evaluated: 0,
        qualified: 0,
        persisted: 0,
        published: 0,
        failed: 0,
        deduplicated: 0,
        quotaBlocked: 0,
        retryPending: 0,
        quotaRemaining: 0,
        quotaWarning: quota.warningThreshold,
        llmUsedCount: 0,
        llmFallbackCount: 0,
        details: [],
      };
      _lastSummary = summary;
      return {
        evaluated: 0,
        opportunities: 0,
        published: 0,
        suppressed: 0,
        errors: ["Daily post quota exhausted"],
      };
    }

    // 2. Evaluate opportunities
    const evaluation = await evaluateOpportunities(DEFAULT_SCORING_CONFIG);

    if (evaluation.errors.length > 0) {
      errors.push(...evaluation.errors);
    }

    // 3. Persist opportunities
    const persistedOpps: { id: number; score: number; opp: SquareOpportunity }[] = [];
    for (const opp of evaluation.opportunities) {
      try {
        const id = await persistOpportunity(opp);
        persistedOpps.push({ id, score: opp.score, opp });
      } catch (err) {
        errors.push(
          `Failed to persist opportunity for ${opp.coinSymbol ?? opp.type}: ${err instanceof Error ? err.message : "Unknown"}`
        );
      }
    }

    // 4. Publish top opportunities (respecting soft cap)
    const softCap = DEFAULT_SCORING_CONFIG.dailySoftCap;
    let quotaRemaining = quota.postsRemaining;
    let publishedCount = 0;
    let failedCount = 0;
    let deduplicatedCount = 0;
    let quotaBlockedCount = 0;
    let retryPendingCount = 0;
    let llmUsedCount = 0;
    let llmFallbackCount = 0;

    const toPublish = persistedOpps
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(softCap, quotaRemaining));

    for (const opp of toPublish) {
      try {
        // Check remaining quota before each publish
        if (quotaRemaining <= 0) {
          details.push({
            opportunityId: opp.id,
            coinSymbol: opp.opp.coinSymbol,
            type: opp.opp.type,
            score: opp.opp.score,
            result: "QUOTA_BLOCKED",
            retryCount: 0,
          });
          quotaBlockedCount++;
          continue;
        }

        const origOpp = opp.opp;
        const brief = buildContentBrief(origOpp);
        const chartCoin = resolveChartCoin(brief.chartCoin, brief.cashtags);
        const chartMeta = generateChartMetadata(chartCoin, origOpp.coinSymbol);

        const signal = extractSignal(origOpp.rationale);
        const tpLevels = origOpp.takeProfits?.map((tp) => tp.level) || [];
        const slLevel = origOpp.stopLoss?.level || null;
        const entryLow = origOpp.entry?.low || null;
        const entryHigh = origOpp.entry?.high || null;
        const coinSymbols =
          origOpp.type === "NARRATIVE_SETUP" && origOpp.leadingCoinSymbols
            ? origOpp.leadingCoinSymbols
            : origOpp.coinSymbol
              ? [origOpp.coinSymbol]
              : [];

        const thesisFingerprint = generateThesisFingerprint({
          type: origOpp.type,
          subjectId: origOpp.subjectId,
          narrativeId: origOpp.narrativeId || null,
          coinSymbols,
          signal,
          entryLow,
          entryHigh,
          tpLevels,
          slLevel,
          invalidation: brief.invalidation || null,
        });

        // Generate content (LLM or template fallback)
        let generated: GeneratedContent;
        try {
          generated = await generateContent(brief);
        } catch (err) {
          // Content generation failed entirely — skip this opportunity
          failedCount++;
          errors.push(`Content generation failed for opportunity ${opp.id}: ${err instanceof Error ? err.message : "Unknown"}`);
          details.push({
            opportunityId: opp.id,
            coinSymbol: opp.opp.coinSymbol,
            type: opp.opp.type,
            score: opp.opp.score,
            result: "FAILED",
            retryCount: 0,
          });
          continue;
        }

        if (generated.llmUsed) llmUsedCount++;
        else llmFallbackCount++;

        const pubStart = Date.now();
        const result = await publishContent(
          opp.id,
          generated.text,
          generated.title,
          chartMeta,
          thesisFingerprint,
          generated.llmUsed
        );
        const pubLatency = Date.now() - pubStart;

        if (result.success) {
          publishedCount++;
          quotaRemaining--;
          details.push({
            opportunityId: opp.id,
            coinSymbol: opp.opp.coinSymbol,
            type: opp.opp.type,
            score: opp.opp.score,
            result: "PUBLISHED",
            retryCount: result.retryCount,
            latencyMs: pubLatency,
          });
        } else if (result.failureCategory === "TRANSIENT" || result.failureCategory === "TIMEOUT") {
          retryPendingCount++;
          details.push({
            opportunityId: opp.id,
            coinSymbol: opp.opp.coinSymbol,
            type: opp.opp.type,
            score: opp.opp.score,
            result: "RETRY_PENDING",
            retryCount: result.retryCount,
            failureCategory: result.failureCategory,
            latencyMs: pubLatency,
          });
        } else {
          const errorMsg = result.errorMessage ?? result.errorCode;
          if (errorMsg === "THESIS_STABLE" || errorMsg === "DUPLICATE") {
            deduplicatedCount++;
            details.push({
              opportunityId: opp.id,
              coinSymbol: opp.opp.coinSymbol,
              type: opp.opp.type,
              score: opp.opp.score,
              result: "DEDUPED",
              retryCount: result.retryCount,
              latencyMs: pubLatency,
            });
          } else {
            failedCount++;
            errors.push(
              `Publish failed for opportunity ${opp.id}: ${errorMsg}`
            );
            details.push({
              opportunityId: opp.id,
              coinSymbol: opp.opp.coinSymbol,
              type: opp.opp.type,
              score: opp.opp.score,
              result: "FAILED",
              retryCount: result.retryCount,
              failureCategory: result.failureCategory,
              latencyMs: pubLatency,
            });
          }
        }
      } catch (err) {
        failedCount++;
        errors.push(
          `Content generation failed for opportunity ${opp.id}: ${err instanceof Error ? err.message : "Unknown"}`
        );
        details.push({
          opportunityId: opp.id,
          coinSymbol: opp.opp.coinSymbol,
          type: opp.opp.type,
          score: opp.opp.score,
          result: "FAILED",
          retryCount: 0,
        });
      }
    }

    published = publishedCount;

    // 5. Build execution summary
    const summary: PipelineExecutionSummary = {
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      evaluated: evaluation.evaluated,
      qualified: evaluation.opportunities.length,
      persisted: persistedOpps.length,
      published: publishedCount,
      failed: failedCount,
      deduplicated: deduplicatedCount,
      quotaBlocked: quotaBlockedCount,
      retryPending: retryPendingCount,
      quotaRemaining,
      quotaWarning: quota.warningThreshold,
      llmUsedCount,
      llmFallbackCount,
      details,
    };

    _lastSummary = summary;

    // Persist execution record for analytics
    try {
      await db.insert(squarePipelineExecutions).values({
        startedAt: new Date(startTime),
        completedAt: new Date(),
        triggerType: "SCHEDULED",
        evaluated: evaluation.evaluated,
        qualified: evaluation.opportunities.length,
        published: publishedCount,
        failed: failedCount,
        deduplicated: deduplicatedCount,
        quotaBlocked: quotaBlockedCount,
        retryPending: retryPendingCount,
        contentGenerationFailed: failedCount,
        llmUsedCount,
        templateFallbackCount: llmFallbackCount,
        durationMs: summary.durationMs,
        quotaRemainingStart: quota.postsRemaining,
        quotaRemainingEnd: quotaRemaining,
        quotaWarning: quota.warningThreshold,
        errorSummary: errors.length > 0 ? { errors, error_count: errors.length } : null,
      });
    } catch (err) {
      console.error("[SQ-PIPELINE] Failed to record execution:", err);
    }

    // Log summary
    console.log(
      `[SQ-PIPELINE] evaluated=${evaluation.evaluated} qualified=${evaluation.opportunities.length} ` +
      `published=${publishedCount} failed=${failedCount} deduped=${deduplicatedCount} ` +
      `retryPending=${retryPendingCount} quotaBlocked=${quotaBlockedCount} ` +
      `duration=${summary.durationMs}ms quotaRemaining=${quotaRemaining}`
    );

    return {
      evaluated: evaluation.evaluated,
      opportunities: persistedOpps.length,
      published,
      suppressed: evaluation.suppressed,
      errors,
    };
  } catch (error) {
    errors.push(
      `Square pipeline failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );

    // Record failed execution
    _lastSummary = {
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      evaluated: 0,
      qualified: 0,
      persisted: 0,
      published: 0,
      failed: 1,
      deduplicated: 0,
      quotaBlocked: 0,
      retryPending: 0,
      quotaRemaining: 0,
      quotaWarning: false,
      llmUsedCount: 0,
      llmFallbackCount: 0,
      details: [],
    };

    // Persist failed execution record
    try {
      await db.insert(squarePipelineExecutions).values({
        startedAt: new Date(startTime),
        completedAt: new Date(),
        triggerType: "SCHEDULED",
        evaluated: 0,
        qualified: 0,
        published: 0,
        failed: 1,
        deduplicated: 0,
        quotaBlocked: 0,
        retryPending: 0,
        contentGenerationFailed: 0,
        llmUsedCount: 0,
        templateFallbackCount: 0,
        durationMs: Date.now() - startTime,
        quotaRemainingStart: 0,
        quotaRemainingEnd: 0,
        quotaWarning: false,
        errorSummary: { errors, error_count: errors.length },
      });
    } catch (persistErr) {
      console.error("[SQ-PIPELINE] Failed to record failed execution:", persistErr);
    }

    return {
      evaluated: 0,
      opportunities: 0,
      published: 0,
      suppressed: 0,
      errors,
    };
  }
}
