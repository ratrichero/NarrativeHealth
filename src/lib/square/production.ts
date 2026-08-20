// Square Pipeline — Production Wiring
// Post-refresh hook: evaluates opportunities after data refresh completes

import { evaluateOpportunities, buildContentBrief } from "./opportunity-engine";
import { persistOpportunity, publishContent, getQuotaStatus } from "./publisher";
import { DEFAULT_SCORING_CONFIG } from "./opportunity-engine";
import { resolveChartCoin, generateChartMetadata } from "./chart-utils";

export interface SquarePipelineResult {
  evaluated: number;
  opportunities: number;
  published: number;
  suppressed: number;
  errors: string[];
}

/**
 * Run the Square content pipeline after a successful data refresh.
 * This is called as a non-blocking side effect — it must NOT affect
 * the refresh success/failure status.
 *
 * Architecture:
 *   Refresh completes → Square pipeline fires → opportunities evaluated → content published
 *
 * The pipeline is fully isolated from the refresh pipeline.
 * A failure here does NOT mark the refresh as failed.
 */
export async function runSquarePipeline(): Promise<SquarePipelineResult> {
  const errors: string[] = [];
  let published = 0;

  try {
    // 1. Check quota
    const quota = await getQuotaStatus();
    if (quota.postsRemaining <= 0) {
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
    const persistedOpps: { id: number; score: number }[] = [];
    for (const opp of evaluation.opportunities) {
      try {
        const id = await persistOpportunity(opp);
        persistedOpps.push({ id, score: opp.score });
      } catch (err) {
        errors.push(
          `Failed to persist opportunity for ${opp.coinSymbol ?? opp.type}: ${err instanceof Error ? err.message : "Unknown"}`
        );
      }
    }

    // 4. Publish top opportunities (respecting soft cap)
    const softCap = DEFAULT_SCORING_CONFIG.dailySoftCap;
    const toPublish = persistedOpps
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(softCap, quota.postsRemaining));

    for (const opp of toPublish) {
      try {
        // Find the original opportunity data for content generation
        const origOpp = evaluation.opportunities.find(
          (o) => o.score === opp.score
        );
        if (!origOpp) continue;

        const brief = buildContentBrief(origOpp);
        const chartCoin = resolveChartCoin(brief.chartCoin, brief.cashtags);
        const chartMeta = generateChartMetadata(chartCoin, origOpp.coinSymbol);
        const result = await publishContent(opp.id, brief.text, undefined, chartMeta);

        if (result.success) {
          published++;
        } else {
          errors.push(
            `Publish failed for opportunity ${opp.id}: ${result.errorMessage ?? result.errorCode}`
          );
        }
      } catch (err) {
        errors.push(
          `Content generation failed for opportunity ${opp.id}: ${err instanceof Error ? err.message : "Unknown"}`
        );
      }
    }

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
    return {
      evaluated: 0,
      opportunities: 0,
      published: 0,
      suppressed: 0,
      errors,
    };
  }
}
