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

// ─── LLM Integration ───────────────────────────────────

async function generateWithLLM(
  brief: SquareContentBrief
): Promise<GeneratedContent | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const prompt = buildLLMPrompt(brief);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: MAX_LLM_OUTPUT_TOKENS,
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText || typeof generatedText !== "string") return null;

    const validated = validateLLMOutput(generatedText, brief);
    if (!validated) return null;

    return {
      text: validated,
      llmUsed: true,
      templateVersion: TEMPLATE_VERSION,
    };
  } catch (error) {
    console.error("LLM generation failed:", error);
    return null;
  }
}

function buildLLMPrompt(brief: SquareContentBrief): string {
  const lines: string[] = [];

  lines.push("Write a concise Binance Square post about a crypto setup.");
  lines.push("");
  lines.push("RULES:");
  lines.push("- Use ONLY the facts provided below");
  lines.push("- Do NOT invent any price, volume, trend, or data");
  lines.push("- Do NOT change Entry/TP/SL levels");
  lines.push("- Do NOT add or remove coin cashtags");
  lines.push("- Do NOT change the invalidation condition");
  lines.push("- Keep it under 800 characters");
  lines.push("- Add a brief disclaimer at the end");
  lines.push("");
  lines.push("REQUIRED SECTIONS:");
  lines.push("1. Headline with coin cashtag");
  lines.push("2. WHY NOW section (if facts provided)");
  lines.push("3. Key facts bullet points");
  if (brief.leadingCoinSymbols && brief.leadingCoinSymbols.length > 0) {
    lines.push("4. Leading coins section with rationale");
  }
  if (brief.entry || brief.leaderCoinEntry) {
    lines.push("5. Setup section with Entry/TP/SL");
  }
  if (brief.invalidation) {
    lines.push("6. INVALIDATION section");
  }
  lines.push("");
  lines.push("FACTS:");

  if (brief.cashtags.length > 0) {
    lines.push(`Coins: ${brief.cashtags.join(" ")}`);
  }

  if (brief.chartCoin) {
    lines.push(`Chart coin: $${brief.chartCoin}`);
  }

  if (brief.leadingCoinSymbols && brief.leadingCoinSymbols.length > 0) {
    lines.push(`Leading coins: ${brief.leadingCoinSymbols.map(s => `$${s}`).join(" ")}`);
  }

  if (brief.leadingCoinRationales && brief.leadingCoinRationales.length > 0) {
    lines.push("");
    lines.push("LEADING COIN RATIONALES:");
    for (let i = 0; i < brief.leadingCoinSymbols!.length; i++) {
      lines.push(`$${brief.leadingCoinSymbols![i]} — ${brief.leadingCoinRationales![i]}`);
    }
  }

  if (brief.whyNowFacts && brief.whyNowFacts.length > 0) {
    lines.push("");
    lines.push("WHY NOW:");
    for (const fact of brief.whyNowFacts) {
      lines.push(`• ${fact}`);
    }
  }

  const facts = brief.text
    .split("\n")
    .filter((l) => l.startsWith("• ") || l.startsWith("Entry:") || l.startsWith("TP:") || l.startsWith("SL:") || l.startsWith("INVALIDATION") || l.startsWith("📍"));
  for (const fact of facts) {
    lines.push(fact);
  }

  lines.push("");
  lines.push("Write the post now:");

  return lines.join("\n");
}

function validateLLMOutput(text: string, brief: SquareContentBrief): string | null {
  if (!text || text.length < 20) return null;
  if (text.length > MAX_TEXT_LENGTH) return null;

  const upper = text.toUpperCase();
  const forbidden = ["BUY", "SELL", "LONG", "SHORT", "ORDER", "EXECUTE"];
  for (const term of forbidden) {
    if (upper.includes(term)) return null;
  }

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

// ─── Template Fallback ─────────────────────────────────

function generateFromBrief(
  brief: SquareContentBrief,
  config: ContentGenerationConfig
): GeneratedContent {
  let text = brief.text;

  if (text.length > config.maxTextLength) {
    text = text.slice(0, config.maxTextLength - 3) + "...";
  }

  return {
    text,
    title: brief.title,
    llmUsed: false,
    templateVersion: TEMPLATE_VERSION,
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
