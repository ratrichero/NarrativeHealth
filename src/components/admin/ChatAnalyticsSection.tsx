"use client";

// CHAT-P4.5 UI: Chat Analytics section for the Admin page — usage overview,
// tool stats with latency, LLM provider split, recent sessions.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MessageCircle, Wrench, Zap, History } from "lucide-react";

interface ChatAnalytics {
  range: string;
  overview: {
    sessions: number;
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    llmAnswers: number;
    avgToolsPerAnswer: number;
  };
  providerSplit: { provider: string | null; n: number }[];
  toolStats: { name: string; calls: number; avgLatencyMs: number }[];
  daily: { day: string; userMsgs: number }[];
  recentSessions: {
    id: string;
    title: string | null;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
  }[];
}

const RANGES = ["7D", "30D", "ALL"] as const;

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-white mt-1">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

export function ChatAnalyticsSection() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("7D");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "chat-analytics", range],
    queryFn: async (): Promise<ChatAnalytics> => {
      const res = await fetch(`/api/admin/chat/analytics?range=${range}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
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
    return <div className="text-sm text-slate-400 py-4">Không tải được chat analytics.</div>;
  }

  const empty = data.overview.totalMessages === 0;
  const maxDaily = Math.max(...data.daily.map((d) => d.userMsgs), 1);
  const maxToolCalls = Math.max(...data.toolStats.map((t) => t.calls), 1);

  return (
    <div className="space-y-6">
      {/* Range switcher */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-cyan-400" />
          Chat Analytics
        </h2>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                range === r
                  ? "bg-cyan-600 border-cyan-500 text-white"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {empty ? (
        <div className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-700 rounded-lg">
          Chưa có hội thoại nào trong khoảng thời gian này. Mở chat widget và thử hỏi một câu!
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Sessions" value={data.overview.sessions} />
            <StatCard label="Tin nhắn user" value={data.overview.userMessages} />
            <StatCard
              label="Câu trả lời LLM"
              value={data.overview.llmAnswers}
              hint={`${data.overview.assistantMessages} assistant msgs`}
            />
            <StatCard
              label="Tool / câu trả lời"
              value={data.overview.avgToolsPerAnswer}
              hint="trung bình"
            />
          </div>

          {/* Provider split */}
          <div>
            <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-400" /> LLM Provider
            </h3>
            <div className="flex flex-wrap gap-2">
              {data.providerSplit.map((p) => {
                const total = data.providerSplit.reduce((a, b) => a + b.n, 0);
                const pct = total > 0 ? Math.round((p.n / total) * 100) : 0;
                return (
                  <div key={p.provider ?? "template"} className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
                    <div className="text-xs text-slate-400">{p.provider ?? "không rõ"}</div>
                    <div className="text-lg font-semibold text-white">
                      {p.n} <span className="text-xs text-slate-500">({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Tool usage */}
            <div>
              <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-1.5">
                <Wrench className="h-4 w-4 text-cyan-400" /> Tool usage
              </h3>
              {data.toolStats.length === 0 ? (
                <div className="text-xs text-slate-500">Chưa có tool nào được gọi.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.toolStats.map((t) => (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className="text-xs text-slate-300 w-44 truncate font-mono">{t.name}</span>
                      <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                        <div
                          className="h-full bg-cyan-600/70 rounded"
                          style={{ width: `${(t.calls / maxToolCalls) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 w-20 text-right">
                        {t.calls}× · {t.avgLatencyMs}ms
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daily volume */}
            <div>
              <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-1.5">
                <MessageCircle className="h-4 w-4 text-emerald-400" /> Tin nhắn theo ngày
              </h3>
              <div className="space-y-1.5">
                {data.daily.slice(0, 10).map((d) => (
                  <div key={d.day} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-20">{d.day}</span>
                    <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                      <div
                        className="h-full bg-emerald-600/70 rounded"
                        style={{ width: `${(d.userMsgs / maxDaily) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-8 text-right">{d.userMsgs}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent sessions */}
          <div>
            <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-1.5">
              <History className="h-4 w-4 text-violet-400" /> Sessions gần đây
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-slate-400 text-xs">
                    <th className="pb-2">Câu hỏi đầu</th>
                    <th className="pb-2">Msgs</th>
                    <th className="pb-2">Bắt đầu</th>
                    <th className="pb-2">Hoạt động cuối</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSessions.map((s) => (
                    <tr key={s.id} className="border-b border-slate-800">
                      <td className="py-2 text-white max-w-[280px] truncate" title={s.title ?? ""}>
                        {s.title ?? "(trống)"}
                      </td>
                      <td className="py-2 text-slate-300">{s.messageCount}</td>
                      <td className="py-2 text-slate-400 text-xs">
                        {new Date(s.createdAt).toLocaleString("vi-VN")}
                      </td>
                      <td className="py-2 text-slate-400 text-xs">
                        {new Date(s.updatedAt).toLocaleString("vi-VN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
