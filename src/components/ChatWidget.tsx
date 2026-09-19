"use client";

// CHAT-P3: Floating chatbot widget — mounted once in the root layout so it is
// available on every page. SSE streaming, Vietnamese status while tools run,
// session history persisted in DB (survives page refresh).

import { useEffect, useRef, useState, useCallback } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { ChatMarkdown } from "@/components/chat/Markdown";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ToolCallMeta {
  name: string;
  latencyMs: number;
}

const SESSION_KEY = "nhd-chat-session-id";

function randomId(): string {
  // crypto.randomUUID only exists in secure contexts (HTTPS/localhost) —
  // production is often served over plain http://IP, so fall back to
  // getRandomValues / Math.random to avoid crashing the whole page.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return randomId(); // localStorage may throw in strict privacy modes
  }
}

function fingerprint(): string {
  // Anonymous bucket for rate limiting — no PII
  if (typeof window === "undefined") return "anon";
  const nav = window.navigator;
  const raw = `${nav.userAgent}|${nav.language}|${screen.width}x${screen.height}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `fp${hash}`;
}

const SUGGESTIONS = [
  "PENDLE có đáng quan tâm không?",
  "Top coin xu hướng tốt nhất hiện tại?",
  "Giá BTC bây giờ bao nhiêu?",
  "Narrative AI đang thế nào?",
];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<{ provider: string; toolCalls: ToolCallMeta[] } | null>(null);
  const sessionRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyLoadedRef = useRef(false);

  useEffect(() => {
    sessionRef.current = getSessionId();
  }, []);

  // Load history once when first opened
  useEffect(() => {
    if (!open || historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch(`/api/chat?sessionId=${sessionRef.current}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data.messages) && json.data.messages.length > 0) {
          setTurns(json.data.messages);
        }
      } catch {
        // history load failure is non-fatal
      }
    })();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, status]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || streaming) return;
    setInput("");
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setStreaming(true);
    setStatus(null);

    // Placeholder assistant turn updated by deltas
    setTurns((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionRef.current, message, fingerprint: fingerprint() }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Lỗi kết nối." }));
        throw new Error(err.error ?? "Lỗi kết nối.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventLine = part.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim());

          if (event === "status") setStatus(data.status);
          else if (event === "delta")
            setTurns((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + data.text };
              return copy;
            });
          else if (event === "done") {
            setLastMeta(data);
            setStatus(null);
          } else if (event === "error") {
            setTurns((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${data.error}` };
              return copy;
            });
            setStatus(null);
          }
        }
      }
    } catch (e) {
      setTurns((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = {
          role: "assistant",
          content: last.content || `⚠️ ${e instanceof Error ? e.message : "Lỗi kết nối."}`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
      setStatus(null);
    }
  }, [input, streaming]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Mở chat trợ lý"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-900/40 flex items-center justify-center transition-transform hover:scale-105"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl w-[380px] max-w-[calc(100vw-2rem)]"
      style={{ height: "min(560px, calc(100vh - 3rem))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800/60 rounded-t-xl">
        <div>
          <div className="text-sm font-semibold text-white">Trợ lý Narrative Health</div>
          <div className="text-[10px] text-slate-400">Advisory-only · không phải khuyến nghị giao dịch</div>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Đóng chat" className="text-slate-400 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {turns.length === 0 && (
          <div className="text-xs text-slate-400 space-y-2">
            <p>Xin chào! Tôi có thể trả lời về health score, narrative, setup levels và giá realtime từ Binance.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-[11px] px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                t.role === "user"
                  ? "max-w-[85%] rounded-lg bg-cyan-600/90 text-white text-sm px-3 py-2 whitespace-pre-wrap"
                  : "max-w-[90%] rounded-lg bg-slate-800 text-slate-100 px-3 py-2"
              }
            >
              {t.role === "assistant" ? (
                <ChatMarkdown text={t.content || (streaming && i === turns.length - 1 ? "…" : "")} />
              ) : (
                t.content
              )}
            </div>
          </div>
        ))}

        {status && (
          <div className="flex items-center gap-2 text-xs text-cyan-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            {status}
          </div>
        )}
      </div>

      {/* Footer meta */}
      {lastMeta && !streaming && (
        <div className="px-4 py-1 text-[10px] text-slate-500 border-t border-slate-800">
          {lastMeta.toolCalls.length > 0 && `tools: ${lastMeta.toolCalls.map((t) => t.name).join(", ")} · `}
          {lastMeta.provider}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-700">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Hỏi về coin, narrative, giá realtime..."
          disabled={streaming}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-600 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          aria-label="Gửi tin nhắn"
          className="h-9 w-9 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white flex items-center justify-center"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
