import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coins } from "@/db/schema";
import { eq, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Internal slug/id resolver for the SEO alias layer (middleware).
 *
 * GET /api/seo/coin/36   → { success: true, data: { id: 36, slug: "arb" } }
 * GET /api/seo/coin/arb  → same shape, matched by symbol (case-insensitive)
 *                          or by name slugified.
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
    const [coin] = idOnly
      ? await db
          .select({ id: coins.id, symbol: coins.symbol })
          .from(coins)
          .where(eq(coins.id, Number(idOnly[1])))
          .limit(1)
      : await db
          .select({ id: coins.id, symbol: coins.symbol })
          .from(coins)
          .where(
            or(
              eq(sql`lower(${coins.symbol})`, raw),
              eq(sql`lower(replace(${coins.name}, ' ', '-'))`, raw)
            )
          )
          .limit(1);

    if (!coin) {
      return NextResponse.json(
        { success: false, error: "Not found" },
        { status: 404 }
      );
    }

    const slug =
      coin.symbol.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
      `coin-${coin.id}`;

    return NextResponse.json({ success: true, data: { id: coin.id, slug } });
  } catch (error) {
    console.error("[GET /api/seo/coin]", error);
    return NextResponse.json(
      { success: false, error: "Slug resolution failed" },
      { status: 500 }
    );
  }
}
