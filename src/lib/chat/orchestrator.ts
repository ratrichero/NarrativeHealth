// CHAT-P1/P2: Chat orchestrator — system prompt, tool-calling loop, history.
// Runs inside /api/chat (SSE). Public read-only product data only; advisory
// tone enforced via system prompt (no Buy/Sell instructions).

import { db } from "@/db";
import { chatSessions, chatMessages } from "@/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { chatCompletion, chatCompletionStream, type ChatMessage } from "./llm";
import { CHAT_TOOLS, CHAT_TOOLS_OPENAI_FORMAT, executeChatTool } from "./tools";
import {
  accumulateToolCallDeltas,
  normalizeToolArguments,
  type ToolCallAccum,
} from "./tool-call-accum";
import { frameToolResult, sanitizeToolArgs, toolAllowed } from "./tool-schema";
import { getCachedAnswer, setCachedAnswer } from "./answer-cache";
import { trimHistoryForBudget } from "@/lib/llm/context";

const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 12; // last N messages sent to LLM as context
// LLM-TOOL-01: a turn may not run away with tool calls even inside 4 rounds.
const MAX_TOOL_CALLS_PER_TURN = 8;
const TURN_WALL_CLOCK_MS = 90_000;

interface ToolTurnContext {
  cache: Map<string, string>;
  deadline: number;
  count: number;
}

function newToolTurnContext(): ToolTurnContext {
  return { cache: new Map(), deadline: Date.now() + TURN_WALL_CLOCK_MS, count: 0 };
}

// ─── System prompt ──────────────────────────────────────

export function buildSystemPrompt(): string {
  return `Bạn là trợ lý phân tích của Narrative Health Dashboard — hệ thống theo dõi sức khoẻ (health score) của các narrative crypto và coin.

NGUYÊN TẮC TRẢ LỜI:
1. NGÔN NGỮ: trả lời theo ngôn ngữ người dùng dùng (tiếng Việt nếu họ hỏi tiếng Việt, tiếng Anh nếu họ hỏi tiếng Anh). Khi trả lời tiếng Việt, GIỮ NGUYÊN thuật ngữ kỹ thuật (health score, funding rate, OI, RSI, EMA, long/short ratio...) — không dịch máy.
2. LUÔN DỰA TRÊN DATA: mọi con số phải đến từ tool call, KHÔNG bịa số liệu. Nếu tool trả lỗi (không có data, geo-block), nói thật với người dùng và gợi ý hỏi coin khác hoặc thử lại.
3. QUY TẮC CHỌN TOOL THEO LOẠI CÂU HỎI (bắt buộc, không ngoại lệ):
   - Từ khóa “bây giờ”, “hiện tại”, “giờ”, “now”, “current”, “lúc này”, “hôm nay” + giá/funding/OI → BẮT BUỘC dùng get_live_price / get_futures_snapshot (realtime). TUYỆT ĐỐI KHÔNG dùng get_coin_metrics hay get_coin_health cho loại câu này — chúng chỉ chứa data DB theo chu kỳ refresh, có thể đã cũ hàng giờ.
   - Từ khóa “biểu đồ”, “nến”, “chart”, “vẽ”, “cấu hình giá gần đây” → get_klines.
   - Health score, signal, recommendation, narrative, so sánh coin trong hệ thống → các tool DB (get_coin_health, get_narrative_health, get_top_recommendations...).
   - Khi câu hỏi chứa từ chỉ thời điểm hiện tại, nếu bạn trả lời bằng data DB thay vì realtime thì coi như trả lời SAI.
   - Nếu realtime tool trả lỗi (geo-block), hãy nói rõ: “không lấy được giá realtime lúc này” — KHÔNG thay thế bằng số DB mà trình bày như giá hiện tại; chỉ nêu số DB kèm nhãn “giá theo chu kỳ refresh gần nhất (ngày ...), có thể đã cũ”.
4. BIÊN GIỚI SẢN PHẨM: đây là công cụ advisory-only. TUYỆT ĐỐI không đưa lệnh "buy/sell/enter now". Mức Entry/TP/SL từ get_setup_levels là mức tham khảo tính từ ATR — luôn kèm nhắc "không phải khuyến nghị giao dịch, hãy DYOR".
5. CÂU TRẢ LỜI GỌN GÀNG: dùng bullet ngắn, dày đặc số liệu, kết thúc bằng nhận định 1-2 câu. Không verbose.
6. TOOL CHAINING: thoải mái gọi nhiều tool liên tiếp trong 1 câu trả lời (VD: health từ DB + snapshot realtime + klines để đọc cấu hình giá). Với coin KHÔNG có trong hệ thống, dùng get_live_price / get_futures_snapshot / get_klines — chúng hoạt động với mọi coin trên Binance.`;
}

