// LLM-CACHE-01 — short-lived answer cache for data questions.
//
// Public chat repeats the same handful of questions ("giá BTC bây giờ?"). A
// 45-second cache of tool-backed answers saves a full LLM turn (plus tool calls)
// for those repeats. Only data questions are cached; anything personal,
// session-specific or about the conversation itself is not.
//
// LLM-OPS-02: entries are keyed by SESSION + question. A global question key
// meant a cached answer could be replayed into a different session (and a
// different user's conversation), which is both a privacy leak and a
// correctness bug once a session has extra context. Cross-session reuse is
// therefore impossible by construction.

const TTL_MS = 45_000;
const MAX_ENTRIES = 200;

interface Entry {
  at: number;
  text: string;
  provider: string;
}

const cache = new Map<string, Entry>();

const DATA_QUESTION =
  /(giá|price|funding|oi|open interest|health|sức khoẻ|narrative|top|so sánh|compare|klines|nến|chart|volume|rsi|ema|long\/short)/i;
const NOT_CACHEABLE =
  /(của tôi|my |tôi đã|nhớ|remember|vừa nói|above|trước đó|lịch sử chat|hãy đọc|ignore|bỏ qua)/i;

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.]+$/g, "")
    .trim();
}

export function isCacheableQuestion(text: string): boolean {
  return DATA_QUESTION.test(text) && !NOT_CACHEABLE.test(text);
}

function cacheKey(sessionId: string, question: string): string {
  return `${sessionId}\u0000${normalizeQuestion(question)}`;
}

export function getCachedAnswer(
  sessionId: string,
  question: string
): { text: string; provider: string; ageMs: number } | null {
  if (!isCacheableQuestion(question)) return null;
  const key = cacheKey(sessionId, question);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { text: entry.text, provider: entry.provider, ageMs: Date.now() - entry.at };
}

export function setCachedAnswer(
  sessionId: string,
  question: string,
  text: string,
  provider: string
): void {
  if (!isCacheableQuestion(question)) return;
  if (text.trim().length === 0) return;
  // A data answer carries numbers; an apology/refusal must never be replayed.
  if (!/\d/.test(text)) return;
  const key = cacheKey(sessionId, question);
  cache.set(key, { at: Date.now(), text, provider });
  if (cache.size > MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/** Test-only. */
export function _resetAnswerCache(): void {
  cache.clear();
}
