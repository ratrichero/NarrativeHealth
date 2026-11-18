import { NextRequest, NextResponse } from "next/server";
import { getMoverDetail } from "@/lib/market/radar";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

// GET /api/market/movers/[symbol] — chi tiết + chart 4h + setup ATR.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  try {
    const detail = await getMoverDetail(symbol);
    if (!detail) {
      return NextResponse.json(
        { success: false, error: `Không tìm thấy ${symbol.toUpperCase()} trên Binance Futures.` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không lấy được chi tiết";
    console.error("[RADAR] Detail failed:", message);
    return NextResponse.json({ success: false, error: message }, { status: 503 });
  }
}
