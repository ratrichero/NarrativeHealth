"use client";

// RADAR-06 — panel “Vì sao volume bất thường?”.
// Chỉ hiển thị facts + link nguồn. Không suy đoán, không khuyến nghị.
// Không có fact khớp KHÔNG đồng nghĩa “không có catalyst”: phải phân biệt
// “chưa đồng bộ nguồn” (catalyst.sync = null) với “đã kiểm tra nhưng không khớp”,
// và “nguồn đang lỗi”. Trạng thái do API trả (`data.sync`), UI không tự đoán.

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import type { CatalystSummary } from "@/lib/catalyst/types";
// Chỉ import module nhãn thuần: `summarize` kéo theo DB/LLM → không được vào
// browser bundle (Next báo "Can't resolve 'util/types'" từ `pg`).
import {
  catalystSourceLabel,
  catalystSyncSourceLabel,
  catalystTypeLabel,
} from "@/lib/catalyst/labels";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json()) as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.error ?? "Không tải được catalyst.");
  }
  return body.data;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toUTCString().slice(0, 16) + " UTC";
}

/** Copy cho trạng thái không có fact khớp — theo `sync.state`, không theo mặc định. */
function emptyStateCopy(data?: CatalystSummary): { title: string; hint: string } {
  const sync = data?.sync;
  if (!sync || sync.state === "synced") {
    const checked = (sync?.checkedSources ?? []).map(catalystSyncSourceLabel);
    return {
      title: "Chưa tìm thấy catalyst khớp trong cửa sổ thời gian của từng loại nguồn.",
      hint: `Đã kiểm tra: ${checked.length > 0 ? checked.join(", ") : "chưa có nguồn nào chạy được"}. Không có nghĩa là không có lý do — chỉ là chưa có nguồn nào công bố.`,
    };
  }
  if (sync.state === "never_synced") {
    return {
      title: "Chưa đồng bộ nguồn catalyst.",
      hint: "Hệ thống chưa chạy sync nguồn (Binance announcement, RSS news, unlock calendar) nên chưa thể kết luận. Đây không phải là “không có catalyst”.",
    };
  }
  return {
    title: "Nguồn catalyst đang lỗi.",
    hint: `Lượt đồng bộ gần nhất lỗi ở: ${
      sync.failedSources.map(catalystSyncSourceLabel).join(", ") || "không rõ nguồn"
    }. Chưa thể kết luận coin này có catalyst hay không.`,
  };
}

export function CatalystPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useQuery<CatalystSummary>({
    queryKey: ["catalyst", symbol],
    queryFn: () => getJson<CatalystSummary>(`/api/market/movers/${symbol}/catalysts`),
    staleTime: 30 * 60_000,
    retry: 1,
  });

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-200">
          <Sparkles className="h-4 w-4" /> Vì sao volume bất thường?
        </h3>
        {data ? (
          <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300">
            {data.mode === "llm"
              ? "AI tóm tắt facts"
              : data.mode === "template"
                ? "facts (template)"
                : data.sync?.state === "never_synced"
                  ? "chưa đồng bộ nguồn"
                  : data.sync?.state === "sources_failed"
                    ? "nguồn lỗi"
                    : "không có catalyst"}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tìm catalyst trong nguồn công khai…
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-slate-400">
          {error instanceof Error ? error.message : "Không đọc được catalyst."} — không suy đoán thay.
        </p>
      ) : !data || data.facts.length === 0 ? (
        (() => {
          const copy = emptyStateCopy(data);
          return (
            <div className="mt-3 space-y-1 text-xs text-slate-400">
              <p>{copy.title}</p>
              <p className="text-slate-500">{copy.hint}</p>
              {data?.sync?.lastSyncAt ? (
                <p className="text-slate-500">
                  Đồng bộ nguồn gần nhất: {formatDate(data.sync.lastSyncAt)}
                </p>
              ) : null}
            </div>
          );
        })()
      ) : (
        <div className="mt-3 space-y-3">
          {data.summary ? (
            <p className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-200">
              {data.summary}
            </p>
          ) : null}

          <ul className="space-y-2">
            {data.facts.map((fact) => (
              <li key={`${fact.source}-${fact.externalId}`} className="text-xs text-slate-300">
                <span className="mr-1.5 rounded border border-slate-700 px-1 py-0.5 text-[10px] text-slate-400">
                  {catalystTypeLabel(fact.type)}
                </span>
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-slate-600 underline-offset-2 hover:text-violet-200"
                >
                  {fact.title}
                  <ExternalLink className="ml-1 inline h-3 w-3 align-baseline" />
                </a>
                <span className="ml-1.5 text-slate-500">
                  {catalystSourceLabel(fact.source)} · {formatDate(fact.eventDate ?? fact.publishedAt)}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-[11px] leading-relaxed text-slate-500">
            {data.note} Dữ kiện từ nguồn công khai, không phải khuyến nghị đầu tư; nguồn không nêu lý do
            biến động thì hệ thống không tự suy đoán.
          </p>
        </div>
      )}
    </div>
  );
}
