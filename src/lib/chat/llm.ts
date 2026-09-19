// CHAT-P1: LLM client for the chatbot — OpenAI-compatible provider chain
// (same env vars as Square: Groq → fallback1 → fallback2) with native
// tool calling and SSE streaming support.

export interface ChatLLMProvider {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function resolveChatProviderChain(): ChatLLMProvider[] {
  const chain: ChatLLMProvider[] = [];

  const primaryKey = process.env.OPENAI_API_KEY;
  if (primaryKey) {
    chain.push({
      name: "primary",
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: primaryKey,
      model: process.env.MODEL_NAME || "gpt-4o-mini",
    });
  }
  const fb1 = process.env.FALLBACK_OPENAI_API_KEY;
  if (fb1 && process.env.FALLBACK_MODEL_NAME) {
    chain.push({
      name: "fallback1",
      baseUrl: (process.env.FALLBACK_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: fb1,
      model: process.env.FALLBACK_MODEL_NAME,
    });
  }
  const fb2 = process.env.FALLBACK2_OPENAI_API_KEY;
  if (fb2 && process.env.FALLBACK2_MODEL_NAME) {
    chain.push({
      name: "fallback2",
      baseUrl: (process.env.FALLBACK2_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: fb2,
      model: process.env.FALLBACK2_MODEL_NAME,
    });
  }
  return chain;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
}

export interface LLMCompletionOptions {
  messages: ChatMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMCompletionResult {
  provider: string;
  message: ChatMessage;
}

/** Non-streaming completion with provider fallback. Returns null when all providers fail. */
export async function chatCompletion(opts: LLMCompletionOptions): Promise<LLMCompletionResult | null> {
  const chain = resolveChatProviderChain();
  if (chain.length === 0) return null;

  for (const provider of chain) {
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: opts.messages,
          ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools, tool_choice: "auto" } : {}),
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.maxTokens ?? 1200,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.warn(`[CHAT-LLM] ${provider.name} (${provider.model}) HTTP ${response.status}: ${errBody.slice(0, 200)}`);
        continue; // next provider
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) {
        console.warn(`[CHAT-LLM] ${provider.name}: empty message`);
        continue;
      }
      return { provider: provider.name, message: msg as ChatMessage };
    } catch (e) {
      console.warn(`[CHAT-LLM] ${provider.name} failed: ${String(e).slice(0, 150)}`);
      continue;
    }
  }
  return null;
}

/**
 * Streaming completion with provider fallback.
 * Streams raw SSE chunks from the provider (token deltas + tool_call deltas).
 * onToolCallDelta accumulates tool-call fragments; onContentDelta receives text.
 * Returns the provider name that succeeded, or null.
 */
export async function chatCompletionStream(
  opts: LLMCompletionOptions,
  handlers: {
    onContentDelta: (text: string) => void;
    onToolCallDelta: (fragments: { index: number; id?: string; name?: string; argsDelta: string }[]) => void;
  }
): Promise<{ provider: string } | null> {
  const chain = resolveChatProviderChain();
  if (chain.length === 0) return null;

  for (const provider of chain) {
    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: opts.messages,
          ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools, tool_choice: "auto" } : {}),
          temperature: opts.temperature ?? 0.4,
          max_tokens: opts.maxTokens ?? 1200,
          stream: true,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });
    } catch (e) {
      console.warn(`[CHAT-LLM] ${provider.name} stream failed: ${String(e).slice(0, 150)}`);
      continue;
    }

    if (!response.ok || !response.body) {
      const errBody = await response.text().catch(() => "");
      console.warn(`[CHAT-LLM] ${provider.name} stream HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      continue;
    }

    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;
            if (typeof delta.content === "string" && delta.content.length > 0) {
              handlers.onContentDelta(delta.content);
            }
            if (Array.isArray(delta.tool_calls)) {
              handlers.onToolCallDelta(
                delta.tool_calls.map((tc: { index: number; id?: string; function?: { name?: string; arguments?: string } }) => ({
                  index: tc.index,
                  id: tc.id,
                  name: tc.function?.name,
                  argsDelta: tc.function?.arguments ?? "",
                }))
              );
            }
          } catch {
            // ignore malformed chunk lines
          }
        }
      }
      return { provider: provider.name };
    } catch (e) {
      console.warn(`[CHAT-LLM] ${provider.name} stream read failed: ${String(e).slice(0, 150)}`);
      continue;
    }
  }
  return null;
}
