import { NextRequest, NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market/radar";
import { catalystLimiter, clientIpFromHeaders, rateLimitHeaders } from "@/lib/market/rate-limit";
import { matchCatalystsForSymbol } from "@/lib/catalyst/matching";
import { readRecentCatalystFacts } from "@/lib/catalyst/store";
import { summarizeCatalysts } from "@/lib/catalyst/summarize";
import { catalystSyncInfo, readCatalystSyncStatus } from "@/lib/catalyst/sync";
import type { CatalystSummary } from "@/lib/catalyst/types";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { expires: number; value: CatalystSummary }>();

// GET /api/market/movers/[symbol]/catalysts — “vì sao volume bất thường”, facts + link nguồn.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const rate = catalystLimiter.check(clientIpFromHeaders(request.headers));
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: `Quá nhiều request. Thử lại sau ${rate.retryAfterSec}s.` },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }

  const { symbol: raw } = await params;
  const symbol = normalizeSymbol(raw);
  if (!/^[A-Z0-9]{2,15}$/.test(symbol)) {
    return NextResponse.json({ success: false, error: "Symbol không hợp lệ." }, { status: 400 });
  }

  try {
    // Trạng thái sync là một phần kết quả: nó quyết định panel nói “chưa đồng bộ
    // nguồn” hay “đã kiểm tra nhưng không có catalyst khớp”. Cache key gồm state
    // để lần sync đầu tiên không bị cache “never_synced” che mất 30 phút.
    const sync = catalystSyncInfo(await readCatalystSyncStatus());
    const key = `${symbol}|${new Date().toISOString().slice(0, 10)}|${sync.state}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json({ success: true, data: cached.value }, { headers: rateLimitHeaders(rate) });
    }

    const facts = await readRecentCatalystFacts({ sinceDays: 14 });
    const matched = matchCatalystsForSymbol(symbol, facts);
    const summary = await summarizeCatalysts(symbol, matched, sync);

    const value: CatalystSummary = {
      symbol,
      facts: matched,
      summary: summary.text,
      mode: summary.mode,
      provider: summary.provider,
      generatedAt: new Date().toISOString(),
      note: summary.note,
      sync,
    };

    cache.set(key, { expires: Date.now() + TTL_MS, value });
    return NextResponse.json({ success: true, data: value }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được catalyst";
    console.error("[RADAR] Catalyst failed:", message);
    return NextResponse.json(
      {
        success: false,
        error: "Chưa đọc được catalyst (nguồn/DB chưa sẵn sàng).",
      },
      { status: 503 }
    );
  }
}
