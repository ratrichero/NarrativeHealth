// Square Pipeline — Production Wiring
// Post-refresh hook: evaluates opportunities after data refresh completes

import { evaluateOpportunities, buildContentBrief, type SquareOpportunity } from "./opportunity-engine";
import { persistOpportunity, publishContent, getQuotaStatus, generateThesisFingerprint } from "./publisher";
import { DEFAULT_SCORING_CONFIG } from "./opportunity-engine";
import { resolveChartCoin, generateChartMetadata } from "./chart-utils";

export interface SquarePipelineResult {
  evaluated: number;
  opportunities: number;
  published: number;
  suppressed: number;
  errors: string[];
}

function extractSignal(rationale: string[]): string {
  const signalEntry = rationale.find((r) => r.startsWith("Signal: "));
  return signalEntry ? signalEntry.replace("Signal: ", "") : "OBSERVE";
}

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
        const origOpp = evaluation.opportunities.find(
          (o) => o.score === opp.score
        );
        if (!origOpp) continue;

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

        const result = await publishContent(
          opp.id,
          brief.text,
          undefined,
          chartMeta,
          thesisFingerprint
        );

        if (result.success) {
          published++;
        } else {
          const errorMsg = result.errorMessage ?? result.errorCode;
          if (errorMsg === "THESIS_STABLE") {
            errors.push(`Thesis stability suppressed opportunity ${opp.id}`);
          } else {
            errors.push(
              `Publish failed for opportunity ${opp.id}: ${errorMsg}`
            );
          }
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
