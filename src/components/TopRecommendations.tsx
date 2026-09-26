"use client";

// SQ-TOP-REC v2: Top Recommend section — 2 bullish + 1 bearish-watch picks
// with Vietnamese reasons and direction-aware setups (Entry/TP/SL).

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { TrendingUp, TrendingDown, Target, AlertTriangle, ArrowDownRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";
import { coinUrl } from "@/lib/seo-urls";

interface Setup {
  entryLow: number;
  entryHigh: number;
  takeProfits: { level: number; label: string | null }[];
  stopLoss: number;
  riskRewardRatio: number | null;
  tp1MovePct: number | null;
  slRiskPct: number | null;
}

interface Recommendation {
  coinId: number;
  symbol: string;
  name: string;
  narrativeName: string | null;
  healthScore: number;
  scoreChange: number | null;
  status: string;
  signal: string;
  direction: "BULLISH" | "BEARISH";
  reason: string;
  currentPrice: number;
  setup: Setup | null;
  setupUnavailableReason: string | null;
  metrics: {
    trendScore: number | null;
    volumeScore: number | null;
    momentumScore: number | null;
    rsi14: number | null;
    fundingRate: number | null;
    priceVsEma20Pct: number | null;
  };
}

interface TopRecommendationsData {
  date: string;
  recommendations: Recommendation[];
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-slate-800 rounded w-1/3" />
      <div className="h-8 bg-slate-800 rounded w-1/2" />
      <div className="h-3 bg-slate-800 rounded w-2/3" />
    </div>
  );
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6);
}

const DIRECTION_CONFIG = {
  BULLISH: {
    label: "Xu hướng tăng",
    cls: "text-green-400",
    bg: "bg-green-900/40 text-green-300",
    Icon: TrendingUp,
  },
  BEARISH: {
    label: "Xu hướng yếu · short-bias",
    cls: "text-red-400",
    bg: "bg-red-900/40 text-red-300",
    Icon: TrendingDown,
  },
} as const;

