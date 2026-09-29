// Square Content Generator
// LLM + deterministic template fallback for Binance Square posts

import type { SquareContentBrief } from "./opportunity-engine";
import { buildChartCta as buildChartCtaFromEngine } from "./opportunity-engine";
import { orderTpsForDisplay } from "./tp-order";

// ─── Template Version ──────────────────────────────────

const TEMPLATE_VERSION = "1.0.0";
// SQ-DIAG: Groq enforces an org-level OTPM (output tokens/minute) limit — for
// qwen models it is 1000. Requesting max_tokens above that limit is rejected
// instantly with HTTP 429 before generation even starts, which silently pushed
// every Square post onto the template fallback. SQ-RICH-CONTENT: 950 tokens
// still sits below the smallest provider OTPM limit while giving the model
// room for the richer 3+ sentence hooks and fuller context paragraphs.
const MAX_LLM_OUTPUT_TOKENS = 950;
const MAX_TEXT_LENGTH = 1400;

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

// Provider chain, resolved once from env. SQ-LLM-GOOGLE-ORDER (2026-09-29):
// google → primary → fallback 1 → fallback 2. The google tier (Gemini's
// OpenAI-compatible surface, GOOGLE_AI_API_KEY) is tried FIRST per product
// decision; Groq primary and the OpenAI-compatible fallbacks back it up.
interface LLMProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function resolveProviderChain(): LLMProviderConfig[] {
  const chain: LLMProviderConfig[] = [];

  // SQ-LLM-GOOGLE: tried FIRST. Model defaults to gemini-2.5-flash-lite
  // (fast, non-thinking, passes post validation); override via
  // GOOGLE_AI_MODEL_NAME. A 403/broken key here costs one fast failed request
  // and the chain continues with Groq.
  const googleKey = process.env.GOOGLE_AI_API_KEY;
  if (googleKey) {
    chain.push({
      name: "google",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: googleKey,
      model: process.env.GOOGLE_AI_MODEL_NAME || "gemini-2.5-flash-lite",
    });
  }

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

type ChatMessage = { role: "user" | "assistant"; content: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function callOpenAICompatible(
  provider: LLMProviderConfig,
  messages: ChatMessage[]
): Promise<string | null> {
  // SQ-DIAG: free/on-demand Groq tiers enforce small OTPM budgets — a 429
  // here is usually "Please try again in N s", not a hard failure. Retry a
  // couple of times with backoff before moving on to the next provider.
  const maxHttpAttempts = 3;
  let response: Response | null = null;

  for (let attempt = 1; attempt <= maxHttpAttempts; attempt++) {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.3,
        max_tokens: MAX_LLM_OUTPUT_TOKENS,
      }),
      // SQ-DIAG: reasoning fallbacks (DeepSeek-V4, qwen3 via OpenRouter) can
      // take 4-30s because reasoning tokens count before any output. 20s was
      // too tight — healthy providers were being skipped as "timed out".
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) break;
    // SQ-LLM-GOOGLE: 503 from Gemini ("high demand — usually temporary") is
    // transient just like a 429 — retry it instead of burning the tier.
    if ((response.status !== 429 && response.status !== 503) || attempt === maxHttpAttempts) break;