// ─── Session helpers ────────────────────────────────────

export async function ensureSession(sessionId: string, fingerprint: string | null): Promise<void> {
  await db
    .insert(chatSessions)
    .values({ id: sessionId, clientFingerprint: fingerprint })
    .onConflictDoNothing();
}

export async function loadHistory(sessionId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));

  // Only last N, and map to LLM messages (skip tool rows — tool context is per-turn)
  return rows
    .slice(-HISTORY_LIMIT)
    .map((r) => ({
      role: r.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: r.content,
    }));
}

async function persistUserMessage(sessionId: string, content: string): Promise<void> {
  await db.insert(chatMessages).values({ sessionId, role: "user", content });
  await db
    .update(chatSessions)
    .set({
      updatedAt: new Date(),
      messageCount: sql`${chatSessions.messageCount} + 1`,
      title: sql`COALESCE(${chatSessions.title}, LEFT(${content}, 200))`,
    })
    .where(eq(chatSessions.id, sessionId));
}

async function persistAssistantMessage(
  sessionId: string,
  content: string,
  provider: string,
  toolCalls: { name: string; latencyMs: number }[]
): Promise<void> {
  await db.insert(chatMessages).values({
    sessionId,
    role: "assistant",
    content,
    llmProvider: provider,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
  });
  await db
    .update(chatSessions)
    .set({ updatedAt: new Date(), messageCount: sql`${chatSessions.messageCount} + 1` })
    .where(eq(chatSessions.id, sessionId));
}

// ─── Tool-calling loop (non-streaming, used as fallback) ──

/**
 * Runs one tool call for both loops: malformed arguments are never executed —
 * the model gets a tool result asking it to retry with valid JSON.
 */
async function runToolCall(
  name: string,
  rawArgs: string,
  ctx?: ToolTurnContext
): Promise<{ content: string; executed: { name: string; latencyMs: number } | null }> {
  const { json, malformed } = normalizeToolArguments(rawArgs);
  if (malformed) {
    return {
      content: JSON.stringify({
        error: "Malformed tool arguments; call the tool again with valid JSON.",
      }),
      executed: null,
    };
  }

  // LLM-TOOL-01: per-turn budget first, then per-tool rate limit, then shape.
  if (ctx && (Date.now() > ctx.deadline || ctx.count >= MAX_TOOL_CALLS_PER_TURN)) {
    return {
      content: JSON.stringify({
        error: "Tool budget for this turn is exhausted — answer with the data already collected.",
      }),
      executed: null,
    };
  }

  const guard = toolAllowed(name);
  if (!guard.allowed) {
    return { content: JSON.stringify({ error: guard.reason }), executed: null };
  }

  const sanitized = sanitizeToolArgs(name, JSON.parse(json) as Record<string, unknown>);
  if (!sanitized.ok) {
    return {
      content: JSON.stringify({ error: `Invalid tool arguments: ${sanitized.error}` }),
      executed: null,
    };
  }

  // Identical calls inside one turn reuse the result (models often repeat a
  // tool call after a rejected argument or a repair round).
  const cacheKey = `${name}:${JSON.stringify(sanitized.args)}`;
  const cached = ctx?.cache.get(cacheKey);
  if (cached) return { content: cached, executed: null };

  if (ctx) ctx.count++;
  const started = Date.now();
  const result = await executeChatTool(name, sanitized.args);
  // Tool output is data, not instructions — frame it before the model sees it.
  const content = frameToolResult(JSON.stringify(result).slice(0, 4000));
  ctx?.cache.set(cacheKey, content);
  return {
    content,
    executed: { name, latencyMs: Date.now() - started },
  };
}

