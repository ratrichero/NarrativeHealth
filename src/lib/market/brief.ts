// RADAR-BRIEF: LLM đọc số liệu radar và viết brief ngắn (opt-in, có cache).
// Quota chỉ bị trừ khi thực sự gọi LLM: cache hit, symbol không tồn tại hoặc
// LLM disabled đều không tiêu quota.

import {
  chatCompletion,
  type LLMCompletionOptions,
  type LLMCompletionResult,
} from "@/lib/chat/llm";
import { getMoverDetail, normalizeSymbol, type RadarDetail } from "@/lib/market/radar";
import { briefDailyLimit } from "@/lib/market/rate-limit";
import { consumeBriefQuota, type QuotaDecision } from "@/lib/market/brief-quota";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { expires: number; value: BriefResult }>();

export interface BriefResult {
  text: string;
  provider: string;
  generatedAt: string;
  cached: boolean;
}

export class BriefUnavailableError extends Error {}

export class BriefQuotaExceededError extends Error {
  constructor(public readonly decision: QuotaDecision) {
    super(`Đã hết quota AI brief hôm nay (${decision.limit}/ngày). Thử lại sau 00:00 UTC.`);
  }
}

interface BriefDeps {
  getDetail: (symbol: string) => Promise<RadarDetail | null>;
  complete: (opts: LLMCompletionOptions) => Promise<LLMCompletionResult | null>;
  consumeQuota: () => Promise<QuotaDecision>;
}

const defaultDeps: BriefDeps = {
  getDetail: getMoverDetail,
  complete: chatCompletion,
  consumeQuota: () => consumeBriefQuota(briefDailyLimit()),
};

function formatPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "không có dữ liệu";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function buildPrompt(detail: RadarDetail): string {
  const r = detail.row;
  const m = {
    symbol: r.symbol,
    price: r.price,
    change24h: formatPct(r.changePct),
    volume24hUsd: Math.round(r.quoteVolume),
    volumeRatio7d: r.volumeRatio7d,
    volumeZ: r.volumeZ,
    atrPct: r.atrPct,
    changeAtrMultiple: r.changeAtrMultiple,
    rangePosition24h: Number((r.rangePosition * 100).toFixed(1)),
    distanceFromHigh24h: formatPct(-r.distanceFromHighPct),
    rsi4h: r.rsi14,
    funding8h: r.fundingRate === null ? null : `${(r.fundingRate * 100).toFixed(4)}%`,
    oiChange24h: formatPct(r.oiChangePct),
    range7d: formatPct(r.rangePct7d ?? null),
    breakout7d: r.isBreakout7d,
    listingAgeDays: r.listingAgeDays,
    bias: r.label,
    score: r.score,
    entryQuality: r.entryQuality,
    reasons: r.reasons,
    warnings: r.warnings,
    setup: detail.setup,
    inSystem: r.inSystem,
    narratives: r.narratives,
  };

  return [
    "Dữ liệu radar Binance Futures (24h) của một coin:",
    JSON.stringify(m, null, 2),
    "",
    "Viết brief tiếng Việt, tối đa 220 từ, đúng 4 mục ngắn:",
    "1) Điều gì đang xảy ra (chỉ từ số liệu trên).",
    "2) Điểm xác nhận vs điểm mâu thuẫn (volume/OI/funding/vị trí range).",
    "3) Kịch bản tiếp diễn và kịch bản đảo, kèm mức giá tham khảo nếu có setup.",
    "4) Cảnh báo rủi ro (đuổi giá, funding, thanh khoản, coin mới).",
    "Không dùng từ 'mua ngay', 'short ngay', 'all-in', 'chắc chắn thắng'. Không hứa lợi nhuận.",
  ].join("\n");
}

export async function getMoverBrief(
  rawSymbol: string,
  deps: Partial<BriefDeps> = {}
): Promise<BriefResult | null> {
  if (process.env.RADAR_LLM_ENABLED === "0") {
    throw new BriefUnavailableError("LLM brief đang tắt (RADAR_LLM_ENABLED=0).");
  }

  const resolved: BriefDeps = { ...defaultDeps, ...deps };
  const earlyKey = `${normalizeSymbol(rawSymbol)}USDT`;

  // Cache hit không cần fetch detail và không tiêu quota.
  const earlyHit = cache.get(earlyKey);
  if (earlyHit && earlyHit.expires > Date.now()) {
    return { ...earlyHit.value, cached: true };
  }

  const detail = await resolved.getDetail(rawSymbol);
  if (!detail) return null;

  const key = detail.row.pair;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return { ...hit.value, cached: true };
  }

  // Chỉ tới đây mới thực sự gọi LLM → mới trừ quota.
  const quota = await resolved.consumeQuota();
  if (!quota.allowed) throw new BriefQuotaExceededError(quota);

  const completion = await resolved.complete({
    profile: "movers",
    temperature: 0.3,
    maxTokens: 600,
    timeoutMs: 30_000,
    messages: [
      {
        role: "system",
        content:
          "Bạn là analyst futures cẩn trọng. Chỉ dùng số liệu được cung cấp, không bịa tin tức. " +
          "Mục tiêu là giúp người đọc hiểu cấu trúc move và rủi ro, không phải ra lệnh giao dịch. " +
          "Trả lời tiếng Việt, ngắn gọn, có mức giá cụ thể khi setup tồn tại.",
      },
      { role: "user", content: buildPrompt(detail) },
    ],
  });

  if (!completion) {
    throw new BriefUnavailableError("Không có LLM provider khả dụng cho brief.");
  }

  const body = (completion.message.content ?? "").trim();
  if (!body) throw new BriefUnavailableError("LLM trả về nội dung rỗng.");

  const value: BriefResult = {
    text:
      `${body}\n\n— Brief tự động từ số liệu Binance Futures tại thời điểm chụp; ` +
      "không phải khuyến nghị đầu tư. Giá có thể đã thay đổi.",
    provider: completion.provider,
    generatedAt: new Date().toISOString(),
    cached: false,
  };

  cache.set(key, { expires: Date.now() + TTL_MS, value });
  return value;
}

/** Chỉ dùng trong test. */
export function resetBriefCache(): void {
  cache.clear();
}
