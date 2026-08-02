"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { NarrativeCard } from "@/components/NarrativeCard";
import { SourceStatusBar } from "@/components/SourceStatusBar";
import { RefreshButton } from "@/components/RefreshButton";
import { HealthBadge } from "@/components/HealthBadge";
import { ScoreChange } from "@/components/ScoreChange";
import { formatDateTime, getHealthStatus } from "@/lib/utils";
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
  const {
    data: dashboard,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

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
        <RefreshButton onRefreshComplete={() => refetch()} />
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
        </div>
        <div className="flex items-center gap-4">
          <SourceStatusBar sourceStatus={dashboard.sourceStatus} />
          <RefreshButton onRefreshComplete={() => refetch()} />
        </div>
      </div>

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
        {/* Top Movers */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-500" />
              <CardTitle>Top Movers</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.topMovers.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No data available</p>
            ) : (
              <div className="space-y-3">
                {dashboard.topMovers.map((coin) => (
                  <Link
                    key={coin.id}
                    href={`/coin/${coin.id}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-white">{coin.symbol}</span>
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

        {/* Weakest Coins */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-500" />
              <CardTitle>Weakest Coins</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.weakestCoins.length === 0 ? (
              <p className="text-slate-500 text-center py-4">No data available</p>
            ) : (
              <div className="space-y-3">
                {dashboard.weakestCoins.map((coin) => (
                  <Link
                    key={coin.id}
                    href={`/coin/${coin.id}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-white">{coin.symbol}</span>
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
