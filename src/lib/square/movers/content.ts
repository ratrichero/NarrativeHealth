// SQ-MOVERS: Content generation cho luồng Top Movers
// LLM chain (google pool → Groq → fallbacks) riêng cho format recap movers,
// rớt về template xác định khi LLM lỗi — cùng triết lý với content-generator
// nhưng brief/prompt/format khác (recap biến động, không phải setup TP/SL).
//
// Tái dùng internals của content-generator qua gateway export bên dưới.

import type { MoverCoin, MoversSnapshot } from "./collector";
import { generateMoversWithLLM } from "@/lib/square/content-generator";

export const MOVERS_TEMPLATE_VERSION = "1.0.0";

const MAX_TEXT_LENGTH = 1400;
/** Ngưỡng volume ratio được gọi là "đột biến" trong content. */
const VOL_SPIKE_THRESHOLD = 2.0;

export interface GeneratedMoversContent {
  text: string;
  title?: string;
  llmUsed: boolean;
  llmProvider?: string;
  templateVersion: string;
}

export interface MoversSubjectBrief {
  kind: "GAINER" | "LOSER";
  rank: number;
  coin: MoverCoin;
}

// ─── Formatting helpers (dùng chung LLM facts + template) ───

export function fmtPrice(n: number): string {
  return n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6);
}

export function fmtFunding(rate: number | null): string | null {
  if (rate == null) return null;
  // lastFundingRate thập phân 0.0001 = 0.01%/8h
  return `${rate >= 0 ? "+" : ""}${(rate * 100).toFixed(3)}%`;
}

export function fmtVolume(volumeUsd: number): string {
  if (volumeUsd >= 1_000_000_000) return `$${(volumeUsd / 1_000_000_000).toFixed(2)}B`;
  if (volumeUsd >= 1_000_000) return `$${(volumeUsd / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(volumeUsd).toLocaleString("en-US")}`;
}