export async function runChatTurn(
  sessionId: string,
  userMessage: string
): Promise<{ reply: string; provider: string; toolCalls: { name: string; latencyMs: number }[] } | { error: string }> {
  const cached = getCachedAnswer(sessionId, userMessage);
  if (cached) {
    return { reply: cached.text, provider: `cache:${cached.provider}`, toolCalls: [] };
  }

  const history = await loadHistory(sessionId);
  const { messages: trimmedHistory } = trimHistoryForBudget(history);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...trimmedHistory,
    { role: "user", content: userMessage },
  ];

  const executedTools: { name: string; latencyMs: number }[] = [];
  const toolCtx = newToolTurnContext();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await chatCompletion({ messages, tools: CHAT_TOOLS_OPENAI_FORMAT });
    if (!result) return { error: "Tất cả LLM providers đều lỗi. Vui lòng thử lại sau." };

    const { message, provider } = result;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Final answer
      const reply = message.content ?? "";
      setCachedAnswer(sessionId, userMessage, reply, provider);
      return { reply, provider, toolCalls: executedTools };
    }

    // Execute tools, append assistant + tool messages
    messages.push(message);
    for (const tc of message.tool_calls) {
      const { content, executed } = await runToolCall(
        tc.function.name,
        tc.function.arguments,
        toolCtx
      );
      if (executed) executedTools.push(executed);
      messages.push({ role: "tool", tool_call_id: tc.id, content });
    }
  }

  // Exhausted rounds — force a text-only completion
  const final = await chatCompletion({
    messages: [...messages, { role: "user", content: "Tổng hợp câu trả lời dựa trên data đã có, không gọi tool nữa." }],
  });
  if (!final) return { error: "LLM không phản hồi sau khi gọi tools." };
  setCachedAnswer(sessionId, userMessage, final.message.content ?? "", final.provider);
  return { reply: final.message.content ?? "", provider: final.provider, toolCalls: executedTools };
}

// ─── Streaming turn (SSE callbacks) ─────────────────────

export interface StreamTurnEvents {
  onStatus: (status: string) => void; // e.g. "Đang tra cứu giá Binance..."
  onDelta: (text: string) => void;
  onReset: () => void; // drop streamed text of a provider that died mid-answer
  onDone: (meta: { provider: string; toolCalls: { name: string; latencyMs: number }[] }) => void;
  onError: (message: string) => void;
}

const TOOL_STATUS_VI: Record<string, string> = {
  get_live_price: "Đang lấy giá realtime từ Binance...",
  get_futures_snapshot: "Đang đọc dữ liệu futures (funding, OI, long/short)...",
  get_klines: "Đang đọc biểu đồ nến từ Binance...",
  get_oi_trend: "Đang phân tích xu hướng Open Interest...",
  get_coin_health: "Đang tra cứu health score...",
  get_coin_metrics: "Đang tra cứu metrics...",
  get_setup_levels: "Đang tính setup levels...",
  get_narrative_health: "Đang tra cứu narrative health...",
  get_top_recommendations: "Đang lấy top recommendations...",
  compare_coins: "Đang so sánh 2 coin...",
  get_price_history: "Đang tra cứu lịch sử giá...",
  get_narrative_leaders: "Đang tra cứu narrative leaders...",
};

