// Square Content Generator
// LLM + deterministic template fallback for Binance Square posts

import type { SquareContentBrief } from "./opportunity-engine";

// ─── Template Version ──────────────────────────────────

const TEMPLATE_VERSION = "1.0.0";
const MAX_LLM_OUTPUT_TOKENS = 1200;
const MAX_TEXT_LENGTH = 1200;

// ─── Types ─────────────────────────────────────────────

export interface GeneratedContent {
  text: string;
  title?: string;
  llmUsed: boolean;
  /** Which LLM tier generated this content: primary | fallback1 | fallback2. Absent for template. */
  llmProvider?: string;
  templateVersion: string;
}

export interface ContentGenerationConfig {
  maxTextLength: number;
  includeDisclaimer: boolean;
  useLLM: boolean;
}

export const DEFAULT_CONTENT_CONFIG: ContentGenerationConfig = {
  maxTextLength: MAX_TEXT_LENGTH,
  includeDisclaimer: true,
  useLLM: true,
};

// ─── LLM Integration (OpenAI-compatible, multi-tier fallback) ──

// Provider chain, resolved once from env. Mirrors backend/provider/config.py:
// primary → fallback 1 → fallback 2. Any OpenAI-compatible endpoint works
// (Groq, DeepSeek, OpenRouter, Ollama, vLLM...).
interface LLMProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function resolveProviderChain(): LLMProviderConfig[] {
  const chain: LLMProviderConfig[] = [];

  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey) {
    chain.push({
      name: "primary",
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: primaryKey,
      model: process.env.MODEL_NAME || "gpt-4o-mini",
    });
  }

  const fallbackKey = process.env.FALLBACK_OPENAI_API_KEY;
  if (fallbackKey && process.env.FALLBACK_MODEL_NAME) {
    chain.push({
      name: "fallback1",
      baseUrl: (process.env.FALLBACK_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: fallbackKey,
      model: process.env.FALLBACK_MODEL_NAME,
    });
  }

  const fallback2Key = process.env.FALLBACK2_OPENAI_API_KEY;
  if (fallback2Key && process.env.FALLBACK2_MODEL_NAME) {
    chain.push({
      name: "fallback2",
      baseUrl: (process.env.FALLBACK2_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: fallback2Key,
      model: process.env.FALLBACK2_MODEL_NAME,
    });
  }

  return chain;
}

async function callOpenAICompatible(
  provider: LLMProviderConfig,
  prompt: string
): Promise<string | null> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: MAX_LLM_OUTPUT_TOKENS,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    console.warn(
      `[SQ-LLM] ${provider.name} (${provider.model}) HTTP ${response.status}: ${errBody.slice(0, 300)}`
    );
    return null;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  return typeof text === "string" && text.length > 0 ? text : null;
}

async function generateWithLLM(
  brief: SquareContentBrief
): Promise<GeneratedContent | null> {
  const chain = resolveProviderChain();
  if (chain.length === 0) {
    // SQ-DIAG: the #1 reason every post falls back to template.
    console.warn("[SQ-LLM] No LLM provider configured (OPENAI_API_KEY missing) — falling back to template.");
    return null;
  }

  const prompt = buildLLMPrompt(brief);

  for (const provider of chain) {
    try {
      const generatedText = await callOpenAICompatible(provider, prompt);

      if (!generatedText) {
        console.warn(`[SQ-LLM] ${provider.name} returned empty content — trying next provider.`);
        continue;
      }

      const validated = validateLLMOutput(generatedText, brief);
      if (!validated) {
        console.warn(`[SQ-LLM] ${provider.name} output failed validation — trying next provider.`);
        continue;
      }

      return {
        text: validated,
        llmUsed: true,
        llmProvider: provider.name,
        templateVersion: TEMPLATE_VERSION,
      };
    } catch (error) {
      console.warn(
        `[SQ-LLM] ${provider.name} request failed (${error instanceof Error ? error.message : String(error)}) — trying next provider.`
      );
    }
  }

  console.warn("[SQ-LLM] All LLM providers failed — falling back to template.");
  return null;
}

