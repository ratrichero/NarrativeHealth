import { NextRequest, NextResponse } from "next/server";
import { BriefUnavailableError, getMoverBrief } from "@/lib/market/brief";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/market/movers/[symbol]/brief — LLM brief opt-in (user bấm nút).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  try {
    const brief = await getMoverBrief(symbol);
    if (!brief) {
      return NextResponse.json(
        { success: false, error: `Không tìm thấy ${symbol.toUpperCase()} trên Binance Futures.` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: brief });
  } catch (error) {
    if (error instanceof BriefUnavailableError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "Không tạo được brief";
    console.error("[RADAR] Brief failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 503 });
  }
}