    // Honor Retry-After header when present, else simple backoff.
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10000)
      : 2000 * attempt;
    await sleep(waitMs);
  }

  if (!response) return null;

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
  // SQ-LLM-FLAG: SQUARE_LLM_ENABLED=false turns the LLM chain off entirely
  // (template-only posting). Unset or any other value keeps the LLM on —
  // this is the first code that has ever read this variable.
  if (String(process.env.SQUARE_LLM_ENABLED).toLowerCase() === "false") {
    console.warn("[SQ-LLM] SQUARE_LLM_ENABLED=false — LLM disabled, using template fallback.");
    return null;
  }

  const chain = resolveProviderChain();
  if (chain.length === 0) {
    // SQ-DIAG: the #1 reason every post falls back to template.
    console.warn("[SQ-LLM] No LLM provider configured (OPENAI_API_KEY missing) — falling back to template.");
    return null;
  }

  const prompt = buildLLMPrompt(brief);

  for (const provider of chain) {
    try {
      let conversation: { role: "user" | "assistant"; content: string }[] = [
        { role: "user", content: prompt },
      ];
      let attempts = 0;
      const maxAttempts = 3; // initial try + up to 2 repair rounds

      while (attempts < maxAttempts) {
        attempts++;
        const rawText = await callOpenAICompatible(provider, conversation);

        if (!rawText) {
          if (attempts === 1) {
            console.warn(`[SQ-LLM] ${provider.name} returned empty content — trying next provider.`);
            break;
          }
          break; // repair attempt produced nothing — give up on this provider
        }

        // SQ-DIAG: reasoning models (e.g. qwen3) emit <think>…</think> blocks
        // before the answer. Strip them before validation — the post is the
        // text after the think block, not the reasoning itself.
        const generatedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

        const validated = validateLLMOutput(generatedText, brief);
        if (validated) {
          return {
            text: validated,
            llmUsed: true,
            llmProvider: provider.name,
            templateVersion: TEMPLATE_VERSION,
          };
        }

        // Diagnose why validation failed and decide whether a repair round
        // can plausibly fix it (banned word / missing cashtag / missing
        // Direction line / missing WHY NOW or INVALIDATION keyword = all
        // repairable by instruction).
        const bannedMatch = generatedText.match(/\b(BUY|SELL|ORDER|EXECUTE)\b/i);
        const missingTag = brief.cashtags.find((t) => !generatedText.includes(t));
        const missingDirection =
          brief.direction != null && !/Direction:\s*(LONG|SHORT)/i.test(generatedText);
        const missingWhyNow =
          brief.whyNowFacts != null && brief.whyNowFacts.length > 0 && !generatedText.includes("WHY NOW");
        const missingInvalidation =
          brief.invalidation && !generatedText.includes("INVALIDATION") && !generatedText.includes("invalidates");
        const repairable =
          bannedMatch != null || missingTag != null || missingDirection || missingWhyNow || missingInvalidation;

        console.warn(
          `[SQ-LLM] ${provider.name} output failed validation (attempt ${attempts}/${maxAttempts}) ` +
          `(len=${generatedText.length}, ` +
          `bannedWord=${bannedMatch ? `"${bannedMatch[0]}"` : "none"}, ` +
          `missingCashtag=${missingTag ?? "none"}, missingDirection=${missingDirection}, ` +
          `missingWhyNow=${missingWhyNow}, missingInvalidation=${missingInvalidation})` +
          (repairable && attempts < maxAttempts ? " — requesting repair." : " — trying next provider.")
        );

        if (!repairable || attempts >= maxAttempts) break;

        // Repair round: show the model its own output and the violation.
        conversation = [
          ...conversation,
          { role: "assistant", content: generatedText },
          {
            role: "user",
            content:
              `Your post was rejected. Fix it and output ONLY the corrected post text:\n` +
              (bannedMatch
                ? `- The word "${bannedMatch[0]}" is forbidden (trading-command language). Replace it with neutral analysis wording (e.g. "buyers", "sellers" are fine, but never the standalone word).\n`
                : "") +
              (missingTag
                ? `- The cashtag ${missingTag} is missing and must appear exactly.\n`
                : "") +
              (missingDirection
                ? `- Add a line that starts with "Direction: " followed by ${brief.direction} and a one-clause reason. This line is mandatory.\n`
                : "") +
              (missingWhyNow
                ? `- Add a line that starts with the exact phrase "WHY NOW:" followed by the key reason.\n`
                : "") +
              (missingInvalidation
                ? `- Add one line starting with the exact word "INVALIDATION:" describing when the setup is dead.\n`
                : "") +
              `- Keep everything else identical. Output only the post text.`,
          },
        ];
      }
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
  lines.push("Your voice: a friendly, experienced financial analyst sharing a data-backed read with the community — confident and conversational, never robotic, never hype-y. Dense with numbers, no fluff, no hype words like 'MOON' or 'ROCKET'.");
  lines.push("");
  lines.push("AUDIENCE & LANGUAGE RULES:");
  lines.push("- Readers know markets and charts, but they do NOT know our internal scoring system.");
  lines.push("- NEVER mention 'points', 'scores', 'health engine', 'narrative health', 'our engine', 'our system', or any internal metric names. Readers have no idea how we calculate anything — those numbers are meaningless to them.");
  lines.push("- Instead, translate the underlying data into market terms everyone understands: trend vs moving averages, momentum (RSI), funding rates, volume vs average, breadth (how many coins move together).");
  lines.push("- Every claim must still trace to the FACTS below — translation of wording, never invention of data.");
  lines.push("");
  lines.push("DIRECTION (state it unambiguously near the top):");
  if (brief.direction === "SHORT") {
    lines.push("- The direction is SHORT (futures): health/momentum is fading. The provided levels are MIRRORED for a short: the entry zone sits ABOVE the current price (sell rallies into it), targets are BELOW price, and the stop sits ABOVE the entry zone. Present them exactly like that — do NOT frame it as buying the dip, do NOT call targets 'gains' or imply a bounce is coming.");
  } else {
    lines.push("- The direction is LONG (futures): momentum + structure favor upside; frame levels for an accumulation zone.");
  }
  lines.push("- Open the setup section with the exact phrase 'Direction: ' followed by LONG or SHORT plus a one-clause reason.");
  lines.push("");
  lines.push("STRUCTURE (follow exactly):");
  lines.push("1. HOOK (MINIMUM 3 FULL SENTENCES, 3-5 sentences total): this is the heart of the post — make it insightful and engaging. Sentence 1: what the market/coin is doing right now in plain trader language (trend, momentum, volume, breadth). Sentence 2: WHY it matters — the tension or opportunity (e.g. what happens if the level holds vs breaks, what crowded positioning means, what history says about setups like this). Sentence 3: what YOU are watching next (specific level, specific behavior, specific signal). No internal scores or points. Each sentence must add new information — never restate the previous one.");
  lines.push("2. DIRECTION: one line starting with 'Direction: ' — LONG or SHORT, then the why.");
  lines.push("3. PRICE & SETUP: current price, entry zone, targets (+% gain), stop (-% risk), risk/reward ratio.");
  lines.push("4. DATA READS (bullets): one dense line per signal — trend score, RSI with interpretation, funding rate with interpretation, 24h volume, narrative breadth (X of Y coins up). Every line has a number.");
  lines.push("5. LEADERS: leading coins with cashtags.");
  lines.push("6. WHY NOW: one line starting with 'WHY NOW:' — the single most important reason this setup matters TODAY, not a generic restatement.");
  lines.push("7. INVALIDATION: one clear line starting with 'INVALIDATION:' — when is this thesis dead, with a specific condition.");
  lines.push("8. CHART: one line telling readers how to open the chart (use the exact chart pointer provided in FACTS below).");
  lines.push("9. QUESTION: end with 1 short question inviting readers to comment, then the disclaimer below.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Use ONLY the facts provided below. Do NOT invent any price, volume, or data.");
  lines.push("- Do NOT change Entry/TP/SL levels. Do NOT add or remove cashtags.");
  lines.push("- NEVER use the words BUY, SELL, ORDER, EXECUTE as commands. The words LONG and SHORT (as in 'Direction: SHORT setup') are REQUIRED and allowed — just never use them as verbs describing your own past actions.");
  lines.push("- Keep the whole post between 900 and 1300 characters — rich but dense. If the post feels thin, expand the HOOK and the data interpretations, never pad with filler.");
  lines.push("- End with exactly: ⚠️ Data-driven analysis, not financial advice. DYOR.");
  lines.push("");
  lines.push("EXAMPLE (style reference — do not copy content):");
  lines.push("---");
  lines.push("$PENDLE is catching attention today — trend, momentum and volume are lining up in its favor, and breadth confirms it: 6 of 8 coins in the group moving together.");
  lines.push("");
  lines.push("That kind of synchronized rotation is rare — it usually means real capital rotating in, not a single-coin pump. The interesting question is whether the group can hold its higher lows while RSI still has room before overbought. Watch the $2.20 area: buyers defending it keeps the setup alive, losing it turns this into a fade.");
  lines.push("");
  lines.push("Price: $2.28");
  lines.push("Entry: 2.1962 – 2.3736");
  lines.push("Targets: 2.64 (+15%) → 2.91 (+27%)");
  lines.push("Stop: 2.02 (-11%)");
  lines.push("Risk/reward: 2.4 : 1");
  lines.push("");
  lines.push("What the data says:");
  lines.push("• Trend: price holding above EMA20");
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
    // SQ-FRIENDLY: no internal score breakdown in FACTS — the LLM copies what
    // it is given, and readers cannot interpret our 0-100 component scores.
    // Market-facing inputs (EMA distance, RSI, funding, OI, breadth) already
    // cover the same information in universally understood terms.
    if (m.coinsTotal > 0) lines.push(`Narrative breadth: ${m.coinsUp} of ${m.coinsTotal} coins improving`);
    // SQ-DIR: signs follow the PRICE move, not P&L — for a short, price falls
    // to TP (-%) and rises into the stop (+%). Keeps the LLM from framing a
    // short's targets as upside.
    if (m.riskRewardRatio != null) {
      lines.push(
        brief.direction === "SHORT"
          ? `Risk/reward: ${m.riskRewardRatio.toFixed(1)}:1, TP1 move -${m.tp1GainPct?.toFixed(0)}% (short target), stop move +${m.slRiskPct?.toFixed(0)}%`
          : `Risk/reward: ${m.riskRewardRatio.toFixed(1)}:1, TP1 gain +${m.tp1GainPct?.toFixed(0)}%, SL risk -${m.slRiskPct?.toFixed(0)}%`
      );
    }
  }

  const setupEntry = brief.leaderCoinEntry ?? brief.entry;
  const setupTps = brief.leaderCoinTakeProfits ?? brief.takeProfits;
  const setupSl = brief.leaderCoinStopLoss ?? brief.stopLoss;

  if (setupEntry) {
    lines.push(`Entry zone: ${setupEntry.low} – ${setupEntry.high}`);
  }
  if (setupTps) {
    // SQ-TP-ORDER: present targets nearest-first for both directions (TP1
    // near, TP2 far — shorts hit them in descending price order); also
    // repairs legacy swapped rows.
    const orderedTps = orderTpsForDisplay(setupTps, brief.direction ?? "LONG");
    lines.push(`Take profits: ${orderedTps.slice(0, 3).map((tp) => `${tp.label ? tp.label + " " : ""}${tp.level}`).join(", ")}`);
  }
  if (setupSl) {
    lines.push(`Stop loss: ${setupSl.level}`);
  }

  // SQ-DIR: geometry note so the model describes the mirrored levels correctly.
  if (brief.direction === "SHORT" && setupEntry) {
    lines.push("(SHORT geometry: the entry zone sits ABOVE the current price — rallies into it get sold; targets are BELOW price, stop above the zone. Present every level exactly as given, never as a dip-buy.)");
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

  if (brief.chartCta) {
    lines.push("");
    lines.push(`CHART POINTER (include verbatim on its own line): ${brief.chartCta}`);
  }

  lines.push("");
  lines.push("Write the post now. Output only the post text, nothing else.");

  return lines.join("\n");
}

function validateLLMOutput(text: string, brief: SquareContentBrief): string | null {
  if (!text || text.length < 20) return null;
  if (text.length > MAX_TEXT_LENGTH) return null;

  const upper = text.toUpperCase();
  // SQ-DIR: only trading-command language is forbidden. LONG/SHORT are now
  // REQUIRED vocabulary (the Direction line), so they must NOT be rejected —
  // the old regex treated any standalone LONG/SHORT as a violation and pushed
  // every direction-explicit post into the repair loop or the template.
  const forbidden = /\b(BUY|SELL|ORDER|EXECUTE)\b/;
  if (forbidden.test(upper)) return null;

  // SQ-FRIENDLY: the post must never expose internal scoring jargon — readers
  // have no idea how our engine scores anything, so "points"/"health engine"
  // language reads as meaningless system-speak. Reject and let the template
  // (which never uses it) take over.
  const internalJargon = /\b(HEALTH ENGINE|NARRATIVE HEALTH ENGINE|POINTS)\b|\b\d+(\.\d+)?\s+POINTS\b/i;
  if (internalJargon.test(text)) return null;

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

  // SQ-DIR: the direction line is the FIRST thing readers see — the single
  // biggest fix for "unclear whether this is a buy or sell post". Composed
  // from derived direction, momentum read, and actual level geometry so it
  // can never contradict the setup that follows.
  const direction = brief.direction ?? "LONG";
  const isShort = direction === "SHORT";
  const dirLine = isShort
    ? "📍 Direction: SHORT setup (futures) — strength is fading; short into the entry zone above, targets below."
    : "📍 Direction: LONG setup (futures) — momentum + structure favor upside; levels below define the accumulation zone.";

  // 1. Hook (rotating, metric-driven) — SQ-RICH-CONTENT: append a second and
  // third analytic sentence derived from real metrics so even the deterministic
  // fallback meets the 3-sentence minimum (never pad — each adds information).
  lines.push(brief.hookLine ?? brief.text.split("\n")[0]);
  const hookExtra: string[] = [];
  if (m && isShort) {
    if (m.rsi14 != null && m.rsi14 >= 70) {
      hookExtra.push("RSI that stretched into overbought while price stalls is the classic exhaustion pattern — the crowd is positioned, the fuel is thinning.");
    } else if (m.coinsTotal > 0) {
      hookExtra.push(`With only ${m.coinsUp} of ${m.coinsTotal} coins in the group still improving, the collective trend has lost its engine — individual bounces become harder to trust.`);
    }
    if (m.priceVsEma20Pct != null) {
      hookExtra.push(
        m.priceVsEma20Pct >= 0
          ? `Price still sits ${m.priceVsEma20Pct.toFixed(1)}% above its 20-day average — that cushion is exactly what a fading structure eats first.`
          : `Price already sits ${Math.abs(m.priceVsEma20Pct).toFixed(1)}% below its 20-day average — rallies back toward it are the textbook zone sellers wait for.`
      );
    }
  } else if (m) {
    if (m.coinsUp > 0 && m.coinsTotal > 0) {
      hookExtra.push(`${m.coinsUp} of ${m.coinsTotal} coins in the group moving together is the signature of genuine rotation — broad participation, not a single-coin pop.`);
    }
    if (m.priceVsEma20Pct != null) {
      hookExtra.push(
        m.priceVsEma20Pct >= 0
          ? `Price holding ${m.priceVsEma20Pct.toFixed(1)}% above its 20-day average keeps the structure constructive — dips into that average are where buyers have defended before.`
          : `Reclaiming the 20-day average (price currently ${Math.abs(m.priceVsEma20Pct).toFixed(1)}% below it) is the first confirmation this setup needs.`
      );
    }
  }
  for (const extra of hookExtra.slice(0, 2)) {
    lines.push(extra);
  }
  lines.push("");
  lines.push(dirLine);
  lines.push("");

  // 2. Price + setup with R:R
  if (m && leaderEntry && leaderSl) {
    lines.push(`Price: $${fmtPrice(m.currentPrice)}`);
    lines.push(`Entry: ${fmtPrice(leaderEntry.low)} – ${fmtPrice(leaderEntry.high)}`);
    if (leaderTps && leaderTps.length > 0) {
      // SQ-TP-ORDER: render targets nearest-first for both directions; also
      // repairs legacy opportunities whose stored TP1/TP2 were swapped.
      const orderedTps = orderTpsForDisplay(leaderTps, direction);
      const tpStr = orderedTps
        .slice(0, 2)
        .map((tp) => {
          // SQ-DIR: % is the price move to the level — down for a short's targets.
          const sign = isShort ? "-" : "+";
          const pct = m.tp1GainPct != null && tp === orderedTps[0] ? ` (${sign}${m.tp1GainPct.toFixed(0)}%)` : "";
          return `${fmtPrice(tp.level)}${pct}`;
        })
        .join(" → ");
      lines.push(`Targets: ${tpStr}`);
    }
    lines.push(`Stop: ${fmtPrice(leaderSl.level)}${m.slRiskPct != null ? ` (${isShort ? "+" : "-"}${m.slRiskPct.toFixed(0)}%)` : ""}`);
    if (m.riskRewardRatio != null) {
      lines.push(`Risk/reward: ${m.riskRewardRatio.toFixed(1)} : 1`);
    }
    if (brief.priceMap) {
      lines.push("");
      lines.push(brief.priceMap);
    }
    lines.push("");
  }

  // 3. Data reads — each metric gets one dense line with a number.
  // SQ-DIR: interpretations flip with the direction — a 100/100 trend under a
  // SHORT call reads as fading extension, not "structural uptrend intact".
  if (m) {
    lines.push("What the data says:");
    if (m.trendScore >= 65) {
      const emaNote =
        m.priceVsEma20Pct == null
          ? " — trend reading unavailable"
          : m.priceVsEma20Pct >= 0
            ? " — price holding above EMA20"
            : " — price below EMA20";
      lines.push(
        `• Trend${emaNote}${isShort ? " — extended, strength fading" : ""}`
      );
    }
    if (m.rsi14 != null) {
      const rsiRead =
        m.rsi14 >= 70
          ? "overbought territory"
          : m.rsi14 <= 30
            ? "oversold territory"
            : isShort
              ? "no washout yet — room to fade"
              : "momentum building, not extreme";
      lines.push(`• RSI ${m.rsi14.toFixed(0)} — ${rsiRead}`);
    }
    if (m.fundingRate != null) {
      const fr = m.fundingRate;
      const frRead =
        fr > 0.01
          ? isShort
            ? "longs crowded — fuel for the fade"
            : "longs crowded"
          : fr > 0
            ? isShort
              ? "longs confident — crowded side"
              : "longs confident, not crowded"
            : isShort
              ? "shorts paying — thin, late shorting"
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
    if (m.coinsTotal > 0) {
      lines.push(
        isShort
          ? `• Breadth: only ${m.coinsUp} of ${m.coinsTotal} coins improving — rotation stalling`
          : m.coinsUp > 0
            ? `• Breadth: ${m.coinsUp} of ${m.coinsTotal} coins moving up together — rotation, not a single-coin pump`
            : `• Breadth: 0 of ${m.coinsTotal} coins improving`
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

  // 6. WHY NOW + INVALIDATION (SQ-RICH-CONTENT: explicit labeled lines so the
  // deterministic fallback carries the same structure the LLM is asked for)
  if (brief.whyNowFacts && brief.whyNowFacts.length > 0) {
    lines.push(`WHY NOW: ${brief.whyNowFacts[0]}`);
    lines.push("");
  }
  if (brief.invalidation) {
    lines.push(`INVALIDATION: ${brief.invalidation.replace(/^(Setup invalidates if|Narrative thesis weakens if) /i, "")}`);
    lines.push("");
  }

  // SQ-CHART-CTA: every post tells readers where the chart lives (Binance
  // does not auto-embed a chart from the OpenAPI text endpoint).
  const primaryTag =
    brief.leadingCoinSymbols?.[0] ??
    (brief.cashtags[0]?.startsWith("$") ? brief.cashtags[0].slice(1) : brief.cashtags[0]);
  const chartCta = brief.chartCta ?? (primaryTag ? buildChartCtaFromEngine(primaryTag) : null);
  if (chartCta) {
    lines.push(chartCta);
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
