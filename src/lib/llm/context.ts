// LLM-CTX-01 — token-aware context management.
//
// HISTORY_LIMIT counted messages, not tokens. Long conversations therefore grow
// until a provider rejects the request (context length) or the bill grows with
// it. This trims by an estimated token budget, keeps the system prompt, the most
// recent turns and a short marker where older context was dropped.

export interface TrimMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
}

/** ~4 characters per token is accurate enough for budgeting. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function messagesTokens(messages: TrimMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
}

export function trimHistoryForBudget<T extends TrimMessage>(
  messages: T[],
  maxTokens = Number(process.env.LLM_CONTEXT_TOKENS) || 6000
): { messages: T[]; dropped: number; estimatedTokens: number } {
  const systems = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const kept: T[] = [];
  let total = systems.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);

  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens(rest[i].content) + 4;
    if (total + cost > maxTokens && kept.length > 0) break;
    kept.unshift(rest[i]);
    total += cost;
  }

  const dropped = rest.length - kept.length;
  const trimmed: T[] = [...systems];
  if (dropped > 0) {
    trimmed.push({
      role: "assistant",
      content: `(đã lược bớt ${dropped} tin nhắn cũ để giữ ngữ cảnh trong giới hạn token)`,
    } as T);
  }
  trimmed.push(...kept);

  return { messages: trimmed, dropped, estimatedTokens: total };
}