function fmtChange(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function volumeRatioPhrase(coin: MoverCoin): string | null {
  if (coin.volumeRatio == null) return null;
  const ratio = coin.volumeRatio;
  if (ratio >= VOL_SPIKE_THRESHOLD) {
    return `volume 24h ${ratio.toFixed(1)}× so với TB 7 ngày`;
  }
  if (ratio <= 0.5) {
    return `volume 24h chỉ ${ratio.toFixed(1)}× so với TB 7 ngày`;
  }
  return `volume 24h gần mức TB 7 ngày`;
}

function fundingPhrase(coin: MoverCoin): string | null {
  const f = fmtFunding(coin.fundingRate);
  if (f == null) return null;
  if (coin.fundingRate! < 0) {
    return `funding ${f} — short đang trả phí, phe dài bám giá`;
  }
  if (coin.fundingRate! > 0.0005) {
    return `funding ${f} — dài đông, cẩn thận squeeze`;
  }
  return `funding ${f} — định giá cân bằng`;
}

// ─── LLM facts ───

function subjectFacts(s: MoversSubjectBrief): string[] {
  const lines: string[] = [];
  const coin = s.coin;
  lines.push(`Role: ${s.kind === "GAINER" ? "TOP GAINER" : "TOP LOSS"} #${s.rank} trong 24h qua`);
  lines.push(`Cashtag (must appear exactly): $${coin.symbol}`);
  lines.push(`24h change: ${fmtChange(coin.changePct)}`);
  lines.push(`Current price: $${fmtPrice(coin.price)}`);
  lines.push(`24h quote volume: ${fmtVolume(coin.quoteVolume)}`);
  const vr = volumeRatioPhrase(coin);
  if (vr) lines.push(`Volume context: ${vr}`);
  const fp = fundingPhrase(coin);
  if (fp) lines.push(`Funding context: ${fp}`);
  return lines;
}

function buildMoversPrompt(subject: MoversSubjectBrief, marketCount: number): string {
  const lines: string[] = [];
  const dir = subject.kind === "GAINER" ? "up" : "down";

  lines.push("You write high-engagement crypto posts for Binance Square.");
  lines.push(
    "Your voice: a friendly, experienced market analyst sharing a data-backed read — confident and conversational, never robotic, never hype-y (no 'MOON', 'ROCKET', 'PUMP IT')."
  );
  lines.push("");
  lines.push("AUDIENCE & LANGUAGE RULES:");
  lines.push("- Readers know markets but do NOT know any internal scoring system.");
  lines.push("- NEVER mention 'points', 'scores', 'health engine', 'our engine', 'our system'.");
  lines.push("- Translate data into market terms everyone understands: volume vs average, funding rates, momentum, crowded positioning.");
  lines.push("- Every claim must trace to the FACTS below — rewording allowed, inventing numbers NEVER.");
  lines.push("");
  lines.push(`TASK: One post about ONE coin that was a top ${dir} mover on Binance Futures in the last 24h (rank #${subject.rank} among ~${marketCount} USDT perpetual markets).`);
  lines.push("");
  lines.push("STRUCTURE (follow exactly):");
  lines.push("1. HOOK (2-3 sentences): what the coin did in the last 24h with the exact % number, why it matters (what it says about flows/sentiment), and what to watch next.");
  lines.push("2. DATA READS (1-3 short bullet lines, each with a number): price, 24h volume (and whether it is above/below its weekly norm), funding rate and what it implies about positioning.");
  lines.push("3. WATCH: one sentence with a concrete condition (e.g. what holding/losing current levels means).");
  lines.push("4. QUESTION: one short question inviting readers to comment.");
  lines.push("5. End with exactly: ⚠️ Data-driven analysis, not financial advice. DYOR.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Use ONLY the facts provided below. Do NOT invent any price, volume, or funding number.");
  lines.push("- The cashtag must appear exactly once or twice.");
  lines.push("- NEVER use the words BUY, SELL, ORDER, EXECUTE as commands.");
  lines.push("- Keep the whole post between 500 and 900 characters — punchy, dense, no filler.");
  lines.push("- Do not use headers like 'DATA READS' or 'WATCH' verbatim — use natural formatting with bullet points (•).");
  lines.push("");
  lines.push("FACTS FOR YOUR POST:");
  for (const line of subjectFacts(subject)) {
    lines.push(`- ${line}`);
  }
  lines.push("");
  lines.push("Output ONLY the post text, no preamble, no quotes.");

  return lines.join("\n");
}

function validateMoversOutput(text: string, subject: MoversSubjectBrief): string | null {
  if (!text || text.length < 100) return null;
  if (text.length > MAX_TEXT_LENGTH) return null;

  const upper = text.toUpperCase();
  if (/\b(BUY|SELL|ORDER|EXECUTE)\b/.test(upper)) return null;
  // Không lộ ngôn ngữ hệ thống nội bộ
  if (/\b(HEALTH ENGINE|NARRATIVE HEALTH ENGINE)\b/i.test(text)) return null;

  if (!text.includes(`$${subject.coin.symbol}`)) return null;

  // Con số bắt buộc: %24h phải xuất hiện (chống LLM bỏ sót phần cốt lõi)
  const pct = fmtChange(subject.coin.changePct);
  if (!text.includes(pct)) return null;

  if (!text.includes("⚠️ Data-driven analysis, not financial advice. DYOR.")) return null;

  return text;
}

// ─── Template fallback (xác định, luôn đăng được) ───

export function buildMoversTemplate(
  subject: MoversSubjectBrief,
  marketCount: number
): string {
  const coin = subject.coin;
  const isGain = subject.kind === "GAINER";
  const role = isGain ? `Top gainer #${subject.rank}` : `Top loss #${subject.rank}`;

  const hook = isGain
    ? `$${coin.symbol} là một trong những coin tăng mạnh nhất futures 24h qua — ${fmtChange(coin.changePct)} trong bối cảnh ${marketCount} market USDT perpetual.`
    : `$${coin.symbol} đang là một trong những điểm đỏ nhất futures 24h qua — ${fmtChange(coin.changePct)} trên ${marketCount} market USDT perpetual.`;

  const dataLines: string[] = [
    `• Giá: $${fmtPrice(coin.price)} (${fmtChange(coin.changePct)} / 24h)`,
    `• Volume 24h: ${fmtVolume(coin.quoteVolume)}${
      coin.volumeRatio != null
        ? ` — ${coin.volumeRatio >= VOL_SPIKE_THRESHOLD ? `${coin.volumeRatio.toFixed(1)}× TB 7 ngày, dòng tiền vào thật` : coin.volumeRatio <= 0.5 ? "thấp hơn hẳn TB 7 ngày" : "gần TB 7 ngày"}`
        : ""
    }`,
  ];
  const fp = fundingPhrase(coin);
  if (fp) dataLines.push(`• ${fp.charAt(0).toUpperCase()}${fp.slice(1)}`);

  const watch = isGain
    ? coin.volumeRatio != null && coin.volumeRatio >= VOL_SPIKE_THRESHOLD
      ? "Giá tăng cùng volume đột biến — nhịp này khỏe hơn một cú nhảy thiếu tiền. Giữ được vùng giá hiện tại thì đà còn tiếp, mất nó là một cú fake-out."
      : "Giá tăng nhưng volume chưa xác nhận — theo dõi xem tiền có vào tiếp hay không trước khi tin vào đà tăng."
    : coin.fundingRate != null && coin.fundingRate < 0
      ? "Funding âm cho thấy phe dài vẫn bám giá chứ chưa hoảng loạn — một tín hiệu quan trọng: nếu funding đảo dương trong lúc giá chưa hồi thì là dấu hiệu đầu hàng thật sự."
      : "Theo dõi vùng giá hiện tại: giữ được là nhịp chỉnh sức khỏe, mất nó là một cú break cấu trúc thật sự.";

  return [
    hook,
    "",
    `${role} — ${fmtChange(coin.changePct)} / 24h`,
    "",
    ...dataLines,
    "",
    watch,
    "",
    `Bạn đang nắm $${coin.symbol} trong đợt này không? 👇`,
    "",
    "⚠️ Data-driven analysis, not financial advice. DYOR.",
  ].join("\n");
}

// ─── Main generator ───

export async function generateMoversContent(
  subject: MoversSubjectBrief,
  marketCount: number
): Promise<GeneratedMoversContent> {
  const prompt = buildMoversPrompt(subject, marketCount);

  const llm = await generateMoversWithLLM(
    prompt,
    (text) => validateMoversOutput(text, subject),
    "movers"
  );

  if (llm) {
    return {
      text: llm.text,
      title: undefined,
      llmUsed: true,
      llmProvider: llm.provider,
      templateVersion: MOVERS_TEMPLATE_VERSION,
    };
  }

  return {
    text: buildMoversTemplate(subject, marketCount),
    title: undefined,
    llmUsed: false,
    llmProvider: undefined,
    templateVersion: MOVERS_TEMPLATE_VERSION,
  };
}
