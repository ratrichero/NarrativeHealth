"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Info,
  Loader2,
  Radar as RadarIcon,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BIAS_LABELS, type MoverSide, type Bias } from "@/lib/market/scoring";
import type { RadarDetail, RadarRow, RadarSnapshot, RadarSort } from "@/lib/market/radar";
import type { BriefResult } from "@/lib/market/brief";
import type { TrackRecordResult } from "@/lib/market/track-record";

const SIDE_TABS: { id: MoverSide; label: string; hint: string }[] = [
  { id: "gainer", label: "Tăng mạnh", hint: "Move còn tiếp diễn hay đã kiệt sức?" },
  { id: "loser", label: "Giảm sâu", hint: "Bắt hồi sau flush hay breakdown còn tiếp?" },
  { id: "unusual", label: "Radar sớm", hint: "Volume/OI bất thường khi giá chưa chạy." },
];

const VOLUME_OPTIONS = [
  { value: 5_000_000, label: "$5M" },
  { value: 10_000_000, label: "$10M" },
  { value: 25_000_000, label: "$25M" },
  { value: 50_000_000, label: "$50M" },
];

const SORT_OPTIONS: { value: RadarSort; label: string }[] = [
  { value: "composite", label: "Điểm hành động" },
  { value: "fresh", label: "Move còn mới" },
  { value: "change", label: "Biến động 24h" },
  { value: "volume", label: "Volume" },
];

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let payload: { success?: boolean; data?: T; error?: string } = {};
  try {
    payload = await response.json();
  } catch {
    throw new Error(`HTTP ${response.status}`);
  }
  if (!response.ok || !payload.success) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload.data as T;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : value >= 0.01 ? 5 : 7;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatFunding(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(3)}%`;
}

function biasClasses(bias: Bias): string {
  if (bias === "continuation" || bias === "breakout" || bias === "accumulation" || bias === "flush-bounce") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (bias === "exhaustion" || bias === "breakdown") {
    return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  }
  return "border-slate-600 bg-slate-800 text-slate-300";
}

function RangeBar({ position }: { position: number }) {
  const pct = Math.min(100, Math.max(0, position * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-slate-500 via-cyan-500 to-emerald-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-right text-[11px] tabular-nums text-slate-400">{pct.toFixed(0)}%</span>
    </div>
  );
}

function PriceChart({ candles }: { candles: RadarDetail["chart"] }) {
  const closes = candles.map((c) => c.c).filter(Number.isFinite);
  if (closes.length < 2) {
    return <div className="rounded-lg border border-slate-800 p-6 text-sm text-slate-500">Không có dữ liệu nến 4h.</div>;
  }
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const points = closes
    .map((c, i) => `${(i / (closes.length - 1)) * 100},${38 - ((c - min) / span) * 34}`)
    .join(" ");
  const up = closes[closes.length - 1] >= closes[0];

  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-36 w-full">
        <polygon points={`0,40 ${points} 100,40`} fill={up ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)"} />
        <polyline
          points={points}
          fill="none"
          stroke={up ? "#34d399" : "#fb7185"}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>4h × {closes.length} nến</span>
        <span>
          low {formatPrice(min)} · high {formatPrice(max)}
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "up" && "text-emerald-400",
          tone === "down" && "text-rose-400",
          !tone && "text-slate-100"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function DetailDrawer({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [brief, setBrief] = useState<BriefResult | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const { data, isLoading, error } = useQuery<RadarDetail>({
    queryKey: ["market-radar-detail", symbol],
    queryFn: () => getJson<RadarDetail>(`/api/market/movers/${symbol}`),
    staleTime: 45_000,
    retry: 1,
  });

  const requestBrief = async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const result = await getJson<BriefResult>(`/api/market/movers/${symbol}/brief`, { method: "POST" });
      setBrief(result);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : "Không tạo được brief");
    } finally {
      setBriefLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Binance Futures · 24h</p>
            <h2 className="text-2xl font-semibold text-slate-100">${symbol}</h2>
            {data ? (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className={cn(data.row.changePct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {formatPct(data.row.changePct)}
                </span>
                <span>·</span>
                <span>{formatPrice(data.row.price)}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5",
                    data.row.inSystem
                      ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                      : "border-slate-700 bg-slate-900 text-slate-400"
                  )}
                >
                  {data.row.inSystem
                    ? `Trong hệ thống${data.row.narratives.length ? ` · ${data.row.narratives.join(", ")}` : ""}`
                    : "Ngoài hệ thống"}
                </span>
              </div>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Đóng chi tiết"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading ? (
          <div className="mt-10 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải klines/OI/funding…
          </div>
        ) : error || !data ? (
          <p className="mt-8 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error instanceof Error ? error.message : "Không tải được chi tiết."}
          </p>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <PriceChart candles={data.chart} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", biasClasses(data.row.bias))}>
                {data.row.label} · {data.row.score}/100
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
                Độ mới của move: {data.row.entryQuality}/100
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Vị trí range 24h" value={`${(data.row.rangePosition * 100).toFixed(0)}%`} hint="0% đáy · 100% đỉnh" />
              <Metric label="Cách đỉnh 24h" value={formatPct(-data.row.distanceFromHighPct)} />
              <Metric label="ATR 1d" value={data.row.atrPct === null ? "—" : `${data.row.atrPct.toFixed(2)}%`} hint="Biến động trung bình ngày" />
              <Metric label="Move / ATR" value={data.row.changeAtrMultiple === null ? "—" : `${data.row.changeAtrMultiple.toFixed(1)}×`} />
              <Metric label="Volume 24h" value={formatUsd(data.row.quoteVolume)} hint={data.row.volumeRatio7d === null ? "Thiếu baseline" : `${data.row.volumeRatio7d.toFixed(1)}× TB 7d`} />
              <Metric label="Volume z-score" value={data.row.volumeZ === null ? "—" : data.row.volumeZ.toFixed(1)} />
              <Metric label="OI 24h" value={formatPct(data.row.oiChangePct)} hint="Vị thế mở thay đổi" />
              <Metric label="Funding" value={formatFunding(data.row.fundingRate)} hint="Mỗi 8 giờ" />
              <Metric label="RSI 4h" value={data.row.rsi14 === null ? "—" : data.row.rsi14.toFixed(0)} />
              <Metric label="Biên độ 7d" value={data.row.rangePct7d === null ? "—" : `${data.row.rangePct7d.toFixed(1)}%`} hint={data.row.isBreakout7d ? "Đã breakout" : "Chưa breakout"} />
              <Metric label="Trạng thái" value={data.row.bias === "neutral" ? "Chưa đủ xác nhận" : data.row.label} />
              <Metric label="Coin mới list" value={data.row.listingAgeDays === null ? "—" : `${data.row.listingAgeDays} ngày`} />
            </div>

            {data.row.reasons.length > 0 ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Vì sao bias này</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
                  {data.row.reasons.map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span className="text-cyan-400">•</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {data.row.warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
                {data.row.warnings.map((warning) => (
                  <p key={warning}>⚠ {warning}</p>
                ))}
              </div>
            ) : null}

            {data.setup ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">
                    Vùng tham khảo theo ATR ({data.setup.direction === "BULLISH" ? "long" : "short"})
                  </h3>
                  <span className="text-xs text-slate-500">R:R {data.setup.riskRewardRatio ?? "—"}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <Metric label="Entry" value={`${formatPrice(data.setup.entryLow)} – ${formatPrice(data.setup.entryHigh)}`} />
                  <Metric label="TP1" value={formatPrice(data.setup.tp1)} />
                  <Metric label="TP2" value={formatPrice(data.setup.tp2)} />
                  <Metric label="Stop" value={formatPrice(data.setup.stopLoss)} />
                  <Metric label="Giá hiện tại" value={formatPrice(data.row.price)} />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Mức giá suy ra từ ATR, không phải lệnh khuyến nghị. Kiểm tra funding và thanh khoản trước khi dùng.
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400">
                Chưa có setup: bias trung tính hoặc thiếu ATR/klines.
              </p>
            )}

            <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
                  <Sparkles className="h-4 w-4" /> AI brief (tuỳ chọn, có cache 10 phút)
                </h3>
                <button
                  onClick={requestBrief}
                  disabled={briefLoading}
                  className="flex items-center gap-2 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                >
                  {briefLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {brief ? "Tạo lại brief" : "Đọc setup này"}
                </button>
              </div>
              {briefError ? <p className="mt-2 text-xs text-rose-300">{briefError}</p> : null}
              {brief ? (
                <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{brief.text}</div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  LLM chỉ đọc đúng số liệu đang hiển thị để tóm tắt kịch bản và rủi ro. Mỗi lần gọi tốn quota provider.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrackRecord() {
  const { data, isLoading, error } = useQuery<TrackRecordResult>({
    queryKey: ["market-radar-track-record"],
    queryFn: () => getJson<TrackRecordResult>("/api/market/radar/track-record"),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-slate-200">Track record tín hiệu radar</h2>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">
          tự lưu · 14 ngày
        </span>
      </div>

      {isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang tính forward return…
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-rose-300">
          {error instanceof Error ? error.message : "Không đọc được track record."}
        </p>
      ) : !data || data.total === 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          Chưa có tín hiệu. Khi radar có coin score ≥ 55 và độ mới ≥ 40, tín hiệu sẽ được lưu tự động để đo 1–7 ngày sau.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.summaries.map((summary) => (
              <div key={summary.bias} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                <p className="text-[11px] text-slate-500">{summary.label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-100">
                  {summary.hitRate === null ? "—" : `${summary.hitRate}%`}
                  <span className="ml-1 text-xs font-normal text-slate-500">({summary.wins}/{summary.n})</span>
                </p>
                <p className={cn("text-[11px]", (summary.avgReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  TB {formatPct(summary.avgReturnPct)}
                </p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Coin</th>
                  <th className="py-1.5 pr-3 font-medium">Bias lúc ghi</th>
                  <th className="py-1.5 pr-3 font-medium">Score</th>
                  <th className="py-1.5 pr-3 font-medium">Giá lúc ghi</th>
                  <th className="py-1.5 pr-3 font-medium">Hiện tại</th>
                  <th className="py-1.5 pr-3 font-medium">Tuổi</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {data.recent.map((row) => (
                  <tr key={`${row.symbol}-${row.at}`} className="border-t border-slate-800/70">
                    <td className="py-1.5 pr-3 font-medium text-slate-200">${row.symbol}</td>
                    <td className="py-1.5 pr-3">{BIAS_LABELS[row.bias]}</td>
                    <td className="py-1.5 pr-3">{row.score}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{formatPrice(row.price)}</td>
                    <td className={cn("py-1.5 pr-3 tabular-nums", (row.returnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {row.returnPct === null ? "đang chạy" : formatPct(row.returnPct)}
                      {row.win === true ? " ✓" : row.win === false ? " ✗" : ""}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{row.ageHours}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">{data.note}</p>
        </div>
      )}
    </section>
  );
}

export default function RadarPage() {
  const [side, setSide] = useState<MoverSide>("gainer");
  const [minVolume, setMinVolume] = useState<number | undefined>(undefined);
  const [excludeSystem, setExcludeSystem] = useState(false);
  const [sort, setSort] = useState<RadarSort>("composite");
  const [selected, setSelected] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ["market-radar", side, minVolume ?? 0, excludeSystem, sort] as const,
    [side, minVolume, excludeSystem, sort]
  );

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery<RadarSnapshot>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ side, sort, limit: "20" });
      if (minVolume) params.set("minVolume", String(minVolume));
      if (excludeSystem) params.set("excludeSystem", "1");
      return getJson<RadarSnapshot>(`/api/market/movers?${params.toString()}`);
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: 1,
  });

  const activeTab = SIDE_TABS.find((tab) => tab.id === side) ?? SIDE_TABS[0];
  const rows = data?.rows ?? [];
  const updatedLabel = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("vi-VN") : "—";

  return (
    <main className="container mx-auto space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <RadarIcon className="h-5 w-5 text-cyan-400" />
            <h1 className="text-2xl font-semibold text-slate-100">Market Radar</h1>
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              Binance Futures · USDT perp
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {activeTab.hint} Coin ngoài narrative vẫn được quét — DB chỉ dùng để gắn badge.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>cập nhật {updatedLabel}</span>
          <button
            onClick={() => void refetch()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </button>
        </div>
      </header>

      {data?.demo ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <strong>Chế độ dữ liệu mẫu.</strong> {data.notice}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="BTC 24h"
          value={formatPct(data?.market.btcChangePct ?? null)}
          tone={(data?.market.btcChangePct ?? 0) >= 0 ? "up" : "down"}
        />
        <Stat label="Coin tăng / giảm" value={`${data?.market.gainers ?? "—"} / ${data?.market.losers ?? "—"}`} />
        <Stat label="Volume futures" value={data ? formatUsd(data.market.totalVolumeUsd) : "—"} />
        <Stat label="Universe đủ điều kiện" value={data ? `${data.market.universe} coin` : "—"} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-800 bg-slate-900/60 p-1">
          {SIDE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSide(tab.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                side === tab.id ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
              )}
            >
              {tab.id === "gainer" ? <TrendingUp className="h-3.5 w-3.5" /> : null}
              {tab.id === "loser" ? <TrendingDown className="h-3.5 w-3.5" /> : null}
              {tab.id === "unusual" ? <RadarIcon className="h-3.5 w-3.5" /> : null}
              {tab.label}
            </button>
          ))}
        </div>

        <select
          value={minVolume ?? 10_000_000}
          onChange={(e) => setMinVolume(Number(e.target.value))}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-300"
          aria-label="Volume tối thiểu 24h"
        >
          {VOLUME_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              Volume ≥ {option.label}
            </option>
          ))}
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RadarSort)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-300"
          aria-label="Sắp xếp"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={excludeSystem}
            onChange={(e) => setExcludeSystem(e.target.checked)}
            className="h-3.5 w-3.5 accent-cyan-500"
          />
          Chỉ coin ngoài hệ thống
        </label>

        <span className="ml-auto text-xs text-slate-500">{rows.length} coin</span>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
          {error instanceof Error ? error.message : "Không tải được dữ liệu radar."}
          <button onClick={() => void refetch()} className="ml-3 underline decoration-dotted">
            thử lại
          </button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Coin</th>
                <th className="px-3 py-3 font-medium">Giá</th>
                <th className="px-3 py-3 font-medium">24h</th>
                <th className="px-3 py-3 font-medium">Vị trí range</th>
                <th className="px-3 py-3 font-medium">Volume</th>
                <th className="px-3 py-3 font-medium">OI 24h</th>
                <th className="px-3 py-3 font-medium">Funding</th>
                <th className="px-3 py-3 font-medium">Bias</th>
                <th className="px-3 py-3 font-medium">Độ mới</th>
                <th className="px-3 py-3 font-medium">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Đang quét toàn bộ futures, lấy klines/OI/funding cho top coin…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">
                    Không có coin nào đạt ngưỡng ở tab này. Hạ volume tối thiểu hoặc bỏ lọc “ngoài hệ thống”.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.pair}
                    className="border-b border-slate-800/60 align-top transition-colors hover:bg-slate-800/30"
                  >
                    <td className="px-4 py-3">
                      <button onClick={() => setSelected(row.symbol)} className="text-left">
                        <span className="font-semibold text-slate-100">${row.symbol}</span>
                        <span className="ml-1 text-[10px] text-slate-500">{row.pair}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.inSystem ? (
                            <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] text-cyan-300">
                              Hệ thống{row.narratives.length ? ` · ${row.narratives[0]}` : ""}
                            </span>
                          ) : (
                            <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
                              Ngoài hệ thống
                            </span>
                          )}
                          {row.isBreakout7d ? (
                            <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                              Breakout 7d
                            </span>
                          ) : null}
                        </div>
                      </button>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-200">{formatPrice(row.price)}</td>
                    <td className={cn("px-3 py-3 tabular-nums font-medium", row.changePct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {formatPct(row.changePct)}
                      {row.changePct >= 0 ? (
                        <ArrowUpRight className="ml-1 inline h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="ml-1 inline h-3.5 w-3.5" />
                      )}
                      {row.changeAtrMultiple !== null ? (
                        <div className="text-[10px] font-normal text-slate-500">{row.changeAtrMultiple.toFixed(1)} ATR</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <RangeBar position={row.rangePosition} />
                      <div className="mt-1 text-[10px] text-slate-500">cách đỉnh {row.distanceFromHighPct.toFixed(1)}%</div>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-300">
                      {formatUsd(row.quoteVolume)}
                      <div className="text-[10px] text-slate-500">
                        {row.volumeRatio7d === null ? "—" : `${row.volumeRatio7d.toFixed(1)}× TB7d`}
                        {row.volumeZ !== null ? ` · z ${row.volumeZ.toFixed(1)}` : ""}
                      </div>
                    </td>
                    <td className={cn("px-3 py-3 tabular-nums", (row.oiChangePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {formatPct(row.oiChangePct)}
                    </td>
                    <td className={cn("px-3 py-3 tabular-nums", (row.fundingRate ?? 0) >= 0 ? "text-amber-300" : "text-cyan-300")}>
                      {formatFunding(row.fundingRate)}
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", biasClasses(row.bias))}>
                        {row.label}
                      </span>
                      <div className="mt-1 text-[10px] text-slate-500">score {row.score}/100</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              row.entryQuality >= 60 ? "bg-emerald-400" : row.entryQuality >= 35 ? "bg-amber-400" : "bg-rose-400"
                            )}
                            style={{ width: `${row.entryQuality}%` }}
                          />
                        </div>
                        <span className="text-[11px] tabular-nums text-slate-400">{row.entryQuality}</span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500">hợp {row.composite}</div>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => setSelected(row.symbol)}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 ? (
          <div className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
            Bấm tên coin hoặc “Chi tiết” để xem chart 4h, lý do bias, vùng giá theo ATR và AI brief.
          </div>
        ) : null}
      </section>

      <TrackRecord />

      <details className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5 text-sm text-slate-400">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-slate-300">
          <Info className="h-4 w-4 text-cyan-400" /> Cách đọc radar & giới hạn
        </summary>
        <div className="mt-3 space-y-2 text-xs leading-relaxed">
          <p>
            <strong className="text-slate-300">Tăng mạnh:</strong> bias “Tiếp diễn tăng” cần trend 4h, volume xác nhận,
            OI tăng và funding chưa nóng. “Kiệt sức” khi move đã đi nhiều ATR, funding cao, OI giảm hoặc RSI quá mua.
          </p>
          <p>
            <strong className="text-slate-300">Giảm sâu:</strong> “Bắt hồi (flush)” khi OI giảm mạnh + funding âm + RSI thấp
            (long bị thanh lý). “Tiếp diễn giảm” khi trend giảm nhưng OI vẫn tăng (short mới).
          </p>
          <p>
            <strong className="text-slate-300">Radar sớm:</strong> tìm volume z-score/OI bất thường khi giá chưa chạy và biên độ
            7 ngày nén. Đây là tín hiệu trước breakout nên có false positive; “Độ mới” càng cao càng ít phải đuổi giá.
          </p>
          <p>
            Dữ liệu public Binance Futures, cache 60 giây, top 10 mỗi bên được enrich klines/OI/funding. Coin mới list dưới{" "}
            {21} ngày bị loại. Không phải khuyến nghị đầu tư; funding/OI có thể đổi trước khi bạn vào lệnh.
          </p>
        </div>
      </details>

      {selected ? <DetailDrawer key={selected} symbol={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}