function buildLLMPrompt(brief: SquareContentBrief): string {
  const lines: string[] = [];
  const m = brief.metrics;

  lines.push("You write high-engagement crypto analysis posts for Binance Square.");
  lines.push("Your posts read like a sharp trader sharing real data — dense with numbers, no fluff, no hype words like 'MOON' or 'ROCKET'.");
  lines.push("");
  lines.push("STRUCTURE (follow exactly):");
  lines.push("1. HOOK (1-2 lines): an interesting data event. Open with the number, not a label.");
  lines.push("2. PRICE & SETUP: current price, entry zone, targets (+% gain), stop (-% risk), risk/reward ratio.");
  lines.push("3. DATA READS (bullets): one dense line per signal — trend score, RSI with interpretation, funding rate with interpretation, 24h volume, narrative breadth (X of Y coins up). Every line has a number.");
  lines.push("4. LEADERS: leading coins with cashtags.");
  lines.push("5. INVALIDATION: one clear line — when is this thesis dead.");
  lines.push("6. QUESTION: end with 1 short question inviting readers to comment, then the disclaimer below.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Use ONLY the facts provided below. Do NOT invent any price, volume, or data.");
  lines.push("- Do NOT change Entry/TP/SL levels. Do NOT add or remove cashtags.");
  lines.push("- NEVER use the words BUY, SELL, ORDER, EXECUTE as commands, and never use LONG or SHORT to describe a trade direction (the words long-term/short-term are fine).");
  lines.push("- Keep the whole post under 800 characters.");
  lines.push("- End with exactly: ⚠️ Data-driven analysis, not financial advice. DYOR.");
  lines.push("");
  lines.push("EXAMPLE (style reference — do not copy content):");
  lines.push("---");
  lines.push("$PENDLE just jumped +13.5 points on our narrative health engine — one of the biggest moves across 8 tracked narratives today.");
  lines.push("");
  lines.push("Price: $2.28");
  lines.push("Entry: 2.1962 – 2.3736");
  lines.push("Targets: 2.64 (+15%) → 2.91 (+27%)");
  lines.push("Stop: 2.02 (-11%)");
  lines.push("Risk/reward: 2.4 : 1");
  lines.push("");
  lines.push("What the data says:");
  lines.push("• Trend 72/100 — price above EMA20");
  lines.push("• RSI 58 — momentum building, not extreme");
  lines.push("• Funding +0.008% — longs confident, not crowded");
  lines.push("• Breadth: 6 of 8 coins moving up together — rotation, not a single-coin pump");
  lines.push("");
  lines.push("Leaders: $PENDLE");
  lines.push("");
  lines.push("Invalidate if: price loses 2.02 with sustained weakness.");
  lines.push("");
  lines.push("Which RWA coin are you watching this week? 👇");
  lines.push("");
  lines.push("⚠️ Data-driven analysis, not financial advice. DYOR.");
  lines.push("---");
  lines.push("");
  lines.push("FACTS FOR YOUR POST:");

  if (brief.hookLine) {
    lines.push(`Suggested hook (you may rephrase): ${brief.hookLine}`);
  }

  if (brief.cashtags.length > 0) {
    lines.push(`Cashtags (must appear exactly): ${brief.cashtags.join(" ")}`);
  }

  if (m) {
    lines.push(`Current price: $${m.currentPrice}`);
    if (m.marketCap != null) lines.push(`Market cap: $${m.marketCap.toExponential(2)}`);
    if (m.volume24h != null) lines.push(`24h volume: $${m.volume24h.toFixed(0)}`);
    if (m.priceVsEma20Pct != null) lines.push(`Price vs EMA20: ${m.priceVsEma20Pct >= 0 ? "+" : ""}${m.priceVsEma20Pct.toFixed(1)}%`);
    if (m.rsi14 != null) lines.push(`RSI14: ${m.rsi14.toFixed(1)}`);
    if (m.fundingRate != null) lines.push(`Funding rate: ${m.fundingRate >= 0 ? "+" : ""}${(m.fundingRate * 100).toFixed(3)}%`);
    if (m.openInterest != null) lines.push(`Open interest: ${m.openInterest.toExponential(2)}`);
    lines.push(`Score breakdown: trend ${m.trendScore}/100, derivative ${m.derivativeScore}/100, volume ${m.volumeScore}/100, momentum ${m.momentumScore}/100`);
    if (m.coinsTotal > 0) lines.push(`Narrative breadth: ${m.coinsUp} of ${m.coinsTotal} coins improving`);
    if (m.riskRewardRatio != null) lines.push(`Risk/reward: ${m.riskRewardRatio.toFixed(1)}:1, TP1 gain +${m.tp1GainPct?.toFixed(0)}%, SL risk -${m.slRiskPct?.toFixed(0)}%`);
  }

  const setupEntry = brief.leaderCoinEntry ?? brief.entry;
  const setupTps = brief.leaderCoinTakeProfits ?? brief.takeProfits;
  const setupSl = brief.leaderCoinStopLoss ?? brief.stopLoss;

  if (setupEntry) {
    lines.push(`Entry zone: ${setupEntry.low} – ${setupEntry.high}`);
  }
  if (setupTps) {
    lines.push(`Take profits: ${setupTps.slice(0, 3).map((tp) => `${tp.label ? tp.label + " " : ""}${tp.level}`).join(", ")}`);
  }
  if (setupSl) {
    lines.push(`Stop loss: ${setupSl.level}`);
  }

  if (brief.priceMap) {
    lines.push(`ASCII price map (include verbatim on its own line): ${brief.priceMap}`);
  }

  if (brief.leadingCoinSymbols && brief.leadingCoinSymbols.length > 0) {
    lines.push("");
    lines.push("LEADING COIN RATIONALES:");
    for (let i = 0; i < brief.leadingCoinSymbols!.length; i++) {
      lines.push(`$${brief.leadingCoinSymbols![i]} — ${brief.leadingCoinRationales?.[i] ?? ""}`);
    }
  }

  if (brief.whyNowFacts && brief.whyNowFacts.length > 0) {
    lines.push("");
    lines.push("WHY NOW FACTS:");
    for (const fact of brief.whyNowFacts) {
      lines.push(`• ${fact}`);
    }
  }

  if (brief.invalidation) {
    lines.push("");
    lines.push(`INVALIDATION: ${brief.invalidation}`);
  }

  lines.push("");
  lines.push("Write the post now. Output only the post text, nothing else.");

  return lines.join("\n");
}

