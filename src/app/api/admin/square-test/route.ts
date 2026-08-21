import { NextRequest, NextResponse } from "next/server";
import { publishContent, persistOpportunity } from "@/lib/square/publisher";
import { buildContentBrief } from "@/lib/square/opportunity-engine";
import { db } from "@/db";
import { squareOpportunities } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import type { OpportunityType } from "@/lib/square/opportunity-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/square-test
 * 
 * REAL PRODUCTION TEST ENDPOINT for SQ-LIVE-03
 * 
 * This endpoint invokes the REAL Binance Square publisher - no simulation, no mocking.
 * It performs one actual publication to Binance Square and returns the real response.
 * 
 * ⚠️ WARNING: This creates REAL posts on Binance Square
 * 
 * Usage:
 * POST /api/admin/square-test
 * Body: { "opportunityId": number } (optional, will use best candidate if not provided)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const opportunityId = body.opportunityId;

    // Get the best candidate opportunity if not specified
    let opportunity;
    if (opportunityId) {
      const [opp] = await db
        .select()
        .from(squareOpportunities)
        .where(eq(squareOpportunities.id, opportunityId))
        .limit(1);
      
      if (!opp) {
        return NextResponse.json(
          { success: false, error: "Opportunity not found" },
          { status: 404 }
        );
      }
      opportunity = opp;
    } else {
      // Get best unpublished candidate
      const [opp] = await db
        .select()
        .from(squareOpportunities)
        .where(eq(squareOpportunities.status, "CANDIDATE"))
        .orderBy(desc(squareOpportunities.score))
        .limit(1);
      
      if (!opp) {
        return NextResponse.json(
          { success: false, error: "No qualified opportunities found" },
          { status: 400 }
        );
      }
      opportunity = opp;
    }

    console.log(`[SQ-LIVE-03] Testing publication for opportunity ${opportunity.id} (${opportunity.coinSymbol || 'N/A'})`);

    // Persist the opportunity first (if not already persisted)
    let persistedOppId = opportunity.id;
    
    // Build content brief using real opportunity engine
    // Convert database row to SquareOpportunity format
    const squareOpp = {
      id: opportunity.id,
      type: opportunity.type as OpportunityType,
      subjectId: opportunity.subjectId || 0,
      narrativeId: opportunity.narrativeId || undefined,
      coinSymbol: opportunity.coinSymbol || undefined,
      score: parseFloat(opportunity.score),
      dataAsOf: opportunity.dataAsOf,
      dataQuality: opportunity.dataQuality as "HIGH" | "MEDIUM" | "LOW",
      rationale: Array.isArray(opportunity.rationale) ? opportunity.rationale : [],
      entry: opportunity.entryZone as { low: number; high: number } | undefined,
      takeProfits: Array.isArray(opportunity.takeProfits) ? opportunity.takeProfits as Array<{ level: number; label?: string }> : [],
      stopLoss: opportunity.stopLoss as { level: number; label?: string } | undefined,
      status: opportunity.status as "CANDIDATE" | "QUALIFIED" | "SUPPRESSED" | "PUBLISHED" | "EXPIRED"
    };
    
    const brief = buildContentBrief(squareOpp);
    
    console.log(`[SQ-LIVE-03] Content brief generated, length: ${brief.text.length}`);

    // Call the REAL publisher - this makes actual Binance Square API calls
    const result = await publishContent(persistedOppId, brief.text, brief.title, {
      chartSymbol: opportunity.coinSymbol,
      chartMatchesSource: true
    });

    console.log(`[SQ-LIVE-03] Publisher result:`, {
      success: result.success,
      publicationId: result.publicationId,
      externalPostId: result.externalPostId,
      errorCode: result.errorCode
    });

    return NextResponse.json({
      success: result.success,
      opportunity: {
        id: opportunity.id,
        coinSymbol: opportunity.coinSymbol || 'N/A',
        type: opportunity.type,
        score: opportunity.score
      },
      publication: {
        id: result.publicationId,
        externalPostId: result.externalPostId,
        status: result.success ? "PUBLISHED" : "FAILED"
      },
      content: {
        length: brief.text.length,
        cashtag: `$${opportunity.coinSymbol}`,
        hasEntry: !!opportunity.entryZone,
        hasTP: !!opportunity.takeProfits,
        hasSL: !!opportunity.stopLoss
      },
      error: result.errorMessage || result.errorCode
    });

  } catch (error) {
    console.error("[SQ-LIVE-03] Test endpoint error:", error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      },
      { status: 500 }
    );
  }
}