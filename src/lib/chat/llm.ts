// CHAT-P1: LLM client for the chatbot — OpenAI-compatible provider chain
// (same env vars as Square, ordered google → Groq → fallback1 → fallback2)
// with native tool calling and SSE streaming support. The google tier is a
// multi-key pool (GKEY-01) shared with the Square chain.

import { reportGoogleKeyOutcome, GOOGLE_POOL_BASE_URL } from "@/lib/llm/google-key-pool";
import { keyHint, resolveProviderChain, type LlmProvider } from "@/lib/llm/provider-chain";
import { normalizeToolArguments } from "./tool-call-accum";
import { recordLlmOutcome } from "@/lib/llm/monitor";
import {
  llmMaxHttpAttempts,
  llmRequestTimeoutMs,
  llmTemperature,
  retryDelayMs,
  sleep,
} from "@/lib/llm/config";

// CHAT-LLM-BUDGET: the chat output cap stays at/below the smallest provider
// OTPM. Groq's qwen tier enforces 1000 output tokens/minute and rejects a
// request whose max_tokens exceeds it with an instant HTTP 429 before any
// generation happens (same limit documented in square/content-generator.ts).
// Callers may ask for less, never for more.
const MAX_CHAT_OUTPUT_TOKENS = 900;

// CHAT-LLM-RETRY: 429 (rate limit) and 503 ("high demand") are transient, so
// they are retried with backoff before the tier is dropped. Attempt count,
// timeout and temperature come from @/lib/llm/config (LLM_* env vars).

function chatOutputTokenBudget(requested?: number): number {
  return Math.min(requested ?? MAX_CHAT_OUTPUT_TOKENS, MAX_CHAT_OUTPUT_TOKENS);
}

/**
 * Per-provider view of the conversation. A replayed assistant tool call needs
 * valid JSON arguments for every provider, plus Gemini's thought_signature for
 * Google — while other providers reject the unknown `extra_content` field.
 */
function messagesForProvider(
  provider: ChatLLMProvider,
  messages: ChatMessage[]
): ChatMessage[] {
  const keepExtras = provider.baseUrl === GOOGLE_POOL_BASE_URL;
  return messages.map((message) => {
    if (!message.tool_calls?.length) return message;
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => {
        const base = {
          id: call.id,
          type: "function" as const,
          function: {
            name: call.function.name,
            arguments: normalizeToolArguments(call.function.arguments).json,
          },
        };
        return keepExtras && call.extra_content ? { ...base, extra_content: call.extra_content } : base;
      }),
    };
  });
}

/** One request body shape for both the buffered and the streaming call. */
function buildChatBody(
  provider: ChatLLMProvider,
  opts: LLMCompletionOptions,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    model: provider.model,
    messages: messagesForProvider(provider, opts.messages),
    ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools, tool_choice: "auto" } : {}),
    temperature: llmTemperature(opts.temperature ?? provider.temperature ?? 0.4),
    max_tokens: chatOutputTokenBudget(opts.maxTokens ?? provider.maxTokens),
    ...extra,
  };
}

export type ChatLLMProvider = LlmProvider;

/**
 * POST /chat/completions with retry for transient statuses. Throws on transport
 * errors (timeout, DNS, connection reset) — callers treat that as tier failure.
 */
async function postChatCompletion(
  provider: ChatLLMProvider,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<Response> {
  const maxAttempts = llmMaxHttpAttempts();
  let response: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        ...(provider.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) return response;
    if ((response.status !== 429 && response.status !== 503) || attempt === maxAttempts) {
      return response;
    }
    await sleep(retryDelayMs(response, attempt));
  }
  return response as Response;
}

