"use client";

// RADAR-BIAS-REVIEW — đọc `radar_bias_log` (bảng append-only mọi row radar) và
// outcome theo horizon để trả lời "nhãn nào đúng" + "nhãn lật sang đâu trong
// 4h". Dữ liệu do `/api/admin/radar/bias-review` gộp sẵn bằng SQL.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BiasReviewPayload } from "@/lib/market/bias-review";

const DAY_OPTIONS = [7, 30, 90];

function formatPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatHit(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

function hitTone(value: number | null): string {
  if (value === null) return "text-slate-400";
  if (value >= 55) return "text-emerald-400";
  if (value < 45) return "text-rose-400";
  return "text-slate-200";
}

export function RadarBiasReviewCard() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, isFetching, refetch } = useQuery<BiasReviewPayload>({
    queryKey: ["admin", "radar-bias-review", days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/radar/bias-review?days=${days}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Không đọc được radar_bias_log.");
      return json.data as BiasReviewPayload;
    },
    refetchInterval: 120_000,
  });

  const horizons = data?.rows.flatMap((row) => row.horizons.map((cell) => cell.horizon)) ?? [];
  const orderedHorizons = [...new Set(horizons)];
  const flips = data?.transitions.afterExhaustion;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
            <BarChart3 className="h-4 w-4 text-cyan-400" /> Chất lượng nhãn (radar_bias_log)
          </h4>
          <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-slate-500">
            Win-rate và return trung bình theo đúng chiều nhãn (bias giảm đã đổi dấu) của mọi row
            snapshot, kèm ma trận chuyển nhãn: nhãn kế tiếp của cùng symbol+side trong{" "}
            {data?.transitionHours ?? 4} giờ. Cột <span className="text-amber-300">lệch</span> là số
            lần nhãn đổi — cao ở “Kiệt sức (fade)” nghĩa là fade bị gọi sớm/quá nhạy.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-700 p-0.5">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => setDays(option)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] transition",
                  days === option
                    ? "bg-cyan-500/15 text-cyan-300"
                    : "text-slate-400 hover:bg-slate-800"
                )}
              >
                {option} ngày
              </button>
            ))}
          </div>
          <button
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-60"
          >
            {isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Làm mới
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-400">
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Đang gộp radar_bias_log…
        </p>
      ) : error || !data ? (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          {error instanceof Error ? error.message : "Không đọc được radar_bias_log."}
        </p>
      ) : (
        <>
          <p className="mt-3 text-[11px] text-slate-400">
            {data.logs.toLocaleString("vi-VN")} row trong {data.days} ngày ·{" "}
            <span className="tabular-nums text-slate-200">{data.flips.toLocaleString("vi-VN")}</span>{" "}
            lần đổi nhãn (
            {data.logs > 0 ? `${Math.round((data.flips / data.logs) * 100)}%` : "—"}) · từ{" "}
            {new Date(data.since).toLocaleDateString("vi-VN")}
          </p>
          {data.engines.length > 0 ? (
            <p className="mt-1 text-[10px] text-slate-500">
              Engine:{" "}
              {data.engines
                .map((engine) => `${engine.version} (${engine.logs.toLocaleString("vi-VN")} row)`)
                .join(" · ")}
              {data.engines.length > 1
                ? " — trộn nhiều phiên bản nên hit-rate có thể lệch giữa các nhóm."
                : null}
            </p>
          ) : null}

          {data.rows.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">
              Chưa có outcome nào: job `radar_bias_outcomes` chạy 10 phút/lần và chỉ ghi horizon khi
              đã đủ tuổi (1h là sớm nhất), sau khi cohort ghi row vào `radar_bias_log`.
            </p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Bias</th>
                      {orderedHorizons.map((horizon) => (
                        <th key={horizon} className="py-2 pr-3 text-right font-medium">
                          {horizon}
                        </th>
                      ))}
                      <th className="py-2 text-right font-medium">Mẫu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {data.rows.map((row) => (
                      <tr key={row.bias} className="text-slate-300">
                        <td className="py-2 pr-3 font-medium text-slate-200">{row.label}</td>
                        {orderedHorizons.map((horizon) => {
                          const cell = row.horizons.find((item) => item.horizon === horizon);
                          return (
                            <td key={horizon} className="py-2 pr-3 text-right tabular-nums">
                              {cell ? (
                                <>
                                  <span className={cn("font-semibold", hitTone(cell.hitRate))}>
                                    {formatHit(cell.hitRate)}
                                  </span>{" "}
                                  <span className="text-slate-400">{formatPct(cell.avgEdgePct)}</span>{" "}
                                  <span className="text-[10px] text-slate-500">({cell.n})</span>
                                  {cell.ciLow !== null && cell.ciHigh !== null ? (
                                    <span
                                      className="block text-[10px] text-slate-600"
                                      title="Khoảng Wilson 95% — mẫu nhỏ thì khoảng rất rộng"
                                    >
                                      CI {Math.round(cell.ciLow)}–{Math.round(cell.ciHigh)}%
                                    </span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="text-slate-600">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 text-right tabular-nums text-slate-500">{row.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {flips && flips.total > 0 ? (
                <p
                  className={cn(
                    "mt-3 rounded-lg border p-2.5 text-[11px]",
                    (flips.toContinuationRate ?? 0) >= 30
                      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                      : "border-slate-800 bg-slate-950/50 text-slate-400"
                  )}
                >
                  <span className="font-semibold">Kiệt sức → Tiếp diễn tăng trong 4h:</span>{" "}
                  <span className="tabular-nums">
                    {flips.toContinuation}/{flips.total}
                  </span>{" "}
                  lần ({formatHit(flips.toContinuationRate)}). Tỷ lệ cao = fade bị gọi khi trend còn
                  nguyên (case MMT).
                </p>
              ) : null}

              {data.transitions.rows.length > 0 ? (
                <div className="mt-4">
                  <p className="text-[11px] font-medium text-slate-300">
                    Ma trận chuyển nhãn trong {data.transitionHours}h
                  </p>
                  <div className="mt-1.5 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Từ ↓ / sang →</th>
                          {data.transitions.columns.map((column) => (
                            <th key={column.bias} className="py-2 pr-3 text-right font-medium">
                              {column.label}
                            </th>
                          ))}
                          <th className="py-2 text-right font-medium">Đổi nhãn</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {data.transitions.rows.map((row) => (
                          <tr key={row.from} className="text-slate-300">
                            <td className="py-2 pr-3 font-medium text-slate-200">{row.label}</td>
                            {data.transitions.columns.map((column) => {
                              const cell = row.byTo.find((item) => item.to === column.bias);
                              const isFlip = column.bias !== row.from;
                              return (
                                <td
                                  key={column.bias}
                                  className={cn(
                                    "py-2 pr-3 text-right tabular-nums",
                                    !cell
                                      ? "text-slate-700"
                                      : isFlip
                                        ? "text-amber-300"
                                        : "text-slate-400"
                                  )}
                                >
                                  {cell ? cell.n : "—"}
                                </td>
                              );
                            })}
                            <td className="py-2 text-right tabular-nums text-slate-400">
                              {row.flipRate === null ? "—" : `${Math.round(row.flipRate)}%`}{" "}
                              <span className="text-[10px] text-slate-600">/{row.total}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
                    Chỉ tính lần chấm kế tiếp cùng symbol+side; coin đổi side (gainer → loser) tạo
                    chuỗi mới nên chuyển tiếp qua side không xuất hiện ở đây.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