function validateLLMOutput(text: string, brief: SquareContentBrief): string | null {
  if (!text || text.length < 20) return null;
  if (text.length > MAX_TEXT_LENGTH) return null;

  const upper = text.toUpperCase();
  // SQ-FIX: previous substring check (includes("LONG")) also matched words like
  // "along", "longer", "prolonged" — rejecting valid posts. Use whole-word match,
  // and allow the common analysis phrases "long-term" / "short-term".
  const forbidden = /\b(BUY|SELL|ORDER|EXECUTE)\b|\b(LONG|SHORT)(?!-?TERM)\b/;
  if (forbidden.test(upper)) return null;

  if (brief.cashtags.length > 0) {
    for (const tag of brief.cashtags) {
      if (!text.includes(tag)) {
        return null;
      }
    }
  }

  if (brief.leadingCoinSymbols && brief.leadingCoinSymbols.length > 0) {
    for (const symbol of brief.leadingCoinSymbols) {
      const tag = `$${symbol}`;
      if (!text.includes(tag)) {
        return null;
      }
    }
  }

  if (brief.invalidation && !text.includes("INVALIDATION") && !text.includes("invalidates")) {
    return null;
  }

  if (brief.whyNowFacts && brief.whyNowFacts.length > 0 && !text.includes("WHY NOW")) {
    return null;
  }

  return text;
}

// ─── Template Fallback (SQ-VIRAL v2) ───────────────────

