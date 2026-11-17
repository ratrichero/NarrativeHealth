// LLM-BUDGET-01 — per-key token budget.
//
// Free tiers (Google AI Studio, Groq OTPM, tokenharbor free) fail with 429 once
// the per-minute token budget is spent. Reacting after the 429 costs a wasted
// round-trip and pollutes the monitor, so chat/Square report the `usage` they
// receive and the chain skips a key that is close to its window limit.

const WINDOW_MS = 60_000;
const DEFAULT_TOKENS_PER_MIN = 12_000;

interface Window {
  startedAt: number;
  tokens: number;
}

const windows = new Map<string, Window>();

/** Never key the map by the raw secret — a short hash is enough for stats. */
export function keyIdentity(apiKey: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < apiKey.length; i++) {
    hash ^= apiKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${apiKey.slice(-4)}`;
}

function limit(): number {
  const raw = Number(process.env.LLM_KEY_TOKENS_PER_MIN);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOKENS_PER_MIN;
}

export function recordTokenUsage(apiKey: string, tokens: number): void {
  if (!tokens || tokens <= 0) return;
  const id = keyIdentity(apiKey);
  const now = Date.now();
  const current = windows.get(id);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    windows.set(id, { startedAt: now, tokens });
    return;
  }
  current.tokens += tokens;
}

export function keyOverBudget(apiKey: string, reserveTokens = 0): boolean {
  const current = windows.get(keyIdentity(apiKey));
  if (!current) return false;
  if (Date.now() - current.startedAt >= WINDOW_MS) return false;
  return current.tokens + reserveTokens >= limit();
}

export function budgetStats(): {
  limitPerMinute: number;
  keys: { id: string; tokens: number; limit: number; usedPct: number }[];
} {
  const now = Date.now();
  return {
    limitPerMinute: limit(),
    keys: [...windows.entries()]
      .filter(([, w]) => now - w.startedAt < WINDOW_MS)
      .map(([id, w]) => ({
        id,
        tokens: w.tokens,
        limit: limit(),
        usedPct: Math.min(100, Math.round((w.tokens / limit()) * 100)),
      })),
  };
}

/** Test-only. */
export function _resetLlmBudget(): void {
  windows.clear();
}
