"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { HealthBadge } from "@/components/HealthBadge";
import { SignalBadge } from "@/components/SignalBadge";
import { ScoreChange } from "@/components/ScoreChange";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ScoreBreakdown } from "@/components/ScoreBreakdown";
import { ArrowLeft, AlertCircle, ExternalLink, RefreshCw } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import { formatLargeNumber, formatPercent } from "@/lib/utils";
import type { CoinDetail } from "@/types";

async function fetchCoin(id: string): Promise<CoinDetail> {
  const response = await fetch(`/api/coins/${id}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function refreshCoin(id: string): Promise<{ message: string }> {
  const response = await fetch(`/api/refresh/coin/${id}`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export default function CoinDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();

  const { data: coin, isLoading, error } = useQuery({
    queryKey: ["coin", id],
    queryFn: () => fetchCoin(id),
  });

  const refreshMutation = useMutation({
    mutationFn: () => refreshCoin(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coin", id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error || !coin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Failed to load coin</h2>
        <p className="text-slate-400">{(error as Error)?.message || "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold text-white">{coin.symbol}</h1>
            <span className="text-xl text-slate-400">{coin.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {coin.narratives.map((n) => (
              <Link key={n.id} href={`/narrative/${n.id}`}>
                <Badge variant={n.isPrimary ? "success" : "neutral"}>{n.name}</Badge>
              </Link>
            ))}
            {coin.hasFutures && <Badge variant="default">Futures</Badge>}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            loading={refreshMutation.isPending}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {coin.currentHealth && (
            <>
              <HealthBadge
                status={coin.currentHealth.status}
                score={coin.currentHealth.healthScore}
              />
              <ScoreChange change={coin.currentHealth.scoreChange} />
              <ConfidenceBadge confidence={coin.currentHealth.confidenceScore} />
            </>
          )}
        </div>
      </div>

      {/* Recommendation */}
      {coin.recommendation && (
        <Card className="border-l-4 border-l-cyan-500">
          <CardContent className="py-4">
            <div className="flex items-start gap-4">
              <SignalBadge signal={coin.recommendation.signal} />
              <p className="text-slate-300">{coin.recommendation.reason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Score Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Score Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {coin.features ? (
              <ScoreBreakdown
                trendScore={coin.features.trendScore}
                derivativeScore={coin.features.derivativeScore}
                volumeScore={coin.features.volumeScore}
                momentumScore={coin.features.momentumScore}
              />
            ) : (
              <p className="text-slate-500 text-center py-4">No feature data available</p>
            )}
          </CardContent>
        </Card>

        {/* Health History */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Health Score History</CardTitle>
          </CardHeader>
          <CardContent>
            {coin.healthHistory.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No history available</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={coin.healthHistory}>
                    <XAxis
                      dataKey="date"
                      stroke="#64748b"
                      fontSize={12}
                      tickFormatter={(value) => value.slice(5)}
                    />
                    <YAxis stroke="#64748b" fontSize={12} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #334155",
                        borderRadius: "8px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Price Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Price History</CardTitle>
        </CardHeader>
        <CardContent>
          {coin.priceHistory.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No price data available</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={coin.priceHistory}>
                  <XAxis
                    dataKey="date"
                    stroke="#64748b"
                    fontSize={12}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: "8px",
                    }}
                    formatter={(value) => [`$${Number(value).toFixed(4)}`, "Price"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke="#22d3ee"
                    fill="#22d3ee"
                    fillOpacity={0.1}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metrics & Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Market Metrics */}
        {coin.metrics && (
          <>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-slate-500 mb-1">Market Cap</p>
                <p className="text-lg font-semibold text-white">
                  {formatLargeNumber(coin.metrics.marketCap)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-slate-500 mb-1">FDV</p>
                <p className="text-lg font-semibold text-white">
                  {formatLargeNumber(coin.metrics.fullyDilutedValuation)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-slate-500 mb-1">Open Interest</p>
                <p className="text-lg font-semibold text-white">
                  {formatLargeNumber(coin.metrics.openInterest)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-slate-500 mb-1">Funding Rate</p>
                <p className="text-lg font-semibold text-white">
                  {coin.metrics.fundingRate !== null
                    ? formatPercent(coin.metrics.fundingRate * 100, 4)
                    : "-"}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Feature Details */}
      {coin.features && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Trend Detail */}
          {coin.features.trendDetail && (
            <Card>
              <CardHeader>
                <CardTitle>Trend Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Price</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { price: number }).price.toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">EMA 20</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { ema20: number }).ema20.toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">EMA 50</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { ema50: number }).ema50.toFixed(6)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">EMA 200</span>
                    <span className="text-white">
                      ${(coin.features.trendDetail as { ema200: number }).ema200.toFixed(6)}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-slate-800">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          (coin.features.trendDetail as { price_vs_ema20: boolean }).price_vs_ema20
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        {(coin.features.trendDetail as { price_vs_ema20: boolean }).price_vs_ema20
                          ? "✓"
                          : "✗"}
                      </span>
                      <span className="text-slate-400">Price &gt; EMA20</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          (coin.features.trendDetail as { price_vs_ema50: boolean }).price_vs_ema50
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        {(coin.features.trendDetail as { price_vs_ema50: boolean }).price_vs_ema50
                          ? "✓"
                          : "✗"}
                      </span>
                      <span className="text-slate-400">Price &gt; EMA50</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Derivative Detail */}
          {coin.features.derivativeDetail && (
            <Card>
              <CardHeader>
                <CardTitle>Derivative Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                {(coin.features.derivativeDetail as { no_futures: boolean }).no_futures ? (
                  <p className="text-slate-500">No futures available for this coin</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">OI Change</span>
                      <span
                        className={
                          (coin.features.derivativeDetail as { oi_change_pct: number })
                            .oi_change_pct >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        {formatPercent(
                          (coin.features.derivativeDetail as { oi_change_pct: number })
                            .oi_change_pct
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Funding Rate</span>
                      <span className="text-white">
                        {(coin.features.derivativeDetail as { funding_rate: number | null })
                          .funding_rate !== null
                          ? formatPercent(
                              (
                                coin.features.derivativeDetail as { funding_rate: number }
                              ).funding_rate * 100,
                              4
                            )
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">OI Component</span>
                      <span className="text-white">
                        {(
                          coin.features.derivativeDetail as { oi_component: number }
                        ).oi_component.toFixed(0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Funding Component</span>
                      <span className="text-white">
                        {(
                          coin.features.derivativeDetail as { funding_component: number }
                        ).funding_component.toFixed(0)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Data Sources */}
      <Card>
        <CardHeader>
          <CardTitle>Data Sources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-slate-500 mb-1">Binance Spot</p>
              <p className="text-white">{coin.binanceSpotSymbol || "Not configured"}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-1">Binance Futures</p>
              <p className="text-white">{coin.binanceFuturesSymbol || "Not configured"}</p>
            </div>
            <div>
              <p className="text-slate-500 mb-1">CoinGecko</p>
              <p className="text-white">{coin.coingeckoId || "Not configured"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
