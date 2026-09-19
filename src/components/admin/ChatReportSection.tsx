"use client";

// CHAT-P4.5-UI: Chat Report tab — session list + conversation viewer.
// Every assistant answer shows a model attribution badge (which LLM tier
// produced it) and the exact tools it called, from persisted chat_messages.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MessageSquare, Bot, User, Wrench, BadgeCheck, ArrowLeft } from "lucide-react";
import { ChatMarkdown } from "@/components/chat/Markdown";

interface SessionRow {
  id: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface MessageRow {
  id: number;
  role: string;
  content: string;
  llmProvider: string | null;
  toolCalls: { name: string; latencyMs: number }[] | null;
  createdAt: string;
}

const PROVIDER_META: Record<string, { label: string; cls: string }> = {
  primary: { label: "Primary (Groq)", cls: "bg-cyan-900/50 text-cyan-300 border-cyan-700" },
  fallback1: { label: "Fallback 1 (hcnsec)", cls: "bg-blue-900/50 text-blue-300 border-blue-700" },
  fallback2: { label: "Fallback 2 (OpenRouter)", cls: "bg-violet-900/50 text-violet-300 border-violet-700" },
};

function ProviderBadge({ provider }: { provider: string | null }) {
  if (!provider) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border bg-slate-800 text-slate-400 border-slate-700">
        <BadgeCheck className="h-3 w-3" />
        Không ghi nhận model
      </span>
    );
  }
  const meta = PROVIDER_META[provider] ?? {
    label: provider,
    cls: "bg-slate-800 text-slate-300 border-slate-700",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border font-medium ${meta.cls}`}>
      <BadgeCheck className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function SessionDetail({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "chat-report", "session", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/chat/analytics?sessionId=${sessionId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as { session: SessionRow; messages: MessageRow[] };
    },
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-red-400 py-4">Không tải được hội thoại.</div>;
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-3"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Tất cả sessions
      </button>
      <div className="bg-slate-800/40 border border-slate-700 rounded-lg p-3 mb-4">
        <div className="text-sm text-white font-medium">{data.session.title ?? "(không có tiêu đề)"}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          {data.messages.length} messages · bắt đầu {new Date(data.session.createdAt).toLocaleString("vi-VN")}
        </div>
      </div>

      <div className="space-y-3">
        {data.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-cyan-600/90 text-white text-sm px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] text-cyan-200 mb-0.5">
                  <User className="h-3 w-3" /> User ·{" "}
                  {new Date(m.createdAt).toLocaleTimeString("vi-VN")}
                </div>
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[90%] rounded-lg bg-slate-800 text-slate-100 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Bot className="h-3 w-3" /> Bot ·{" "}
                    {new Date(m.createdAt).toLocaleTimeString("vi-VN")}
                  </span>
                  <ProviderBadge provider={m.llmProvider} />
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-900 text-slate-400 border border-slate-700">
                      <Wrench className="h-3 w-3" />
                      {m.toolCalls.map((t) => t.name).join(", ")}
                    </span>
                  )}
                </div>
                <ChatMarkdown text={m.content} />
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function ChatReportSection() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "chat-report", "sessions"],
    queryFn: async (): Promise<SessionRow[]> => {
      const res = await fetch("/api/admin/chat/analytics?range=ALL");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data.recentSessions as SessionRow[];
    },
  });

  if (selected) {
    return <SessionDetail sessionId={selected} onBack={() => setSelected(null)} />;
  }

  if (isLoading) {
    return (
      <div className="py-8 text-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-slate-400 py-4">Không tải được danh sách sessions.</div>;
  }
  if (data.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-700 rounded-lg">
        Chưa có session nào. Mở chat widget và thử hỏi một câu!
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-cyan-400" />
        Chat Report
      </h2>
      <p className="text-xs text-slate-500 -mt-2">
        Mỗi câu trả lời của Bot đều kèm xác thực model đã sinh ra và các tool đã gọi.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-slate-400 text-xs">
              <th className="pb-2">Câu hỏi đầu</th>
              <th className="pb-2">Msgs</th>
              <th className="pb-2">Bắt đầu</th>
              <th className="pb-2">Hoạt động cuối</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id} className="border-b border-slate-800 hover:bg-slate-800/40">
                <td className="py-2 text-white max-w-[320px] truncate" title={s.title ?? ""}>
                  {s.title ?? "(trống)"}
                </td>
                <td className="py-2 text-slate-300">{s.messageCount}</td>
                <td className="py-2 text-slate-400 text-xs">
                  {new Date(s.createdAt).toLocaleString("vi-VN")}
                </td>
                <td className="py-2 text-slate-400 text-xs">
                  {new Date(s.updatedAt).toLocaleString("vi-VN")}
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => setSelected(s.id)}
                    className="text-xs px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-cyan-400 hover:text-cyan-300 hover:border-cyan-600"
                  >
                    Xem hội thoại
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
