"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Copy,
  Layers,
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
import type {
  RadarClusterSummary,
  RadarDetail,
  RadarSnapshot,
  RadarSort,
} from "@/lib/market/radar";
import { CatalystPanel } from "@/components/CatalystPanel";
import type { BriefResult } from "@/lib/market/brief";
import {
  HORIZONS,
  volumeBucketKey,
  volumeBucketLabel,
  type HorizonId,
  type TrackRecordResult,
} from "@/lib/market/ledger";

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
  { value: 100_000_000, label: "$100M" },
];

/**
 * Mốc gần nhất >= giá trị yêu cầu, khớp cách server làm tròn LÊN, để `<select>`
 * luôn có option hợp lệ kể cả khi URL mang giá trị thô (26M) hoặc vượt bucket
 * cao nhất (500M) — không bao giờ render select trống.
 */
function volumeOptionFor(value: number | undefined): number {
  if (value === undefined) return 10_000_000;
  return (
    VOLUME_OPTIONS.find((option) => option.value >= value)?.value ??
    VOLUME_OPTIONS[VOLUME_OPTIONS.length - 1].value
  );
}

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
              <Metric
                label="Impulse 1h"
                value={
                  data.row.impulseAgeHours === null || data.row.impulseAgeHours === undefined
                    ? "—"
                    : `${data.row.impulseAgeHours.toFixed(1)}h`
                }
                hint={
                  data.row.impulseExtensionAtr === null || data.row.impulseExtensionAtr === undefined
                    ? "Chưa có impulse"
                    : `Đã đi ${data.row.impulseExtensionAtr.toFixed(1)} ATR · ${data.row.impulseConsolidationBars ?? 0} nến nén`
                }
              />
              <Metric
                label="Spot / Perp"
                value={
                  data.row.spotLed === null || data.row.spotLed === undefined
                    ? "—"
                    : data.row.spotLed
                      ? "Spot dẫn"
                      : "Perp dẫn"
                }
                hint={
                  data.row.basisPct === null || data.row.basisPct === undefined
                    ? "Không có spot pair"
                    : `Basis ${data.row.basisPct.toFixed(2)}% · spot ${formatPct(data.row.spotChangePct ?? null)}`
                }
              />
              <Metric
                label="Cluster"
                value={data.row.clusterLabel ?? "—"}
                hint={
                  data.row.clusterLabel
                    ? `${data.row.clusterSize} coin${data.row.clusterLeader ? " · leader" : data.row.clusterLaggard ? " · laggard" : ""}`
                    : "Chỉ tính trong cohort ở bảng radar"
                }
              />
              <Metric
                label="RS vs BTC"
                value={formatPct(data.row.relativeStrengthPct ?? null)}
                hint={`percentile ${data.row.rsPercentile ?? "—"}`}
              />
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
                  <span className="text-xs text-slate-500">
                    R:R {data.setup.riskRewardRatio ?? "—"}
                    {data.netRiskRewardRatio !== null && data.netRiskRewardRatio !== undefined
                      ? ` · net ${data.netRiskRewardRatio}`
                      : ""}
                  </span>
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

            {data.liquidity ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-200">Thanh khoản & slippage</h3>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px]",
                      data.liquidity.thin
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    )}
                  >
                    {data.liquidity.thin ? "sổ lệnh mỏng" : "đủ thanh khoản"}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric
                    label="Spread"
                    value={data.liquidity.spreadBps === null ? "—" : `${data.liquidity.spreadBps} bps`}
                  />
                  <Metric label="Depth ±1%" value={formatUsd(data.liquidity.depthUsd1Pct)} />
                  <Metric
                    label="Slippage $10k"
                    value={
                      data.liquidity.buySlippageBps.find((s) => s.sizeUsd === 10_000)?.bps === null ||
                      data.liquidity.buySlippageBps.find((s) => s.sizeUsd === 10_000)?.bps === undefined
                        ? "—"
                        : `${data.liquidity.buySlippageBps.find((s) => s.sizeUsd === 10_000)?.bps} bps`
                    }
                  />
                  <Metric
                    label="Slippage $50k"
                    value={
                      data.liquidity.buySlippageBps.find((s) => s.sizeUsd === 50_000)?.bps === null ||
                      data.liquidity.buySlippageBps.find((s) => s.sizeUsd === 50_000)?.bps === undefined
                        ? "—"
                        : `${data.liquidity.buySlippageBps.find((s) => s.sizeUsd === 50_000)?.bps} bps`
                    }
                  />
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Slippage ước tính khi mua theo ask; net R:R đã trừ phí taker 0.1%.
                </p>
              </div>
            ) : null}

            {data.row.catalystTriggered ? <CatalystPanel symbol={data.row.symbol} /> : null}

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

/**
 * Chip bucket `minVolume` của một nhóm trong track-record. Chỉ render khi cohort
 * trộn nhiều bucket, nên chưa đổi ngưỡng volume thì bảng giữ nguyên như cũ.
 */
