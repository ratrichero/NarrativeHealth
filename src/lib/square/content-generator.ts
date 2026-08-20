// Square Content Generator
// LLM + deterministic template fallback for Binance Square posts

import type { SquareContentBrief } from "./opportunity-engine";

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
  maxTextLength: 2000,
  includeDisclaimer: true,
  useLLM: true,
};

// ─── Template Version ──────────────────────────────────

const TEMPLATE_VERSION = "1.0.0";

// ─── LLM Integration ───────────────────────────────────

/**
 * Generate content using Google LLM API.
 * Returns null if LLM is unavailable or returns invalid content.
 */
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
            maxOutputTokens: 1024,
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!generatedText || typeof generatedText !== "string") return null;

    const validated = validateLLMOutput(generatedText, brief.cashtags);
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
  lines.push("- Include coin cashtags (e.g. $BTC)");
  lines.push("- Keep it under 500 characters");
  lines.push("- Add a brief disclaimer at the end");
  lines.push("");
  lines.push("FACTS:");

  if (brief.cashtags.length > 0) {
    lines.push(`Coins: ${brief.cashtags.join(" ")}`);
  }

  // Chart coin is metadata for the LLM — it must appear in the post
  if (brief.chartCoin) {
    lines.push(`Chart coin: $${brief.chartCoin}`);
  }

  // Extract facts from the brief text
  const facts = brief.text
    .split("\n")
    .filter((l) => l.startsWith("• ") || l.startsWith("Entry:") || l.startsWith("TP:") || l.startsWith("SL:"));
  for (const fact of facts) {
    lines.push(fact);
  }

  lines.push("");
  lines.push("Write the post now:");

  return lines.join("\n");
}

function validateLLMOutput(text: string, expectedCashtags?: string[]): string | null {
  if (!text || text.length < 20) return null;
  if (text.length > 2000) return null;

  // Must not contain forbidden terms
  const upper = text.toUpperCase();
  const forbidden = ["BUY", "SELL", "LONG", "SHORT", "ORDER", "EXECUTE"];
  for (const term of forbidden) {
    if (upper.includes(term)) return null;
  }

  // If expected cashtags provided, validate they appear in output
  if (expectedCashtags && expectedCashtags.length > 0) {
    for (const tag of expectedCashtags) {
      if (!text.includes(tag)) {
        // LLM dropped a cashtag — reject and fall back to template
        return null;
      }
    }
  }

  return text;
}

// ─── Template Fallback ─────────────────────────────────

/**
 * Generate content using the brief's pre-built text.
 * Always available — no external dependencies.
 */
function generateFromBrief(
  brief: SquareContentBrief,
  config: ContentGenerationConfig
): GeneratedContent {
  let text = brief.text;

  // Trim to max length
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

/**
 * Generate content for a Square post.
 * Tries LLM first (if enabled), falls back to brief text.
 */
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
