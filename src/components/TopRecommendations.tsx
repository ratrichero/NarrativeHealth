"use client";

// SQ-TOP-REC: Top Recommend section — 3 best-trend coins with actionable
// setups (direction read, Entry/TP/SL, reason) rendered as dashboard cards.

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Target, AlertTriangle, BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-slate-800 rounded w-1/3" />
      <div className="h-8 bg-slate-800 rounded w-1/2" />
      <div className="h-3 bg-slate-800 rounded w-2/3" />
    </div>
  );
}

interface Setup {
  entryLow: number;
  entryHigh: number;
  takeProfits: { level: number; label: string | null }[];
  stopLoss: number;
  riskRewardRatio: number | null;
  tp1GainPct: number | null;
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
  reason: string;
  currentPrice: number;
  setup: Setup | null;
  metrics: {
    trendScore: number | null;
    volumeScore: number | null;
    rsi14: number | null;
    fundingRate: number | null;
    priceVsEma20Pct: number | null;
  };
}

interface TopRecommendationsData {
  date: string;
  recommendations: Recommendation[];
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(2) : n >= 1 ? n.toFixed(4) : n.toFixed(6);
}

function directionRead(rec: Recommendation): {
  label: string;
  cls: string;
  Icon: typeof TrendingUp;
} {
  const bullishSignal = rec.signal === "STRONG_WATCH" || rec.signal === "WATCH";
  const healthy = rec.healthScore >= 65;
  if (bullishSignal && healthy) {
    return { label: "Bullish bias", cls: "text-green-400", Icon: TrendingUp };
  }
  if (rec.signal === "WEAK" || rec.healthScore < 50) {
    return { label: "Bearish bias", cls: "text-red-400", Icon: TrendingDown };
  }
  return { label: "Neutral / observe", cls: "text-slate-400", Icon: BarChart3 };
}

function RecCard({ rec }: { rec: Recommendation }) {
  const dir = directionRead(rec);
  const price = rec.currentPrice;

  return (
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
            Health <span className="text-white font-mono">{rec.healthScore.toFixed(0)}</span>
          </span>
          {rec.scoreChange != null && rec.scoreChange !== 0 && (
            <span className={rec.scoreChange > 0 ? "text-green-400" : "text-red-400"}>
              {rec.scoreChange > 0 ? "▲" : "▼"} {Math.abs(rec.scoreChange).toFixed(1)}
            </span>
          )}
          {price > 0 && (
            <span className="text-slate-400 ml-auto">
              Price <span className="text-white font-mono">${fmt(price)}</span>
            </span>
          )}
        </div>

        {/* Setup block */}
        {rec.setup ? (
          <div className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Entry zone</span>
              <span className="text-cyan-300 font-mono">
                {fmt(rec.setup.entryLow)} – {fmt(rec.setup.entryHigh)}
              </span>
            </div>
            {rec.setup.takeProfits.slice(0, 2).map((tp, i) => (
              <div key={i} className="flex justify-between">
                <span className="text-slate-500 flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {tp.label ?? `TP${i + 1}`}
                </span>
                <span className="text-green-300 font-mono">
                  {fmt(tp.level)}
                  {i === 0 && rec.setup!.tp1GainPct != null && (
                    <span className="text-green-500"> (+{rec.setup!.tp1GainPct}%)</span>
                  )}
                </span>
              </div>
            ))}
            <div className="flex justify-between">
              <span className="text-slate-500 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Stop loss
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
                <span className="text-slate-500">Risk / Reward</span>
                <span className="text-amber-300 font-mono font-medium">
                  {rec.setup.riskRewardRatio.toFixed(1)} : 1
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-slate-800/30 border border-slate-700/50 p-3 text-xs text-slate-500">
            Setup unavailable — insufficient price/ATR data for this coin.
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

        {/* Reason */}
        <p className="text-xs text-slate-400 mt-3 leading-relaxed line-clamp-3" title={rec.reason}>
          {rec.reason}
        </p>

        {/* Advisory note */}
        <p className="text-[10px] text-slate-600 mt-2">
          Advisory levels from ATR data — not trade execution instructions.
        </p>
      </CardContent>
    </Card>
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
        <h2 className="text-lg font-semibold text-white mb-4">Top Recommend</h2>
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

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Top Recommend</h2>
        <span className="text-xs text-slate-500">
          Best-trend coins · data as of {data.date}
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
