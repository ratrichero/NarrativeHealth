"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { NarrativeCard } from "@/components/NarrativeCard";
import { SourceStatusBar } from "@/components/SourceStatusBar";
import { RefreshButton } from "@/components/RefreshButton";
import { TopRecommendations } from "@/components/TopRecommendations";
import { HealthBadge } from "@/components/HealthBadge";
import { ScoreChange } from "@/components/ScoreChange";
import { formatDateTime, getHealthStatus } from "@/lib/utils";
import { coinUrl } from "@/lib/seo-urls";
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import Link from "next/link";
import type { DashboardData } from "@/types";

async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const {
    data: dashboard,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    // DASH-AUTO-REFRESH: dashboard thường được mở cả ngày (tab để qua đêm).
    // Khi scheduler 6h sáng ghi dữ liệu ngày mới, tab cũ phải tự bắt kịp thay
    // vì chờ người dùng F5 — poll nhẹ 5 phút/lần (2 request nhẹ, force-dynamic).
    refetchInterval: 5 * 60 * 1000,
  });

  // RefreshButton chạy pipeline đầy đủ → mọi section đổi dữ liệu. Invalidate
  // toàn bộ (dashboard + top-recommendations + …) thay vì chỉ query dashboard.
  const refreshAll = () => queryClient.invalidateQueries();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Failed to load dashboard</h2>
        <p className="text-slate-400 mb-4">{(error as Error).message}</p>
        <RefreshButton onRefreshComplete={refreshAll} />
      </div>
    );
  }

  if (!dashboard) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Morning Report</h1>
          <p className="text-slate-400">
            {formatDateTime(dashboard.lastUpdate)} • {dashboard.date}
          </p>
          {dashboard.dataIsStale && dashboard.dataAsOf && (
            <p className="text-xs text-amber-400 mt-1">
              Showing latest available data (as of {dashboard.dataAsOf}). Today&apos;s refresh has not run yet.
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <SourceStatusBar sourceStatus={dashboard.sourceStatus} />
          <RefreshButton onRefreshComplete={refreshAll} />
        </div>
      </div>

      {/* SQ-TOP-REC — Top 3 best-trend coins with actionable setups */}
      <TopRecommendations />

      {/* Narratives Grid */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-4">Narratives</h2>
        {dashboard.narratives.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-slate-400 mb-4">No narratives found.</p>
              <Link
                href="/admin"
                className="text-cyan-400 hover:text-cyan-300 underline"
              >
                Go to Admin to seed data
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {dashboard.narratives.map((narrative) => (
              <NarrativeCard key={narrative.id} narrative={narrative} />
            ))}
          </div>
        )}
      </section>

      {/* Top Movers & Weakest */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Strongest — PA-A (revised): health-first ordering, explainable
            from the two displayed columns (health ↓, change ↓ tiebreak). */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <CardTitle>Strongest Coins</CardTitle>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Xếp theo điểm health giảm dần — cùng điểm thì coin tăng nhiều hơn đứng trên.
            </p>
          </CardHeader>
          <CardContent>
            {dashboard.topMovers.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No data available</p>
            ) : (
              <div className="space-y-3">
                {dashboard.topMovers.map((coin) => (
                  <Link
                    key={coin.id}
                    href={coinUrl(coin.id, coin.symbol)}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-white truncate">{coin.symbol}</span>
                      {coin.watchOnly && (
                        <span
                          className="shrink-0 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
                          title="Coin này không phải tín hiệu BULLISH thật — chỉ là tương đối mạnh nhất trong thị trường hiện tại"
                        >
                          Watch only
                        </span>
                      )}
                      <HealthBadge
                        status={getHealthStatus(coin.healthScore)}
                        score={coin.healthScore}
                      />
                    </div>
                    <ScoreChange change={coin.scoreChange} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Weakest — PA-A (revised): health-first ordering, mirrored. */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              <CardTitle>Weakest Coins</CardTitle>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Xếp theo điểm health thấp dần — cùng điểm thì coin giảm nhiều hơn đứng trên.
            </p>
          </CardHeader>
          <CardContent>
            {dashboard.weakestCoins.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No data available</p>
            ) : (
              <div className="space-y-3">
                {dashboard.weakestCoins.map((coin) => (
                  <Link
                    key={coin.id}
                    href={coinUrl(coin.id, coin.symbol)}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors min-w-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-white truncate">{coin.symbol}</span>
                      {coin.watchOnly && (
                        <span
                          className="shrink-0 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
                          title="Coin này không phải tín hiệu BEARISH thật — chỉ là tương đối yếu nhất trong thị trường hiện tại"
                        >
                          Watch only
                        </span>
                      )}
                      <HealthBadge
                        status={getHealthStatus(coin.healthScore)}
                        score={coin.healthScore}
                      />
                    </div>
                    <ScoreChange change={coin.scoreChange} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