// Viral-style deterministic template: hook → price/setup → data reads →
// breadth → invalidation → question + disclaimer. Falls back to the original
// brief text only when metrics are unavailable.
function buildViralTemplate(brief: SquareContentBrief): string {
  const m = brief.metrics;
  const leaderEntry = brief.leaderCoinEntry ?? brief.entry;
  const leaderTps = brief.leaderCoinTakeProfits ?? brief.takeProfits;
  const leaderSl = brief.leaderCoinStopLoss ?? brief.stopLoss;
  const fmtPrice = (n: number) =>
    n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6);

  const lines: string[] = [];

  // 1. Hook (rotating, metric-driven)
  lines.push(brief.hookLine ?? brief.text.split("\n")[0]);
  lines.push("");

  // 2. Price + setup with R:R
  if (m && leaderEntry && leaderSl) {
    lines.push(`Price: $${fmtPrice(m.currentPrice)}`);
    lines.push(`Entry: ${fmtPrice(leaderEntry.low)} – ${fmtPrice(leaderEntry.high)}`);
    if (leaderTps && leaderTps.length > 0) {
      const tpStr = leaderTps
        .slice(0, 2)
        .map((tp) => `${fmtPrice(tp.level)}${m.tp1GainPct && tp === leaderTps[0] ? ` (+${m.tp1GainPct.toFixed(0)}%)` : ""}`)
        .join(" → ");
      lines.push(`Targets: ${tpStr}`);
    }
    lines.push(`Stop: ${fmtPrice(leaderSl.level)}${m.slRiskPct != null ? ` (-${m.slRiskPct.toFixed(0)}%)` : ""}`);
    if (m.riskRewardRatio != null) {
      lines.push(`Risk/reward: ${m.riskRewardRatio.toFixed(1)} : 1`);
    }
    if (brief.priceMap) {
      lines.push("");
      lines.push(brief.priceMap);
    }
    lines.push("");
  }

  // 3. Data reads — each metric gets one dense line with a number
  if (m) {
    lines.push("What the data says:");
    if (m.trendScore >= 65) {
      const emaNote =
        m.priceVsEma20Pct != null && m.priceVsEma20Pct >= 0
          ? " — above EMA20"
          : m.priceVsEma20Pct != null
            ? " — below EMA20"
            : "";
      lines.push(`• Trend ${m.trendScore}/100${emaNote}`);
    }
    if (m.rsi14 != null) {
      const rsiRead =
        m.rsi14 >= 70
          ? "overbought territory"
          : m.rsi14 <= 30
            ? "oversold territory"
            : "momentum building, not extreme";
      lines.push(`• RSI ${m.rsi14.toFixed(0)} — ${rsiRead}`);
    }
    if (m.fundingRate != null) {
      const fr = m.fundingRate;
      const frRead =
        fr > 0.01
          ? "longs crowded"
          : fr > 0
            ? "longs confident, not crowded"
            : "shorts paying — contrarian long signal";
      lines.push(`• Funding ${fr >= 0 ? "+" : ""}${(fr * 100).toFixed(3)}% — ${frRead}`);
    }
    if (m.volume24h != null && m.volume24h > 0) {
      const volStr =
        m.volume24h >= 1e9
          ? `$${(m.volume24h / 1e9).toFixed(2)}B`
          : m.volume24h >= 1e6
            ? `$${(m.volume24h / 1e6).toFixed(1)}M`
            : `$${m.volume24h.toFixed(0)}`;
      lines.push(`• 24h volume: ${volStr}`);
    }

    // 4. Breadth (narrative rotation story)
    if (m.coinsTotal > 0 && m.coinsUp > 0) {
      lines.push(
        `• Breadth: ${m.coinsUp} of ${m.coinsTotal} coins moving up together — rotation, not a single-coin pump`
      );
    }
    lines.push("");
  }

  // 5. Leading coins
  if (brief.leadingCoinSymbols && brief.leadingCoinSymbols.length > 0) {
    lines.push(
      `Leaders: ${brief.leadingCoinSymbols.map((s) => `$${s}`).join(" ")}`
    );
    lines.push("");
  }

  // 6. Invalidation
  if (brief.invalidation) {
    lines.push(`Invalidate if: ${brief.invalidation.replace(/^(Setup invalidates if|Narrative thesis weakens if) /i, "")}`);
    lines.push("");
  }

  // 7. Engagement question + disclaimer
  lines.push("What's your read on this one? 👇");
  lines.push("");
  lines.push("⚠️ Data-driven analysis, not financial advice. DYOR.");

  return lines.join("\n");
}

function generateFromBrief(
  brief: SquareContentBrief,
  config: ContentGenerationConfig
): GeneratedContent {
  // SQ-VIRAL v2: use the rich template when metrics are available;
  // otherwise fall back to the engine-built brief text unchanged.
  let text = brief.metrics ? buildViralTemplate(brief) : brief.text;

  if (text.length > config.maxTextLength) {
    text = text.slice(0, config.maxTextLength - 3) + "...";
  }

  return {
    text,
    title: brief.title,
    llmUsed: false,
    llmProvider: undefined,
    templateVersion: "2.0.0",
  };
}

// ─── Main Generator ────────────────────────────────────

export async function generateContent(
  brief: SquareContentBrief,
  config: ContentGenerationConfig = DEFAULT_CONTENT_CONFIG
): Promise<GeneratedContent> {
  if (config.useLLM) {
    const llmResult = await generateWithLLM(brief);
    if (llmResult) return llmResult;
  }

  return generateFromBrief(brief, config);
}
