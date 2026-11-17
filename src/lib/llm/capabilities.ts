// LLM-CAP-01 — model capability registry.
//
// Two of the three production 400s were capability mismatches, not outages:
// Gemini needs the thought signature, Groq's templates are strict about
// replayed tool_calls, and some models reject tool_choice outright. A small
// registry lets the chain skip a model BEFORE sending a request shape it cannot
// handle, and remembers models that answered "request_invalid" to a tool payload.

interface Capability {
  tools: boolean;
  streaming: boolean;
  jsonMode: boolean;
}

const STATIC_RULES: { pattern: RegExp; caps: Capability }[] = [
  // Gemini's OpenAI-compatible endpoint supports tools + streaming; signatures
  // are preserved by messagesForProvider (LLM-CONFIG-01).
  { pattern: /gemini/i, caps: { tools: true, streaming: true, jsonMode: true } },
  { pattern: /qwen/i, caps: { tools: true, streaming: true, jsonMode: true } },
  { pattern: /deepseek/i, caps: { tools: true, streaming: true, jsonMode: true } },
  { pattern: /gpt-4|gpt-4o|gpt-3\.5/i, caps: { tools: true, streaming: true, jsonMode: true } },
  // Free "reasoning" routers are the usual suspects for strict tool templates.
  { pattern: /:free$/i, caps: { tools: false, streaming: true, jsonMode: false } },
];

const DEFAULT_CAPS: Capability = { tools: true, streaming: true, jsonMode: true };

/** Names learned at runtime from a `request_invalid` failure on a tool payload. */
const learnedNoTools = new Set<string>();

export function modelCapabilities(model: string): Capability {
  const base = STATIC_RULES.find((rule) => rule.pattern.test(model))?.caps ?? DEFAULT_CAPS;
  if (learnedNoTools.has(model)) return { ...base, tools: false };
  return base;
}

export function modelSupportsTools(model: string): boolean {
  return modelCapabilities(model).tools;
}

/** Call when a tool-bearing request fails with `request_invalid`. */
export function learnModelRejectsTools(model: string): void {
  if (learnedNoTools.has(model)) return;
  learnedNoTools.add(model);
  console.warn(`[LLM-CAP] ${model} rejected a tool payload — excluded from tool requests`);
}

export function capabilitiesSnapshot(): {
  learned: { model: string; tools: boolean }[];
  static: { pattern: string; tools: boolean }[];
} {
  return {
    learned: [...learnedNoTools].map((model) => ({ model, tools: false })),
    static: STATIC_RULES.map((rule) => ({ pattern: String(rule.pattern), tools: rule.caps.tools })),
  };
}

/** Test-only. */
export function _resetLlmCapabilities(): void {
  learnedNoTools.clear();
}