function RecCard({ rec }: { rec: Recommendation }) {
  const dir = DIRECTION_CONFIG[rec.direction];
  const price = rec.currentPrice;
  const isBearish = rec.direction === "BEARISH";

  return (
    <Link href={coinUrl(rec.coinId, rec.symbol)} className="block h-full" aria-label={`Xem chi tiết ${rec.symbol}`}>
    <Card hover className="h-full">
      <CardContent className="p-5">
        {/* Header: symbol + direction */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">${rec.symbol}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                rec.signal === "STRONG_WATCH"
                  ? "bg-green-900/50 text-green-400"
                  : rec.signal === "WATCH"
                    ? "bg-emerald-900/50 text-emerald-400"
                    : rec.signal === "OBSERVE"
                      ? "bg-yellow-900/50 text-yellow-400"
                      : rec.signal === "WEAK"
                        ? "bg-red-900/50 text-red-400"
                        : "bg-slate-800 text-slate-400"
              }`}>
                {rec.signal.replace("_", " ")}
              </span>
            </div>
            {rec.narrativeName && (
              <div className="text-xs text-slate-500 mt-0.5">{rec.narrativeName}</div>
            )}
          </div>
          <div className={`flex items-center gap-1 text-xs font-medium ${dir.cls}`}>
            <dir.Icon className="h-4 w-4" />
            {dir.label}
          </div>
        </div>

        {/* Health + price line */}
        <div className="flex items-center gap-3 mb-3 text-sm">
          <span className="text-slate-400">
            Sức khoẻ <span className="text-white font-mono">{rec.healthScore.toFixed(0)}</span>
          </span>
          {rec.scoreChange != null && rec.scoreChange !== 0 && (
            <span className={rec.scoreChange > 0 ? "text-green-400" : "text-red-400"}>
              {rec.scoreChange > 0 ? "▲" : "▼"} {Math.abs(rec.scoreChange).toFixed(1)}
            </span>
          )}
          {price > 0 && (
            <span className="text-slate-400 ml-auto">
              Giá <span className="text-white font-mono">${fmt(price)}</span>
            </span>
          )}
        </div>

        {/* Setup block */}
        {rec.setup ? (
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">
                {isBearish ? "Vùng vào (breakdown)" : "Vùng vào (pullback)"}
              </span>
              <span className="text-cyan-300 font-mono">
                {fmt(rec.setup.entryLow)} – {fmt(rec.setup.entryHigh)}
              </span>
            </div>
            {rec.setup.takeProfits.slice(0, 2).map((tp, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-slate-500 flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {tp.label ?? `Mục tiêu ${i + 1}`}
                </span>
                <span className="text-green-300 font-mono">
                  {fmt(tp.level)}
                  {i === 0 && rec.setup!.tp1MovePct != null && (
                    <span className="text-green-500"> ({isBearish ? "-" : "+"}{rec.setup!.tp1MovePct}%)</span>
                  )}
                </span>
              </div>
            ))}
            <div className="flex justify-between">
              <span className="text-slate-500 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Cắt lỗ
              </span>
              <span className="text-red-300 font-mono">
                {fmt(rec.setup.stopLoss)}
                {rec.setup.slRiskPct != null && (
                  <span className="text-red-500"> (-{rec.setup.slRiskPct}%)</span>
                )}
              </span>
            </div>
            {rec.setup.riskRewardRatio != null && (
              <div className="flex justify-between pt-1 border-t border-slate-700/50">
                <span className="text-slate-500">Lợi nhuận / Rủi ro</span>
                <span className="text-amber-300 font-mono font-medium">
                  {rec.setup.riskRewardRatio.toFixed(1)} : 1
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-slate-800/30 border border-slate-700/50 p-3 text-xs text-slate-500">
            {rec.setupUnavailableReason ?? "Chưa đủ dữ liệu để tính setup."}
          </div>
        )}

        {/* Quick data reads */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {rec.metrics.trendScore != null && (
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              Trend {rec.metrics.trendScore}/100
            </span>
          )}
          {rec.metrics.rsi14 != null && (
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              RSI {rec.metrics.rsi14.toFixed(0)}
            </span>
          )}
          {rec.metrics.fundingRate != null && (
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              Fund {(rec.metrics.fundingRate * 100).toFixed(3)}%
            </span>
          )}
          {rec.metrics.priceVsEma20Pct != null && (
            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300">
              EMA20 {rec.metrics.priceVsEma20Pct >= 0 ? "+" : ""}
              {rec.metrics.priceVsEma20Pct}%
            </span>
          )}
        </div>

        {/* Reason (Vietnamese) */}
        <p className="text-xs text-slate-400 mt-3 leading-relaxed" title={rec.reason}>
          {rec.reason}
        </p>

        {/* Advisory note */}
        <p className="text-[10px] text-slate-600 mt-2">
          Mức giá mang tính tham khảo từ dữ liệu ATR — không phải chỉ dẫn giao dịch.
        </p>
      </CardContent>
    </Card>
    </Link>
  );
}

export function TopRecommendations() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["top-recommendations"],
    queryFn: async (): Promise<TopRecommendationsData> => {
      const res = await fetch("/api/dashboard/top-recommendations");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Đề xuất nổi bật</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    );
  }

  if (error || !data || data.recommendations.length === 0) {
    return null; // silently hide section when no data — dashboard stays clean
  }

  const bullishCount = data.recommendations.filter((r) => r.direction === "BULLISH").length;
  const bearishCount = data.recommendations.length - bullishCount;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Đề xuất nổi bật</h2>
        <span className="text-xs text-slate-500">
          {bullishCount} tăng · {bearishCount} yếu · dữ liệu ngày {data.date}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.recommendations.map((rec) => (
          <RecCard key={rec.coinId} rec={rec} />
        ))}
      </div>
    </section>
  );
}