export async function runChatTurnStream(
  sessionId: string,
  userMessage: string,
  events: StreamTurnEvents
): Promise<void> {
  // LLM-CACHE-01: a repeated data question can be answered without a turn.
  // LLM-OPS-02: cached per session — never replay another session's answer.
  const cached = getCachedAnswer(sessionId, userMessage);
  if (cached) {
    await persistUserMessage(sessionId, userMessage);
    await persistAssistantMessage(sessionId, cached.text, `cache:${cached.provider}`, []);
    events.onDelta(cached.text);
    events.onDone({ provider: `cache:${cached.provider}`, toolCalls: [] });
    return;
  }

  await persistUserMessage(sessionId, userMessage);
  const history = await loadHistory(sessionId);
  // Remove the just-persisted user message from history (it's appended fresh below)
  const trimmedHistory = history.filter(
    (m, i) => !(i === history.length - 1 && m.role === "user" && m.content === userMessage)
  );

  const { messages: budgetedHistory } = trimHistoryForBudget(trimmedHistory);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...budgetedHistory,
    { role: "user", content: userMessage },
  ];

  const executedTools: { name: string; latencyMs: number }[] = [];
  const toolCtx = newToolTurnContext();
  let lastProvider = "unknown";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Accumulate streamed response for this round
      let contentBuf = "";
      const toolAccums = new Map<number, ToolCallAccum>();

      const streamed = await chatCompletionStream(
        { messages, tools: CHAT_TOOLS_OPENAI_FORMAT },
        {
          onContentDelta: (text) => {
            // Only stream content deltas to the client on the FINAL round.
            // We cannot know it's final until the stream ends, so buffer if
            // tools might be called: if any tool delta arrives we would have
            // buffered. Compromise: stream immediately — tool calls and text
            // rarely mix mid-round; the final round is text-only.
            contentBuf += text;
            events.onDelta(text);
          },
          onToolCallDelta: (frags) => accumulateToolCallDeltas(toolAccums, frags),
          onReset: () => {
            // SQ-CHAT-RESET: the provider failed mid-stream. Clear the buffer
            // (and any partial tool fragments) so the next provider's answer
            // replaces it instead of being concatenated onto it.
            contentBuf = "";
            toolAccums.clear();
            events.onReset();
          },
        }
      );

      if (!streamed) {
        events.onError("Tất cả LLM providers đều lỗi. Vui lòng thử lại sau.");
        return;
      }
      lastProvider = streamed.provider;

      if (toolAccums.size === 0) {
        // Final answer streamed
        setCachedAnswer(sessionId, userMessage, contentBuf, lastProvider);
        await persistAssistantMessage(sessionId, contentBuf, lastProvider, executedTools);
        events.onDone({ provider: lastProvider, toolCalls: executedTools });
        return;
      }

      // Execute tools and continue loop
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: contentBuf || null,
        // Valid JSON on the wire is guaranteed once, in messagesForProvider;
        // Gemini's signature must survive the replay, so carry it along.
        tool_calls: [...toolAccums.values()].map((a) => ({
          id: a.id || `call_${a.name}_${round}`,
          type: "function" as const,
          function: { name: a.name, arguments: a.args || "{}" },
          ...(a.extraContent ? { extra_content: a.extraContent } : {}),
        })),
      };
      messages.push(assistantMsg);

      for (const acc of toolAccums.values()) {
        events.onStatus(TOOL_STATUS_VI[acc.name] ?? `Đang gọi ${acc.name}...`);
        const { content, executed } = await runToolCall(acc.name, acc.args, toolCtx);
        if (executed) executedTools.push(executed);
        messages.push({ role: "tool", tool_call_id: acc.id || `call_${acc.name}_${round}`, content });
      }
    }

    // Rounds exhausted — final non-streaming without tools
    const final = await chatCompletion({
      messages: [...messages, { role: "user", content: "Tổng hợp câu trả lời dựa trên data đã có, không gọi tool nữa." }],
    });
    if (!final) {
      events.onError("LLM không phản hồi sau khi gọi tools.");
      return;
    }
    events.onDelta(final.message.content ?? "");
    setCachedAnswer(sessionId, userMessage, final.message.content ?? "", final.provider);
    await persistAssistantMessage(sessionId, final.message.content ?? "", final.provider, executedTools);
    events.onDone({ provider: final.provider, toolCalls: executedTools });
  } catch (e) {
    console.error("[CHAT-ORCH] stream turn failed:", e);
    events.onError("Đã xảy ra lỗi khi xử lý câu hỏi. Vui lòng thử lại.");
  }
}
