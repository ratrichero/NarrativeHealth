// LLM-01 — LLM provider health monitoring, shared by the Square content chain
// and the chatbot chain (src/lib/chat/llm.ts).
//
// Every HTTP attempt against a provider tier reports an outcome here; the
// admin endpoint /api/admin/llm/status and the admin UI "LLM Monitor" tab
// read the snapshot plus the recent publication history from square_publications.
//
// In-memory ring buffer: survives for the life of the server process, no DB
// writes on the hot path, bounded memory. DB-side stats (llm vs template per
// day) remain the long-term record; this buffer covers live diagnostics.

export const LLM_OUTCOME_BUFFER_SIZE = 100;

export interface LlmCallOutcome {
  /** ISO timestamp of the attempt. */
  at: string;
  /** Tier identity: google | primary | fallback1 | fallback2. */
  provider: string;
  /** Model id as configured for that tier. */
  model: string;
  /** Which consumer made the call: square | chat. */
  source: "square" | "chat";
  ok: boolean;
  /** HTTP status, or 0 for transport errors (timeout, DNS, unreachable). */
  status: number;
  /** Attempt duration in ms. */
  durationMs: number;
  /** Masked key hint so pooled keys are distinguishable without leaking. */
  keyHint?: string;
  /** Short error text for failures (truncated). */
  error?: string;
}

const buffer: LlmCallOutcome[] = [];
let dropped = 0;

function maskKey(key?: string): string | undefined {
  if (!key) return undefined;
  return key.length > 10 ? `…${key.slice(-4)}` : "…";
}

export function recordLlmOutcome(
  outcome: Omit<LlmCallOutcome, "at"> & { at?: string }
): void {
  buffer.push({ at: outcome.at ?? new Date().toISOString(), ...outcome });
  if (buffer.length > LLM_OUTCOME_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - LLM_OUTCOME_BUFFER_SIZE);
    dropped++;
  }
}

/** Introspection for /api/admin/llm/status and debug tooling. */
export function llmOutcomeSnapshot(): {
  bufferSize: number;
  dropped: number;
  outcomes: LlmCallOutcome[];
} {
  return {
    bufferSize: buffer.length,
    dropped,
    outcomes: [...buffer].reverse(), // newest first
  };
}

/** Per-tier aggregates over the retained window. */
export function llmTierStats(): {
  provider: string;
  calls: number;
  ok: number;
  fail: number;
  lastStatus: number | null;
  lastOkAt: string | null;
  lastFailAt: string | null;
  avgDurationMs: number | null;
}[] {
  const byProvider = new Map<
    string,
    { calls: number; ok: number; fail: number; statuses: number[]; durations: number[]; lastOkAt: string | null; lastFailAt: string | null }
  >();
  for (const o of buffer) {
    let s = byProvider.get(o.provider);
    if (!s) {
      s = { calls: 0, ok: 0, fail: 0, statuses: [], durations: [], lastOkAt: null, lastFailAt: null };
      byProvider.set(o.provider, s);
    }
    s.calls++;
    s.durations.push(o.durationMs);
    if (o.ok) {
      s.ok++;
      s.statuses.push(o.status);
      s.lastOkAt = o.at;
    } else {
      s.fail++;
      s.statuses.push(o.status);
      s.lastFailAt = o.at;
    }
  }
  return [...byProvider.entries()].map(([provider, s]) => ({
    provider,
    calls: s.calls,
    ok: s.ok,
    fail: s.fail,
    lastStatus: s.statuses.at(-1) ?? null,
    lastOkAt: s.lastOkAt,
    lastFailAt: s.lastFailAt,
    avgDurationMs:
      s.durations.length > 0
        ? Math.round(s.durations.reduce((a, b) => a + b, 0) / s.durations.length)
        : null,
  }));
}

/** Test-only: wipe all state. */
export function _resetLlmMonitor(): void {
  buffer.length = 0;
  dropped = 0;
}
