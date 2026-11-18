// CHAT-QUOTA-01 — per-session daily budget with graceful degradation.
//
// The only cost control on public chat was 20 messages/minute per fingerprint.
// A single session could therefore run hundreds of tool-heavy turns a day, and
// every turn can cost four provider attempts. This adds a rolling DAILY budget
// per session:
//
//  - soft (>= CHAT_QUOTA_SOFT_PCT of either budget): shorter answers, tools off;
//  - hard (turns or tokens exhausted): the turn is refused with a clear message
//    before any provider is called.
//
// Counters are in-memory (a chat session is ephemeral and single-instance), so
// there is no DB write on the hot path and no migration. Tokens are estimated
// from the messages actually sent plus the answer, which is the same measure
// the context trimmer uses.

const DAY_MS = 86_400_000;

export type QuotaState = "ok" | "soft" | "hard";

interface DayUsage {
  day: string;
  turns: number;
  tokens: number;
  toolCalls: number;
}

const usage = new Map<string, DayUsage>();

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function chatQuotaLimits(): { turnsPerDay: number; tokensPerDay: number; softPct: number } {
  return {
    turnsPerDay: numberEnv("CHAT_TURNS_PER_DAY", 80),
    tokensPerDay: numberEnv("CHAT_TOKENS_PER_DAY", 150_000),
    softPct: Math.min(100, Math.max(1, numberEnv("CHAT_QUOTA_SOFT_PCT", 80))),
  };
}

function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function current(sessionId: string, now = Date.now()): DayUsage {
  const key = dayKey(now);
  const existing = usage.get(sessionId);
  if (existing && existing.day === key) return existing;
  const fresh: DayUsage = { day: key, turns: 0, tokens: 0, toolCalls: 0 };
  usage.set(sessionId, fresh);
  return fresh;
}

export interface ChatQuota {
  state: QuotaState;
  reason?: string;
  /** Output cap for this turn when soft (undefined → normal cap). */
  maxTokens?: number;
  /** False in soft mode: the turn must answer from context/cache only. */
  toolsAllowed: boolean;
  turns: number;
  tokens: number;
  limits: { turnsPerDay: number; tokensPerDay: number };
}

export function chatQuotaFor(sessionId: string, now = Date.now()): ChatQuota {
  const limits = chatQuotaLimits();
  const day = current(sessionId, now);
  const turnPct = (day.turns / limits.turnsPerDay) * 100;
  const tokenPct = (day.tokens / limits.tokensPerDay) * 100;

  if (day.turns >= limits.turnsPerDay || day.tokens >= limits.tokensPerDay) {
    return {
      state: "hard",
      reason: `phiên chat đã dùng hết hạn mức hôm nay (${day.turns}/${limits.turnsPerDay} lượt, ${Math.round(day.tokens / 1000)}k/${Math.round(limits.tokensPerDay / 1000)}k token)`,
      toolsAllowed: false,
      turns: day.turns,
      tokens: day.tokens,
      limits,
    };
  }

  if (turnPct >= limits.softPct || tokenPct >= limits.softPct) {
    return {
      state: "soft",
      reason: `gần hạn mức ngày (${Math.round(Math.max(turnPct, tokenPct))}%)`,
      maxTokens: 400,
      toolsAllowed: false,
      turns: day.turns,
      tokens: day.tokens,
      limits,
    };
  }

  return {
    state: "ok",
    toolsAllowed: true,
    turns: day.turns,
    tokens: day.tokens,
    limits,
  };
}

export function recordChatQuota(
  sessionId: string,
  input: { tokens?: number; toolCalls?: number; at?: number }
): void {
  const day = current(sessionId, input.at ?? Date.now());
  day.turns += 1;
  day.tokens += Math.max(0, Math.round(input.tokens ?? 0));
  day.toolCalls += Math.max(0, input.toolCalls ?? 0);
}

/** Test-only. */
export function _resetChatQuota(): void {
  usage.clear();
}

export const CHAT_QUOTA_DAY_MS = DAY_MS;
