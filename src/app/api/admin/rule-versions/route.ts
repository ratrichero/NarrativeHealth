import { NextRequest, NextResponse } from "next/server";
import { ruleVersionService } from "@/lib/services/rule-version.service";
import type {
  CreateRuleVersionInput,
  HealthWeights,
  ConfidenceWeights,
  RecommendationThresholds,
} from "@/lib/types/rule-version";

export const dynamic = "force-dynamic";

// GET - List all rule versions
export async function GET() {
  try {
    const versions = await ruleVersionService.getAllVersions();

    return NextResponse.json({ success: true, data: versions });
  } catch (error) {
    console.error("[GET /api/admin/rule-versions]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch rule versions" },
      { status: 500 }
    );
  }
}

// POST - Create a new rule version
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields present
    const { healthWeights, confidenceWeights, recommendationThresholds } = body;

    if (!healthWeights || !confidenceWeights || !recommendationThresholds) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required fields: healthWeights, confidenceWeights, recommendationThresholds",
        },
        { status: 400 }
      );
    }

    const input: CreateRuleVersionInput = {
      description: body.description,
      healthWeights: healthWeights as HealthWeights,
      confidenceWeights: confidenceWeights as ConfidenceWeights,
      recommendationThresholds:
        recommendationThresholds as RecommendationThresholds,
    };

    const activateImmediately = body.activateImmediately === true;

    const version = await ruleVersionService.createVersion(
      input,
      activateImmediately
    );

    return NextResponse.json(
      { success: true, data: version },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/admin/rule-versions]", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    // Validation errors (weight sum, threshold ordering) → 422
    if (
      message.includes("sum") ||
      message.includes("must be greater than") ||
      message.includes("must be") ||
      message.includes("Invalid")
    ) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to create rule version" },
      { status: 500 }
    );
  }
}