/** Kept as a named export for the chat chain callers/tests. */
export const resolveChatProviderChain = resolveProviderChain;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    /** Provider metadata replayed verbatim (Gemini thought_signature). */
    extra_content?: unknown;
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
  const chain = await resolveChatProviderChain();
  if (chain.length === 0) return null;

  for (const provider of chain) {
    const startedAt = Date.now();
    try {
      const response = await postChatCompletion(
        provider,
        buildChatBody(provider, opts),
        opts.timeoutMs ?? provider.timeoutMs ?? llmRequestTimeoutMs(30_000)
      );

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        console.warn(`[CHAT-LLM] ${provider.name} (${provider.model}) HTTP ${response.status}: ${errBody.slice(0, 200)}`);
        if (provider.baseUrl === GOOGLE_POOL_BASE_URL) {
          reportGoogleKeyOutcome(provider.apiKey, false, response.status);
        }
        recordLlmOutcome({
          provider: provider.name,
          model: provider.model,
          source: "chat",
          ok: false,
          status: response.status,
          durationMs: Date.now() - startedAt,
          keyHint: keyHint(provider.apiKey),
          error: `HTTP ${response.status}: ${errBody.slice(0, 120)}`,
        });
        continue; // next provider
      }

      const data = await response.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) {
        console.warn(`[CHAT-LLM] ${provider.name}: empty message`);
        continue;
      }
      if (provider.baseUrl === GOOGLE_POOL_BASE_URL) {
        reportGoogleKeyOutcome(provider.apiKey, true, response.status);
      }
      recordLlmOutcome({
        provider: provider.name,
        model: provider.model,
        source: "chat",
        ok: true,
        status: response.status,
        durationMs: Date.now() - startedAt,
        keyHint: keyHint(provider.apiKey),
      });
      return { provider: provider.name, message: msg as ChatMessage };
    } catch (e) {
      console.warn(`[CHAT-LLM] ${provider.name} failed: ${String(e).slice(0, 150)}`);
      if (provider.baseUrl === GOOGLE_POOL_BASE_URL) {
        reportGoogleKeyOutcome(provider.apiKey, false, undefined);
      }
      recordLlmOutcome({
        provider: provider.name,
        model: provider.model,
        source: "chat",
        ok: false,
        status: 0,
        durationMs: Date.now() - startedAt,
        keyHint: keyHint(provider.apiKey),
        error: String(e).slice(0, 200),
      });
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
    onToolCallDelta: (
      fragments: { index?: number; id?: string; name?: string; argsDelta: string; extraContent?: unknown }[]
    ) => void;
    /** Called when a provider died mid-stream after emitting deltas. */
    onReset?: () => void;
  }
): Promise<{ provider: string } | null> {
  const chain = await resolveChatProviderChain();
  if (chain.length === 0) return null;

  for (const provider of chain) {
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await postChatCompletion(
        provider,
        buildChatBody(provider, opts, { stream: true }),
        // LLM_REQUEST_TIMEOUT is a per-request budget; a streamed answer can
        // legitimately take longer, so the stream keeps a 60s floor.
        opts.timeoutMs ?? provider.timeoutMs ?? Math.max(llmRequestTimeoutMs(60_000), 60_000)
      );
    } catch (e) {
      console.warn(`[CHAT-LLM] ${provider.name} stream failed: ${String(e).slice(0, 150)}`);
      if (provider.baseUrl === GOOGLE_POOL_BASE_URL) {
        reportGoogleKeyOutcome(provider.apiKey, false, undefined);
      }
      recordLlmOutcome({
        provider: provider.name,
        model: provider.model,
        source: "chat",
        ok: false,
        status: 0,
        durationMs: Date.now() - startedAt,
        keyHint: keyHint(provider.apiKey),
        error: String(e).slice(0, 200),
      });
      continue;
    }

    if (!response.ok || !response.body) {
      const errBody = await response.text().catch(() => "");
      console.warn(`[CHAT-LLM] ${provider.name} stream HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      if (provider.baseUrl === GOOGLE_POOL_BASE_URL) {
        reportGoogleKeyOutcome(provider.apiKey, false, response.status);
      }
      recordLlmOutcome({
        provider: provider.name,
        model: provider.model,
        source: "chat",
        ok: false,
        status: response.status,
        durationMs: Date.now() - startedAt,
        keyHint: keyHint(provider.apiKey),
        error: `stream HTTP ${response.status}: ${errBody.slice(0, 120)}`,
      });
      continue;
    }

    // SQ-CHAT-RESET: tracks whether this provider already pushed deltas to the
    // client. A failure after that point must trigger onReset, otherwise the
    // next provider's answer is appended to the dead provider's partial text.
    let emitted = false;

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
              emitted = true;
              handlers.onContentDelta(delta.content);
            }
            if (Array.isArray(delta.tool_calls)) {
              emitted = true;
              handlers.onToolCallDelta(
                delta.tool_calls.map(
                  (tc: {
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                    extra_content?: unknown;
                  }) => ({
                    index: tc.index,
                    id: tc.id,
                    name: tc.function?.name,
                    argsDelta: tc.function?.arguments ?? "",
                    extraContent: tc.extra_content,
                  })
                )
              );
            }
          } catch {
            // ignore malformed chunk lines
          }
        }
      }
      // CHAT-LLM-MONITOR: streaming used to return without reporting anything,
      // so the pool never cleared a cooldown after a successful stream and the
      // admin LLM Monitor saw the chat tier as all-fail.
      if (provider.baseUrl === GOOGLE_POOL_BASE_URL) {
        reportGoogleKeyOutcome(provider.apiKey, true, response.status);
      }
      recordLlmOutcome({
        provider: provider.name,
        model: provider.model,
        source: "chat",
        ok: true,
        status: response.status,
        durationMs: Date.now() - startedAt,
        keyHint: keyHint(provider.apiKey),
      });
      return { provider: provider.name };
    } catch (e) {
      console.warn(`[CHAT-LLM] ${provider.name} stream read failed: ${String(e).slice(0, 150)}`);
      if (provider.baseUrl === GOOGLE_POOL_BASE_URL) {
        reportGoogleKeyOutcome(provider.apiKey, false, undefined);
      }
      recordLlmOutcome({
        provider: provider.name,
        model: provider.model,
        source: "chat",
        ok: false,
        status: 0,
        durationMs: Date.now() - startedAt,
        keyHint: keyHint(provider.apiKey),
        error: String(e).slice(0, 200),
      });
      // Partial output was already forwarded — drop it before falling through.
      if (emitted) handlers.onReset?.();
      continue;
    }
  }
  return null;
}
