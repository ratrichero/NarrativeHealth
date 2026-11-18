// CHAT-P1: LLM client for the chatbot — OpenAI-compatible provider chain
// (same env vars as Square, ordered google → Groq → fallback1 → fallback2)
// with native tool calling and SSE streaming support. The google tier is a
// multi-key pool (GKEY-01) shared with the Square chain.

import { reportGoogleKeyOutcome, GOOGLE_POOL_BASE_URL } from "@/lib/llm/google-key-pool";
import { keyHint, resolveProviderChain, type LlmProvider } from "@/lib/llm/provider-chain";
import { normalizeToolArguments } from "./tool-call-accum";
import { recordLlmOutcome } from "@/lib/llm/monitor";
import {
  classifyLlmFailure,
  isProviderIndependentFailure,
  payloadFingerprint,
  type LlmFailureKind,
} from "@/lib/llm/errors";
import { recordLlmTelemetry } from "@/lib/llm/telemetry";
import { keyOverBudget, recordTokenUsage } from "@/lib/llm/budget";
import { learnModelRejectsTools, modelSupportsTools } from "@/lib/llm/capabilities";
import { noteTierFailure, noteTierSuccess } from "@/lib/llm/breaker";
import { recordLlmCost } from "@/lib/llm/cost";
import type { LlmTraceHandle } from "@/lib/llm/trace";
import {
  llmHedgeMs,
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
 * LLM-OPS-02: a request we know no provider can parse is rejected locally —
 * walking the chain would only duplicate the same failure four times.
 */
function requestShapeError(opts: LLMCompletionOptions): string | null {
  if (!Array.isArray(opts.messages) || opts.messages.length === 0) return "messages is empty";
  try {
    JSON.stringify(opts.messages);
  } catch {
    return "messages cannot be serialized to JSON";
  }
  return null;
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
 *
 * `signal` lets a hedged race abort the losing tier. Aborting a request must
 * also abort its retries, so the timeout and the external signal are combined.
 */
async function postChatCompletion(
  provider: ChatLLMProvider,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const maxAttempts = llmMaxHttpAttempts();
  let response: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        ...(provider.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
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

/**
 * LLM-ERR-01: one place that classifies a failed attempt, records durable
 * telemetry and (for request_invalid on a tool payload) stops re-sending the
 * same shape to a model that has already rejected it.
 *
 * LLM-BREAKER-01: provider-side failures also feed the persisted breaker, and
 * LLM-TRACE-01 keeps the attempt in the turn trace.
 */
function noteFailure(
  provider: ChatLLMProvider,
  input: {
    status: number;
    body: string;
    startedAt: number;
    hasTools: boolean;
    trace?: LlmTraceHandle;
    note?: string;
  }
): LlmFailureKind {
  const kind = classifyLlmFailure(input.status, input.body);
  const ms = Date.now() - input.startedAt;
  recordLlmTelemetry({
    provider: provider.name,
    source: "chat",
    ok: false,
    status: input.status,
    durationMs: ms,
    kind: input.status === 0 && /timeout|abort/i.test(input.body) ? "timeout" : kind,
  });
  noteTierFailure(
    provider.name,
    provider.apiKey,
    input.status === 0 && /timeout|abort/i.test(input.body) ? "timeout" : kind
  );
  input.trace?.step({
    tier: provider.name,
    model: provider.model,
    status: input.status,
    kind: input.status === 0 && /timeout|abort/i.test(input.body) ? "timeout" : kind,
    ms,
    note: input.note,
  });
  if (kind === "request_invalid") {
    if (input.hasTools) learnModelRejectsTools(provider.model);
    console.warn(
      `[CHAT-LLM] ${provider.name} rejected the request payload (fp ${payloadFingerprint(input.body)}, tools=${input.hasTools})`
    );
  }
  return kind;
}

function noteSuccess(
  provider: ChatLLMProvider,
  input: { status: number; startedAt: number; tokens?: number; trace?: LlmTraceHandle; note?: string }
): void {
  const tokens = Math.max(0, Math.round(input.tokens ?? 0));
  if (tokens > 0) recordTokenUsage(provider.apiKey, tokens);
  recordLlmCost({ provider: provider.name, model: provider.model, tokens });
  noteTierSuccess(provider.name, provider.apiKey);
  recordLlmTelemetry({
    provider: provider.name,
    source: "chat",
    ok: true,
    status: input.status,
    durationMs: Date.now() - input.startedAt,
    tokens,
  });
  input.trace?.step({
    tier: provider.name,
    model: provider.model,
    status: input.status,
    ms: Date.now() - input.startedAt,
    tokens,
    note: input.note,
  });
}

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
  /** LLM-PROFILE-01: which feature's tier order to use (default chat). */
  profile?: "chat" | "square" | "movers";
  /** LLM-TRACE-01: turn trace to attach provider attempts to. */
  trace?: LlmTraceHandle;
  /** LLM-HEDGE-01: overrides LLM_HEDGE_MS for this call (0 disables). */
  hedgeMs?: number;
}

export interface LLMCompletionResult {
  provider: string;
  message: ChatMessage;
}

/** Non-streaming completion with provider fallback. Returns null when all providers fail. */
export async function chatCompletion(opts: LLMCompletionOptions): Promise<LLMCompletionResult | null> {
  const shapeError = requestShapeError(opts);
  if (shapeError) {
    console.warn(`[CHAT-LLM] request rejected before the chain: ${shapeError}`);
    return null;
  }
  const chain = await resolveChatProviderChain(opts.profile ?? "chat");
  if (chain.length === 0) return null;
  const hasTools = Boolean(opts.tools && opts.tools.length > 0);

  for (const provider of chain) {
    // LLM-CAP-01: never send a tool payload to a model known to reject it.
    if (hasTools && !modelSupportsTools(provider.model)) continue;
    if (keyOverBudget(provider.apiKey, 800)) continue;

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
        const kind = noteFailure(provider, {
          status: response.status,
          body: errBody,
          startedAt,
          hasTools,
          trace: opts.trace,
        });
        // LLM-OPS-02: only a request-level fault (body not valid JSON) fails
        // the same way on every tier. Provider-shaped 400s fall through.
        if (isProviderIndependentFailure(kind, errBody)) break;
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
      noteSuccess(provider, {
        status: response.status,
        startedAt,
        tokens: Number(data.usage?.total_tokens ?? 0),
        trace: opts.trace,
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
      noteFailure(provider, { status: 0, body: String(e), startedAt, hasTools, trace: opts.trace });
      continue;
    }
  }
  return null;
}

// ─── Streaming ─────────────────────────────────────────

interface StreamHandlers {
  onContentDelta: (text: string) => void;
  onToolCallDelta: (
    fragments: { index?: number; id?: string; name?: string; argsDelta: string; extraContent?: unknown }[]
  ) => void;
  /** Called when a provider died mid-stream after emitting deltas. */
  onReset?: () => void;
}

function streamTimeoutMs(opts: LLMCompletionOptions, provider: ChatLLMProvider): number {
  // LLM_REQUEST_TIMEOUT is a per-request budget; a streamed answer can
  // legitimately take longer, so the stream keeps a 60s floor.
  return opts.timeoutMs ?? provider.timeoutMs ?? Math.max(llmRequestTimeoutMs(60_000), 60_000);
}

/** One SSE delta line → handler calls. Returns the reported total tokens. */
function handleStreamLine(
  line: string,
  emitContent: (text: string) => void,
  emitToolCalls: (fragments: Parameters<StreamHandlers["onToolCallDelta"]>[0]) => void
): number | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return null;
  try {
    const chunk = JSON.parse(payload);
    let tokens: number | null = null;
    if (typeof chunk.usage?.total_tokens === "number") tokens = chunk.usage.total_tokens;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return tokens;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      emitContent(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      emitToolCalls(
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
    return tokens;
  } catch {
    return null; // ignore malformed chunk lines
  }
}

/**
 * Sequential streaming fallback: try each tier in order. Used when hedging is
 * disabled (LLM_HEDGE_MS=0) or when the chain has a single usable tier.
 */
async function streamSequential(
  opts: LLMCompletionOptions,
  handlers: StreamHandlers,
  chain: ChatLLMProvider[]
): Promise<{ provider: string } | null> {
  const hasTools = Boolean(opts.tools && opts.tools.length > 0);

  for (const provider of chain) {
    if (hasTools && !modelSupportsTools(provider.model)) continue;
    if (keyOverBudget(provider.apiKey, 800)) continue;

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await postChatCompletion(
        provider,
        buildChatBody(provider, opts, { stream: true }),
        streamTimeoutMs(opts, provider)
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
      noteFailure(provider, { status: 0, body: String(e), startedAt, hasTools, trace: opts.trace });
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
      const kind = noteFailure(provider, {
        status: response.status,
        body: errBody,
        startedAt,
        hasTools,
        trace: opts.trace,
      });
      if (isProviderIndependentFailure(kind, errBody)) break;
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
      let streamTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const tokens = handleStreamLine(
            line,
            (text) => {
              emitted = true;
              handlers.onContentDelta(text);
            },
            (fragments) => {
              emitted = true;
              handlers.onToolCallDelta(fragments);
            }
          );
          if (tokens !== null) streamTokens = tokens;
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
      noteSuccess(provider, {
        status: response.status,
        startedAt,
        tokens: streamTokens,
        trace: opts.trace,
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
      noteFailure(provider, { status: 0, body: String(e), startedAt, hasTools, trace: opts.trace });
      // Partial output was already forwarded — drop it before falling through.
      if (emitted) handlers.onReset?.();
      continue;
    }
  }
  return null;
}

interface HedgeAttempt {
  provider: ChatLLMProvider;
  controller: AbortController;
  committed: boolean;
  abortedByUs: boolean;
  done: boolean;
}

/**
 * LLM-HEDGE-01 — hedged streaming for chat.
 *
 * A slow tier used to cost the user its full latency before the next one was
 * even tried (fallback2 answered a 1-token probe in 7.8s). Hedging starts the
 * next tier when the current one has produced nothing for `hedgeMs`; the first
 * tier to emit a delta wins, the others are aborted immediately.
 *
 * Safety:
 *  - only the CHAT stream hedges — Square/Movers batch posts must not pay twice;
 *  - deltas are only forwarded from the committed tier, so the user never sees
 *    two answers interleaved (a loser cannot emit before it is aborted because
 *    commitment happens on its first delta, and losers are aborted then);
 *  - if the committed tier dies mid-answer, onReset clears the client text and
 *    the next tier is started as in the sequential path;
 *  - a loser's AbortError is not reported as a provider failure (no telemetry
 *    pollution, no breaker trip).
 */
async function streamHedged(
  opts: LLMCompletionOptions,
  handlers: StreamHandlers,
  chain: ChatLLMProvider[],
  hedgeMs: number
): Promise<{ provider: string } | null> {
  const hasTools = Boolean(opts.tools && opts.tools.length > 0);

  return new Promise((resolve) => {
    const attempts: HedgeAttempt[] = [];
    let nextIndex = 0;
    let running = 0;
    let committed: HedgeAttempt | null = null;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const finish = (value: { provider: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimer();
      for (const attempt of attempts) {
        if (!attempt.done) {
          attempt.abortedByUs = true;
          attempt.controller.abort();
        }
      }
      resolve(value);
    };

    const startNext = (): boolean => {
      if (settled || nextIndex >= chain.length) return false;
      const provider = chain[nextIndex++];
      if (hasTools && !modelSupportsTools(provider.model)) return startNext();
      if (keyOverBudget(provider.apiKey, 800)) return startNext();

      const attempt: HedgeAttempt = {
        provider,
        controller: new AbortController(),
        committed: false,
        abortedByUs: false,
        done: false,
      };
      attempts.push(attempt);
      running++;
      void runAttempt(attempt).finally(() => {
        attempt.done = true;
        running--;
        if (!settled && !committed && running === 0) finish(null);
      });
      return true;
    };

    const armTimer = () => {
      if (settled || committed || hedgeMs <= 0) return;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        if (settled || committed) return;
        if (startNext()) armTimer();
      }, hedgeMs);
      timer.unref?.();
    };

    /** The first tier to produce anything owns the answer; abort the rest. */
    const claim = (attempt: HedgeAttempt): boolean => {
      if (settled) return false;
      if (committed === attempt) return true;
      if (committed) return false;
      committed = attempt;
      attempt.committed = true;
      clearTimer();
      for (const other of attempts) {
        if (other !== attempt && !other.done) {
          other.abortedByUs = true;
          other.controller.abort();
        }
      }
      return true;
    };

    const emit = (attempt: HedgeAttempt, fn: () => void) => {
      if (claim(attempt)) fn();
    };

    const runAttempt = async (attempt: HedgeAttempt) => {
      const provider = attempt.provider;
      const startedAt = Date.now();
      try {
        const response = await postChatCompletion(
          provider,
          buildChatBody(provider, opts, { stream: true }),
          streamTimeoutMs(opts, provider),
          attempt.controller.signal
        );
        if (attempt.abortedByUs) return;

        if (!response.ok || !response.body) {
          const errBody = await response.text().catch(() => "");
          if (attempt.abortedByUs) return;
          console.warn(
            `[CHAT-LLM] ${provider.name} stream HTTP ${response.status}: ${errBody.slice(0, 160)}`
          );
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
          const kind = noteFailure(provider, {
            status: response.status,
            body: errBody,
            startedAt,
            hasTools,
            trace: opts.trace,
            note: "hedge",
          });
          if (!committed && !isProviderIndependentFailure(kind, errBody)) startNext();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const tokens = handleStreamLine(
              line,
              (text) => emit(attempt, () => handlers.onContentDelta(text)),
              (fragments) => emit(attempt, () => handlers.onToolCallDelta(fragments))
            );
            if (tokens !== null) streamTokens = tokens;
          }
        }

        if (attempt.abortedByUs || settled) return;
        if (!claim(attempt)) return;

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
        noteSuccess(provider, {
          status: response.status,
          startedAt,
          tokens: streamTokens,
          trace: opts.trace,
          note: "hedge",
        });
        finish({ provider: provider.name });
      } catch (e) {
        if (attempt.abortedByUs || settled) return;
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
        noteFailure(provider, {
          status: 0,
          body: String(e),
          startedAt,
          hasTools,
          trace: opts.trace,
          note: "hedge",
        });

        if (committed === attempt) {
          // Half an answer is already on screen: clear it, then fail over.
          handlers.onReset?.();
          committed = null;
          if (startNext()) armTimer();
          else finish(null);
        } else if (!committed && startNext()) {
          // A silent replacement tier must itself be hedged, not waited on for
          // the full request timeout.
          armTimer();
        }
      }
    };

    if (!startNext()) {
      resolve(null);
      return;
    }
    armTimer();
  });
}

/**
 * Streaming completion with provider fallback.
 * Streams raw SSE chunks from the provider (token deltas + tool_call deltas).
 * onToolCallDelta accumulates tool-call fragments; onContentDelta receives text.
 * Returns the provider name that succeeded, or null.
 */
export async function chatCompletionStream(
  opts: LLMCompletionOptions,
  handlers: StreamHandlers
): Promise<{ provider: string } | null> {
  const shapeError = requestShapeError(opts);
  if (shapeError) {
    console.warn(`[CHAT-LLM] stream request rejected before the chain: ${shapeError}`);
    return null;
  }
  const chain = await resolveChatProviderChain(opts.profile ?? "chat");
  if (chain.length === 0) return null;

  const profile = opts.profile ?? "chat";
  const hedgeMs = opts.hedgeMs ?? (profile === "chat" ? llmHedgeMs() : 0);
  // A single-tier chain has nothing to race against.
  if (hedgeMs > 0 && chain.length > 1) {
    return streamHedged(opts, handlers, chain, hedgeMs);
  }
  return streamSequential(opts, handlers, chain);
}