function VolumeBucketBadge({ minVolume }: { minVolume?: number }) {
  return (
    <span
      className="shrink-0 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-[9px] font-normal text-slate-400"
      title="Bucket lọc volume 24h đã áp khi ghi tín hiệu — không gộp chung với bucket khác"
    >
      {volumeBucketLabel(minVolume)}
    </span>
  );
}

function TrackRecord() {
  const [horizon, setHorizon] = useState<HorizonId>("24h");
  const { data, isLoading, error } = useQuery<TrackRecordResult>({
    queryKey: ["market-radar-track-record"],
    queryFn: () => getJson<TrackRecordResult>("/api/market/radar/track-record"),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const horizonMeta = HORIZONS.find((h) => h.id === horizon) ?? HORIZONS[2];
  const summaries = data?.summaries ?? [];
  const clusterSummaries = data?.clusterSummaries ?? [];
  // Chỉ hiện chip bucket khi cohort thật sự trộn nhiều bucket; nhóm tín hiệu cũ
  // chưa có `minVolume` vào nhóm riêng và xếp cuối.
  const catalystGroups = (data?.catalyst ?? []).filter((group) => group.labeled > 0);
  const showBiasBuckets = new Set(summaries.map((row) => volumeBucketKey(row.minVolume))).size > 1;
  const showClusterBuckets =
    new Set(clusterSummaries.map((row) => volumeBucketKey(row.minVolume))).size > 1;
  const showCatalystBuckets = catalystGroups.length > 1;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-slate-200">Signal Ledger — forward return</h2>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-500">
          cohort 8 ngày · cả neutral
        </span>
        {data?.demo ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
            dữ liệu mẫu
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1">
          {HORIZONS.map((item) => (
            <button
              key={item.id}
              onClick={() => setHorizon(item.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium",
                horizon === item.id ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang đo {horizonMeta.label}…
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-rose-300">
          {error instanceof Error ? error.message : "Không đọc được track record."}
        </p>
      ) : !data || data.total === 0 ? (
        <p className="mt-3 text-xs text-slate-400">
          Chưa có cohort nào. Mỗi ngày radar lưu tối đa 12 row/bên (kể cả neutral) để đo 1h/4h/24h/3d/7d.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span>{data.total} tín hiệu · {data.actionable} actionable</span>
            <span>· {horizonMeta.label} đã đủ tuổi: {summaries.reduce((n, s) => n + (s.horizons.find((h) => h.horizon === horizon)?.n ?? 0), 0)}</span>
            <span>· BTC làm mốc relative</span>
          </div>

          {/* Mobile: card theo bias thay vì vuốt ngang. */}
          <div className="space-y-2 sm:hidden">
            {summaries.map((summary) => {
              const h = summary.horizons.find((item) => item.horizon === horizon);
              return (
                <div
                  key={`${summary.bias}|${volumeBucketKey(summary.minVolume)}`}
                  className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium text-slate-100">{summary.label}</p>
                      {showBiasBuckets ? <VolumeBucketBadge minVolume={summary.minVolume} /> : null}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-sm font-semibold tabular-nums",
                        (h?.avgReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                      )}
                    >
                      {h?.avgReturnPct === null || h?.avgReturnPct === undefined
                        ? "—"
                        : formatPct(h.avgReturnPct)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                    <div>
                      <dt className="text-slate-500">N</dt>
                      <dd className="tabular-nums text-slate-200">{h?.n ?? 0}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Hit rate</dt>
                      <dd className="tabular-nums text-slate-200">
                        {h?.hitRate === null || h?.hitRate === undefined ? "—" : `${h.hitRate}%`}
                        {h && h.n > 0 ? <span className="ml-1 text-slate-600">({h.n})</span> : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Vs BTC</dt>
                      <dd
                        className={cn(
                          "tabular-nums",
                          (h?.avgRelativePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {h?.avgRelativePct === null || h?.avgRelativePct === undefined
                          ? "—"
                          : formatPct(h.avgRelativePct)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11px] text-slate-500">
                    MFE/MAE{" "}
                    {h?.avgMfePct === null || h?.avgMfePct === undefined ? "—" : formatPct(h.avgMfePct)}
                    {" / "}
                    {h?.avgMaePct === null || h?.avgMaePct === undefined ? "—" : formatPct(h.avgMaePct)}
                    {" · "}TP1/SL{" "}
                    {h?.tp1HitRate === null || h?.tp1HitRate === undefined ? "—" : `${h.tp1HitRate}%`}
                    {" / "}
                    {h?.slHitRate === null || h?.slHitRate === undefined ? "—" : `${h.slHitRate}%`}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-slate-800 sm:block">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Bias</th>
                  <th className="px-3 py-2 font-medium">N</th>
                  <th className="px-3 py-2 font-medium">Hit rate</th>
                  <th className="px-3 py-2 font-medium">Return TB</th>
                  <th className="px-3 py-2 font-medium">Vs BTC</th>
                  <th className="px-3 py-2 font-medium">MFE / MAE</th>
                  <th className="px-3 py-2 font-medium">TP1 / SL</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {summaries.map((summary) => {
                  const h = summary.horizons.find((item) => item.horizon === horizon);
                  return (
                    <tr
                      key={`${summary.bias}|${volumeBucketKey(summary.minVolume)}`}
                      className="border-t border-slate-800/70"
                    >
                      <td className="px-3 py-2 font-medium text-slate-200">
                        <span className="inline-flex items-center gap-1.5">
                          {summary.label}
                          {showBiasBuckets ? <VolumeBucketBadge minVolume={summary.minVolume} /> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{h?.n ?? 0}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {h?.hitRate === null || h?.hitRate === undefined ? "—" : `${h.hitRate}%`}
                        {h && h.n > 0 ? <span className="ml-1 text-slate-600">({h.n})</span> : null}
                      </td>
                      <td className={cn("px-3 py-2 tabular-nums", (h?.avgReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {h?.avgReturnPct === null || h?.avgReturnPct === undefined ? "—" : formatPct(h.avgReturnPct)}
                      </td>
                      <td className={cn("px-3 py-2 tabular-nums", (h?.avgRelativePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {h?.avgRelativePct === null || h?.avgRelativePct === undefined ? "—" : formatPct(h.avgRelativePct)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-400">
                        {h?.avgMfePct === null || h?.avgMfePct === undefined ? "—" : formatPct(h.avgMfePct)}
                        {" / "}
                        {h?.avgMaePct === null || h?.avgMaePct === undefined ? "—" : formatPct(h.avgMaePct)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-400">
                        {h?.tp1HitRate === null || h?.tp1HitRate === undefined ? "—" : `${h.tp1HitRate}%`}
                        {" / "}
                        {h?.slHitRate === null || h?.slHitRate === undefined ? "—" : `${h.slHitRate}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.clusterSummaries && data.clusterSummaries.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-violet-200">Hiệu quả theo cụm rotation</p>
              {/* Mobile: card theo cụm thay vì bắt vuốt ngang 7 cột. */}
              <div className="space-y-2 sm:hidden">
                {data.clusterSummaries.map((cluster) => {
                  const h = cluster.horizons.find((item) => item.horizon === horizon);
                  const roleLabel =
                    cluster.role === "leader" ? "Leader" : cluster.role === "laggard" ? "Laggard" : "Khác";
                  return (
                    <div
                      key={cluster.key}
                      className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-slate-100">{cluster.label}</p>
                            {showClusterBuckets ? (
                              <VolumeBucketBadge minVolume={cluster.minVolume} />
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {cluster.side} · {roleLabel}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 text-sm font-semibold tabular-nums",
                            (h?.avgReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                          )}
                        >
                          {h?.avgReturnPct === null || h?.avgReturnPct === undefined
                            ? "—"
                            : formatPct(h.avgReturnPct)}
                        </span>
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <dt className="text-slate-500">N</dt>
                          <dd className="tabular-nums text-slate-200">{h?.n ?? 0}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Hit rate</dt>
                          <dd className="tabular-nums text-slate-200">
                            {h?.hitRate === null || h?.hitRate === undefined ? "—" : `${h.hitRate}%`}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Vs BTC</dt>
                          <dd
                            className={cn(
                              "tabular-nums",
                              (h?.avgRelativePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                            )}
                          >
                            {h?.avgRelativePct === null || h?.avgRelativePct === undefined
                              ? "—"
                              : formatPct(h.avgRelativePct)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto rounded-lg border border-violet-500/20 sm:block">
                <table className="w-full min-w-[620px] text-left text-xs">
                  <thead className="bg-violet-500/5 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Cụm</th>
                      <th className="px-3 py-2 font-medium">Side</th>
                      <th className="px-3 py-2 font-medium">Vai trò</th>
                      <th className="px-3 py-2 font-medium">N</th>
                      <th className="px-3 py-2 font-medium">Hit rate</th>
                      <th className="px-3 py-2 font-medium">Return TB</th>
                      <th className="px-3 py-2 font-medium">Vs BTC</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {data.clusterSummaries.map((cluster) => {
                      const h = cluster.horizons.find((item) => item.horizon === horizon);
                      return (
                        <tr key={cluster.key} className="border-t border-violet-500/10">
                          <td className="px-3 py-2 font-medium text-slate-200">
                            <span className="inline-flex items-center gap-1.5">
                              {cluster.label}
                              {showClusterBuckets ? (
                                <VolumeBucketBadge minVolume={cluster.minVolume} />
                              ) : null}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-400">{cluster.side}</td>
                          <td className="px-3 py-2 text-slate-400">
                            {cluster.role === "leader" ? "Leader" : cluster.role === "laggard" ? "Laggard" : "Khác"}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{h?.n ?? 0}</td>
                          <td className="px-3 py-2 tabular-nums">
                            {h?.hitRate === null || h?.hitRate === undefined ? "—" : `${h.hitRate}%`}
                          </td>
                          <td className={cn("px-3 py-2 tabular-nums", (h?.avgReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {h?.avgReturnPct === null || h?.avgReturnPct === undefined ? "—" : formatPct(h.avgReturnPct)}
                          </td>
                          <td className={cn("px-3 py-2 tabular-nums", (h?.avgRelativePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                            {h?.avgRelativePct === null || h?.avgRelativePct === undefined ? "—" : formatPct(h.avgRelativePct)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {catalystGroups.map((group) => (
            <div
              key={`catalyst|${volumeBucketKey(group.minVolume)}`}
              className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-violet-200">
                  Catalyst có giúp outlier đi tiếp? (chỉ phân tích, không vào scoring)
                </h3>
                {showCatalystBuckets ? <VolumeBucketBadge minVolume={group.minVolume} /> : null}
                <span className="text-[10px] text-slate-500">
                  {group.withCatalyst} có catalyst · {group.withoutCatalyst} không ·{" "}
                  {group.unlabeled} chưa gắn nhãn
                </span>
              </div>
              {/* Mobile: mỗi horizon một card, không phải vuốt ngang. */}
              <div className="mt-2 space-y-2 sm:hidden">
                {group.horizons.map((row) => (
                  <div key={row.horizon} className="rounded-lg border border-violet-500/20 bg-slate-950/40 p-3">
                    <p className="text-xs font-semibold text-slate-200">
                      {HORIZONS.find((h) => h.id === row.horizon)?.label ?? row.horizon}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <p className="text-slate-500">Có catalyst</p>
                        <p className="tabular-nums text-slate-200">
                          {row.withCatalyst.n > 0
                            ? `${row.withCatalyst.avgReturnPct === null ? "—" : formatPct(row.withCatalyst.avgReturnPct)} · ${
                                row.withCatalyst.hitRate ?? "—"
                              }% (${row.withCatalyst.n})`
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Không</p>
                        <p className="tabular-nums text-slate-200">
                          {row.withoutCatalyst.n > 0
                            ? `${row.withoutCatalyst.avgReturnPct === null ? "—" : formatPct(row.withoutCatalyst.avgReturnPct)} · ${
                                row.withoutCatalyst.hitRate ?? "—"
                              }% (${row.withoutCatalyst.n})`
                            : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800/60 pt-2 text-[11px]">
                      <span className="text-slate-500">
                        Δ return{" "}
                        <span
                          className={cn(
                            "font-medium tabular-nums",
                            (row.deltaAvgReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                          )}
                        >
                          {row.deltaAvgReturnPct === null ? "—" : formatPct(row.deltaAvgReturnPct)}
                        </span>
                      </span>
                      <span className="text-slate-500">
                        Δ hit rate{" "}
                        <span
                          className={cn(
                            "font-medium tabular-nums",
                            (row.deltaHitRate ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                          )}
                        >
                          {row.deltaHitRate === null
                            ? "—"
                            : `${row.deltaHitRate > 0 ? "+" : ""}${row.deltaHitRate} điểm`}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Horizon</th>
                      <th className="py-1.5 pr-3 font-medium">Có catalyst</th>
                      <th className="py-1.5 pr-3 font-medium">Không</th>
                      <th className="py-1.5 pr-3 font-medium">Δ return TB</th>
                      <th className="py-1.5 font-medium">Δ hit rate</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {group.horizons.map((row) => (
                      <tr key={row.horizon} className="border-t border-slate-800/70">
                        <td className="py-1.5 pr-3 text-slate-400">
                          {HORIZONS.find((h) => h.id === row.horizon)?.label ?? row.horizon}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {row.withCatalyst.n > 0
                            ? `${row.withCatalyst.avgReturnPct === null ? "—" : formatPct(row.withCatalyst.avgReturnPct)} · ${
                                row.withCatalyst.hitRate ?? "—"
                              }% (${row.withCatalyst.n})`
                            : "—"}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {row.withoutCatalyst.n > 0
                            ? `${row.withoutCatalyst.avgReturnPct === null ? "—" : formatPct(row.withoutCatalyst.avgReturnPct)} · ${
                                row.withoutCatalyst.hitRate ?? "—"
                              }% (${row.withoutCatalyst.n})`
                            : "—"}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 pr-3 tabular-nums",
                            (row.deltaAvgReturnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                          )}
                        >
                          {row.deltaAvgReturnPct === null ? "—" : formatPct(row.deltaAvgReturnPct)}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 tabular-nums",
                            (row.deltaHitRate ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                          )}
                        >
                          {row.deltaHitRate === null
                            ? "—"
                            : `${row.deltaHitRate > 0 ? "+" : ""}${row.deltaHitRate} điểm`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{group.note}</p>
            </div>
          ))}

          {/* Mobile: ledger gần đây dạng card, không vuốt ngang 9 cột. */}
          <div className="space-y-2 sm:hidden">
            {data.recent.map((row) => {
              const h = row.horizons[horizon];
              return (
                <div
                  key={`${row.symbol}-${row.bias}-${row.at}`}
                  className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-100">
                        ${row.symbol}
                        {!row.actionable ? (
                          <span className="ml-1 rounded border border-slate-700 px-1 py-0.5 text-[9px] text-slate-500">
                            watch
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {BIAS_LABELS[row.bias]} · score {row.score} · ${formatPrice(row.price)}
                      </p>
                      {row.biasChanged && row.prevBias ? (
                        <p className="mt-0.5 text-[10px] text-amber-300">
                          Lật nhãn: {BIAS_LABELS[row.prevBias]} → {BIAS_LABELS[row.bias]}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          (h?.returnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {h?.pending
                          ? "pending"
                          : h?.returnPct === null || h?.returnPct === undefined
                            ? "—"
                            : formatPct(h.returnPct)}
                        {h?.win === true ? " ✓" : h?.win === false ? " ✗" : ""}
                      </p>
                      <p className="text-[11px] text-slate-500">{row.ageHours}h</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                    <span>
                      Vs BTC{" "}
                      <span
                        className={cn(
                          "tabular-nums",
                          (h?.relativePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {h?.relativePct === null || h?.relativePct === undefined
                          ? "—"
                          : formatPct(h.relativePct)}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      MFE/MAE{" "}
                      {h?.mfePct === null || h?.mfePct === undefined ? "—" : formatPct(h.mfePct)}
                      {" / "}
                      {h?.maePct === null || h?.maePct === undefined ? "—" : formatPct(h.maePct)}
                    </span>
                    <span>
                      {h?.firstEvent === "tp"
                        ? "TP trước"
                        : h?.firstEvent === "sl"
                          ? "SL trước"
                          : h?.firstEvent === "ambiguous"
                            ? "cùng nến"
                            : h?.pending
                              ? "—"
                              : "chưa chạm"}
                    </span>
                    <span className="tabular-nums" title={row.invalidationNote ?? undefined}>
                      Vô hiệu{" "}
                      {row.invalidationPrice === null || row.invalidationPrice === undefined
                        ? "—"
                        : formatPrice(row.invalidationPrice)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Coin</th>
                  <th className="py-1.5 pr-3 font-medium">Bias lúc ghi</th>
                  <th className="py-1.5 pr-3 font-medium">Vô hiệu</th>
                  <th className="py-1.5 pr-3 font-medium">Score</th>
                  <th className="py-1.5 pr-3 font-medium">Giá lúc ghi</th>
                  <th className="py-1.5 pr-3 font-medium">{horizonMeta.label}</th>
                  <th className="py-1.5 pr-3 font-medium">Vs BTC</th>
                  <th className="py-1.5 pr-3 font-medium">MFE / MAE</th>
                  <th className="py-1.5 pr-3 font-medium">TP/SL</th>
                  <th className="py-1.5 pr-3 font-medium">Tuổi</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {data.recent.map((row) => {
                  const h = row.horizons[horizon];
                  return (
                    <tr key={`${row.symbol}-${row.bias}-${row.at}`} className="border-t border-slate-800/70">
                      <td className="py-1.5 pr-3 font-medium text-slate-200">
                        ${row.symbol}
                        {!row.actionable ? (
                          <span className="ml-1 rounded border border-slate-700 px-1 py-0.5 text-[9px] text-slate-500">watch</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3">
                        {BIAS_LABELS[row.bias]}
                        {row.biasChanged && row.prevBias ? (
                          <span className="ml-1 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-300">
                            lật từ {BIAS_LABELS[row.prevBias]}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="py-1.5 pr-3 tabular-nums text-slate-400"
                        title={row.invalidationNote ?? undefined}
                      >
                        {row.invalidationPrice === null || row.invalidationPrice === undefined
                          ? "—"
                          : formatPrice(row.invalidationPrice)}
                      </td>
                      <td className="py-1.5 pr-3">{row.score}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{formatPrice(row.price)}</td>
                      <td className={cn("py-1.5 pr-3 tabular-nums", (h?.returnPct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {h?.pending ? "pending" : h?.returnPct === null || h?.returnPct === undefined ? "—" : formatPct(h.returnPct)}
                        {h?.win === true ? " ✓" : h?.win === false ? " ✗" : ""}
                      </td>
                      <td className={cn("py-1.5 pr-3 tabular-nums", (h?.relativePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {h?.relativePct === null || h?.relativePct === undefined ? "—" : formatPct(h.relativePct)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-slate-400">
                        {h?.mfePct === null || h?.mfePct === undefined ? "—" : formatPct(h.mfePct)}
                        {" / "}
                        {h?.maePct === null || h?.maePct === undefined ? "—" : formatPct(h.maePct)}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-400">
                        {h?.firstEvent === "tp" ? "TP trước" : h?.firstEvent === "sl" ? "SL trước" : h?.firstEvent === "ambiguous" ? "cùng nến" : h?.pending ? "—" : "chưa chạm"}
                      </td>
                      <td className="py-1.5 pr-3 text-slate-500">{row.ageHours}h</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">{data.note}</p>
        </div>
      )}
    </section>
  );
}

function ClusterView({
  cluster,
  side,
  copied,
  onClose,
  onCopy,
  onSelectMember,
}: {
  cluster: RadarClusterSummary;
  side: MoverSide;
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
  onSelectMember: (symbol: string) => void;
}) {
  const sideLabel = SIDE_TABS.find((tab) => tab.id === side)?.label ?? side;

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/70 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="mx-auto min-h-full w-full max-w-3xl overflow-hidden border-violet-500/30 bg-slate-950 shadow-2xl sm:min-h-0 sm:rounded-2xl sm:border"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-4 sm:p-5">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-violet-300">
              <Layers className="h-3.5 w-3.5" /> Cụm rotation · {sideLabel}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-100 sm:text-2xl">{cluster.label}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {cluster.size} coin · TB {formatPct(cluster.avgChangePct)} ·{" "}
              {formatUsd(cluster.totalVolumeUsd)}
              {cluster.leader ? ` · leader $${cluster.leader}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Đóng cụm"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 sm:p-5">
          <Stat label="Số member" value={String(cluster.size)} />
          <Stat
            label="Biến động TB 24h"
            value={formatPct(cluster.avgChangePct)}
            tone={cluster.direction === "up" ? "up" : "down"}
          />
          <Stat label="Tổng volume 24h" value={formatUsd(cluster.totalVolumeUsd)} />
          <Stat label="Leader" value={cluster.leader ? `$${cluster.leader}` : "—"} />
        </div>

        {/* Mobile: mỗi member một hàng card, không vuốt ngang. */}
        <div className="space-y-2 px-4 pb-24 sm:hidden sm:pb-4">
          {cluster.members.map((member) => {
            const isLeader = member.leader ?? member.symbol === cluster.leader;
            const isLaggard =
              member.laggard ??
              (!isLeader && (cluster.direction === "up" ? member.changePct > 0 : member.changePct < 0));
            const roleLabel = isLeader ? "Leader" : isLaggard ? "Laggard" : "Khác chiều";
            return (
              <div
                key={member.symbol}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-100">${member.symbol}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    <span className="tabular-nums">{formatUsd(member.quoteVolumeUsd)}</span> · {roleLabel}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      member.changePct >= 0 ? "text-emerald-400" : "text-rose-400"
                    )}
                  >
                    {formatPct(member.changePct)}
                  </span>
                  <button
                    onClick={() => onSelectMember(member.symbol)}
                    className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                  >
                    Mở coin
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden px-4 pb-4 sm:block sm:px-5">
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/60 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Coin</th>
                  <th className="px-3 py-2.5 font-medium">24h</th>
                  <th className="px-3 py-2.5 font-medium">Volume 24h</th>
                  <th className="px-3 py-2.5 font-medium">Vai trò</th>
                  <th className="px-3 py-2.5 text-right font-medium">Chi tiết</th>
                </tr>
              </thead>
              <tbody>
                {cluster.members.map((member) => {
                  const isLeader = member.leader ?? member.symbol === cluster.leader;
                  const isLaggard =
                    member.laggard ??
                    (!isLeader &&
                      (cluster.direction === "up" ? member.changePct > 0 : member.changePct < 0));
                  const roleLabel = isLeader ? "Leader" : isLaggard ? "Laggard" : "Khác chiều";
                  return (
                    <tr
                      key={member.symbol}
                      className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30"
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-100">${member.symbol}</td>
                      <td
                        className={cn(
                          "px-3 py-2.5 tabular-nums font-medium",
                          member.changePct >= 0 ? "text-emerald-400" : "text-rose-400"
                        )}
                      >
                        {formatPct(member.changePct)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-300">
                        {formatUsd(member.quoteVolumeUsd)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px]",
                            isLeader
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                              : "border-slate-700 bg-slate-900 text-slate-400"
                          )}
                        >
                          {roleLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => onSelectMember(member.symbol)}
                          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
                        >
                          Mở coin
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 p-4 sm:px-5">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Hiển thị đủ {cluster.size} member · tương quan return 1h. Bấm “Mở coin” để xem chart và bias.
          </p>
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? "Đã copy" : "Copy link cụm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RadarScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sideParam = searchParams.get("side");
  const sortParam = searchParams.get("sort");
  const volumeParam = Number(searchParams.get("minVolume"));
  const initialSort: RadarSort =
    sortParam === "fresh" || sortParam === "change" || sortParam === "volume" ? sortParam : "composite";

  const [side, setSide] = useState<MoverSide>(
    sideParam === "loser" || sideParam === "unusual" ? sideParam : "gainer"
  );
  const [minVolume, setMinVolume] = useState<number | undefined>(
    Number.isFinite(volumeParam) && volumeParam > 0 ? volumeParam : undefined
  );
  const [excludeSystem, setExcludeSystem] = useState(searchParams.get("excludeSystem") === "1");
  const [sort, setSort] = useState<RadarSort>(initialSort);
  const [selected, setSelected] = useState<string | null>(searchParams.get("symbol"));
  const [copied, setCopied] = useState(false);

  // URL là nguồn sự thật duy nhất của `?cluster=` (RADAR-05 bước 4): mở link,
  // back/forward hay đổi cluster đều đi qua router.replace → searchParams.
  const clusterId = searchParams.get("cluster");

  const queryKey = useMemo(
    () => ["market-radar", side, minVolume ?? 0, excludeSystem, sort, clusterId ?? ""] as const,
    [side, minVolume, excludeSystem, sort, clusterId]
  );

  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useQuery<RadarSnapshot>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ side, sort, limit: "20" });
      if (minVolume) params.set("minVolume", String(minVolume));
      if (excludeSystem) params.set("excludeSystem", "1");
      // Server ghim cụm của permalink vào snapshot để cụm ngoài top 6 vẫn mở được.
      if (clusterId) params.set("cluster", clusterId);
      return getJson<RadarSnapshot>(`/api/market/movers?${params.toString()}`);
    },
    refetchInterval: 90_000,
    staleTime: 60_000,
    retry: 1,
  });

  const activeTab = SIDE_TABS.find((tab) => tab.id === side) ?? SIDE_TABS[0];
  const rows = data?.rows ?? [];
  const activeCluster = clusterId
    ? (data?.clusters?.find((cluster) => cluster.id === clusterId) ?? null)
    : null;
  const updatedLabel = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("vi-VN") : "—";

  // Select phải nói đúng bucket server đã áp mà KHÔNG đồng bộ state: URL có thể
  // mang giá trị thô (26M) hoặc không có gì (env 25M), trong khi filter thật là
  // bucket server làm tròn lên. Dẫn xuất ngay khi render để tránh request thứ
  // hai (state đổi → query key đổi) và tránh select trống với URL lạ.
  const volumeSelectValue = volumeOptionFor(data?.minVolume ?? minVolume);

  const radarHref = (
    clusterIdValue: string | null = clusterId,
    symbolValue: string | null = selected
  ) => {
    const params = new URLSearchParams({ side, sort });
    const effectiveMinVolume = data?.minVolume ?? minVolume;
    if (effectiveMinVolume) params.set("minVolume", String(effectiveMinVolume));
    if (excludeSystem) params.set("excludeSystem", "1");
    if (clusterIdValue) params.set("cluster", clusterIdValue);
    if (symbolValue) params.set("symbol", symbolValue);
    return `/radar?${params.toString()}`;
  };

  const copyPermalink = async (
    clusterIdValue: string | null = clusterId,
    symbolValue: string | null = selected
  ) => {
    const url = new URL(radarHref(clusterIdValue, symbolValue), window.location.origin);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const openCluster = (id: string) => {
    setSelected(null);
    router.replace(radarHref(id, null), { scroll: false });
  };

  const closeCluster = () => {
    router.replace(radarHref(null, selected), { scroll: false });
  };

  return (
    <main className="space-y-4 py-4 sm:space-y-5 sm:py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <RadarIcon className="h-5 w-5 shrink-0 text-cyan-400" />
            <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Market Radar</h1>
            <span className="hidden rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 sm:inline-block">
              Binance Futures · USDT perp
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            {activeTab.hint} Coin ngoài narrative vẫn được quét — DB chỉ dùng để gắn badge.
          </p>
          {data ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 font-medium",
                  data.market.regime === "risk-on"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : data.market.regime === "risk-off"
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                      : "border-slate-700 bg-slate-900 text-slate-300"
                )}
              >
                Regime: {data.market.regime}
              </span>
              <span>BTC 4h: {data.market.btcTrend ?? "—"}</span>
              <span>Breadth: {data.market.breadthPct ?? "—"}%</span>
            </div>
          ) : null}
        </div>
        <div className="flex w-full items-center gap-2 text-xs text-slate-500 sm:w-auto">
          <span className="mr-auto sm:mr-0">cập nhật {updatedLabel}</span>
          <button
            onClick={() => void copyPermalink()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800 sm:py-1.5"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? "Đã copy" : "Copy link"}
          </button>
          <button
            onClick={() => void refetch()}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800 sm:py-1.5"
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

      {clusterId && data && !activeCluster ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <span>Cụm trong link không còn trong snapshot hiện tại (dữ liệu radar đổi mỗi 60 giây).</span>
          <button onClick={closeCluster} className="underline decoration-dotted">
            Về danh sách cụm
          </button>
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

      {data?.clusters && data.clusters.length > 0 ? (
        <section className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-violet-200">
              <Layers className="h-4 w-4" /> Cụm rotation — quét ngoài top
            </h2>
            <span className="text-[11px] text-slate-500">
              Tương quan 1h · bấm cụm để mở link · gồm coin ngoài {rows.length} rows
            </span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.clusters.map((cluster) => (
              <div key={cluster.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-medium text-slate-200">{cluster.label}</p>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] tabular-nums",
                      cluster.direction === "up" ? "text-emerald-400" : "text-rose-400"
                    )}
                  >
                    {cluster.size} coin · {formatPct(cluster.avgChangePct)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {cluster.members.slice(0, 6).map((member) => (
                    <button
                      key={member.symbol}
                      onClick={() => setSelected(member.symbol)}
                      className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-violet-500/50 hover:text-violet-200"
                    >
                      ${member.symbol}{" "}
                      <span className={member.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                        {formatPct(member.changePct)}
                      </span>
                    </button>
                  ))}
                  {cluster.members.length > 6 ? (
                    <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
                      +{cluster.members.length - 6}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[10px] text-slate-500">
                    {cluster.leader ? `Leader: $${cluster.leader}` : " "}
                  </p>
                  <a
                    href={radarHref(cluster.id, null)}
                    onClick={(event) => {
                      event.preventDefault();
                      openCluster(cluster.id);
                    }}
                    className="inline-block py-1 text-[11px] font-medium text-violet-300 hover:text-violet-200"
                  >
                    Xem đủ {cluster.size} coin →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
          value={volumeSelectValue}
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

      <section className="hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] text-left text-sm">
            <thead className="border-b border-slate-800 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Coin</th>
                <th className="px-3 py-3 font-medium">Giá</th>
                <th className="px-3 py-3 font-medium">24h</th>
                <th className="px-3 py-3 font-medium">Vị trí range</th>
                <th className="px-3 py-3 font-medium">Volume</th>
                <th className="px-3 py-3 font-medium">OI 24h</th>
                <th className="px-3 py-3 font-medium">Funding</th>
                <th className="px-3 py-3 font-medium">Impulse</th>
                <th className="px-3 py-3 font-medium">RS vs BTC</th>
                <th className="px-3 py-3 font-medium">Bias</th>
                <th className="px-3 py-3 font-medium">Độ mới</th>
                <th className="px-3 py-3 font-medium">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-sm text-slate-400">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Đang quét toàn bộ futures, lấy klines/OI/funding cho top coin…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-sm text-slate-400">
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
                          {row.clusterLabel ? (
                            <span className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                              <Layers className="h-2.5 w-2.5" />
                              {row.clusterLabel} · {row.clusterSize}
                              {row.clusterLeader ? " · leader" : row.clusterLaggard ? " · laggard" : ""}
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
                    <td className="px-3 py-3 tabular-nums text-slate-300">
                      {row.impulseAgeHours === null || row.impulseAgeHours === undefined ? (
                        "—"
                      ) : (
                        <>
                          {row.impulseAgeHours.toFixed(1)}h
                          <div className="text-[10px] text-slate-500">
                            ext {row.impulseExtensionAtr?.toFixed(1) ?? "—"} ATR
                          </div>
                        </>
                      )}
                      <div className={cn("text-[10px]", row.spotLed ? "text-emerald-400" : row.spotLed === false ? "text-slate-500" : "text-slate-600")}>
                        {row.spotLed === true ? "spot dẫn" : row.spotLed === false ? "perp dẫn" : "—"}
                      </div>
                    </td>
                    <td className={cn("px-3 py-3 tabular-nums", (row.relativeStrengthPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                      {formatPct(row.relativeStrengthPct ?? null)}
                      <div className="text-[10px] text-slate-500">p{row.rsPercentile ?? "—"}</div>
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

      <section className="space-y-2 md:hidden">
        {isLoading ? (
          <p className="rounded-xl border border-slate-800 p-4 text-sm text-slate-400">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Đang quét thị trường…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-slate-800 p-4 text-sm text-slate-400">
            Không có coin nào đạt ngưỡng ở tab này.
          </p>
        ) : (
          rows.map((row) => (
            <button
              key={row.pair}
              onClick={() => setSelected(row.symbol)}
              className="w-full rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-100">${row.symbol}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px]", biasClasses(row.bias))}>
                      {row.label}
                    </span>
                    {row.clusterLabel ? (
                      <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                        {row.clusterLabel} · {row.clusterSize}
                      </span>
                    ) : null}
                    {row.spotLed ? (
                      <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        spot dẫn
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("font-semibold tabular-nums", row.changePct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {formatPct(row.changePct)}
                  </p>
                  <p className="text-xs tabular-nums text-slate-400">{formatPrice(row.price)}</p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                <div>
                  <p className="text-slate-500">Volume</p>
                  <p className="text-slate-200">{formatUsd(row.quoteVolume)}</p>
                  <p>{row.volumeRatio7d === null ? "—" : `${row.volumeRatio7d.toFixed(1)}× TB7d`}</p>
                </div>
                <div>
                  <p className="text-slate-500">OI / funding</p>
                  <p className={cn((row.oiChangePct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                    {formatPct(row.oiChangePct)}
                  </p>
                  <p>{formatFunding(row.fundingRate)}</p>
                </div>
                <div>
                  <p className="text-slate-500">Impulse / RS</p>
                  <p className="text-slate-200">
                    {row.impulseAgeHours === null || row.impulseAgeHours === undefined
                      ? "—"
                      : `${row.impulseAgeHours.toFixed(1)}h`}
                  </p>
                  <p className={cn((row.relativeStrengthPct ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300")}>
                    {formatPct(row.relativeStrengthPct ?? null)} vs BTC
                  </p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <RangeBar position={row.rangePosition} />
                <span className="text-[11px] text-slate-500">
                  score {row.score} · mới {row.entryQuality}
                </span>
              </div>
            </button>
          ))
        )}
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

      {activeCluster ? (
        <ClusterView
          cluster={activeCluster}
          side={side}
          copied={copied}
          onClose={closeCluster}
          onCopy={() => void copyPermalink(activeCluster.id, null)}
          onSelectMember={setSelected}
        />
      ) : null}

      {selected ? <DetailDrawer key={selected} symbol={selected} onClose={() => setSelected(null)} /> : null}
    </main>
  );
}

export default function RadarPage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto px-4 py-6 text-sm text-slate-400">
          <RadarIcon className="mr-2 inline h-4 w-4 animate-pulse text-cyan-400" /> Đang tải radar…
        </main>
      }
    >
      <RadarScreen />
    </Suspense>
  );
}
