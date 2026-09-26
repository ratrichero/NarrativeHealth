import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { narratives } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Internal slug/id resolver for the SEO alias layer (middleware).
 *
 * GET /api/seo/narrative/8  → { success: true, data: { id: 8, slug: "ai" } }
 * GET /api/seo/narrative/ai → same shape, matched by name slugified
 *                             ("AI Agents" → "ai-agents", "AI" → "ai").
 *
 * Read-only; one lookup per canonicalization hit.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const raw = decodeURIComponent(key).toLowerCase().trim();
    if (!raw) {
      return NextResponse.json(
        { success: false, error: "Missing key" },
        { status: 400 }
      );
    }

    const idOnly = raw.match(/^(\d+)$/);
    const [narrative] = idOnly
      ? await db
          .select({ id: narratives.id, name: narratives.name })
          .from(narratives)
          .where(eq(narratives.id, Number(idOnly[1])))
          .limit(1)
      : await db
          .select({ id: narratives.id, name: narratives.name })
          .from(narratives)
          .where(
            eq(sql`lower(replace(${narratives.name}, ' ', '-'))`, raw)
          )
          .limit(1);

    if (!narrative) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    const slug =
      narrative.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      `narrative-${narrative.id}`;

    return NextResponse.json({ success: true, data: { id: narrative.id, slug } });
  } catch (error) {
    console.error("[GET /api/seo/narrative]", error);
    return NextResponse.json(
      { success: false, error: "Slug resolution failed" },
      { status: 500 }
    );
  }
}
