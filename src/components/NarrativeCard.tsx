"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent } from "./ui/Card";
import { Button } from "./ui/Button";
import { HealthBadge } from "./HealthBadge";
import { ScoreChange } from "./ScoreChange";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { WatchlistDialog } from "./WatchlistDialog";
import { HealthSparkline } from "./ui/health-sparkline";
import { TrendingUp, Users, RefreshCw, Star, AlertTriangle } from "lucide-react";
import type { NarrativeSummary } from "@/types";
import type { HealthTimeline } from "@/lib/types/health-timeline";

interface NarrativeCardProps {
  narrative: NarrativeSummary;
}

async function fetchNarrativeCorrelation(narrativeId: number): Promise<{ avgCorrelation: number } | null> {
  try {
    const response = await fetch(`/api/narratives/${narrativeId}/correlations?days=30`);
    const data = await response.json();
    if (!data.success) return null;
    return { avgCorrelation: data.data.avgCorrelation };
  } catch {
    return null;
  }
}

async function refreshNarrativeData(narrativeId: number): Promise<{ message: string; coinsProcessed: number; totalCoins: number; duration: number }> {
  const response = await fetch(`/api/refresh/narrative/${narrativeId}`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function addToWatchlist(coinId: number, note?: string, priority?: number) {
  const response = await fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coinId, note, priority }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function fetchHealthTimeline(coinId: number): Promise<HealthTimeline> {
  const response = await fetch(`/api/coins/${coinId}/health-timeline?days=7`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export function NarrativeCard({ narrative }: NarrativeCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [watchlistDialogOpen, setWatchlistDialogOpen] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState<{ id: number; symbol: string; name: string } | null>(null);
  const queryClient = useQueryClient();

  // Fetch health timeline for top coin if available
  const { data: healthTimeline } = useQuery({
    queryKey: ['health-timeline', narrative.topCoin?.id, 7],
    queryFn: () => fetchHealthTimeline(narrative.topCoin!.id),
    enabled: !!narrative.topCoin?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { data: correlation } = useQuery({
    queryKey: ['narrative-correlation', narrative.id],
    queryFn: () => fetchNarrativeCorrelation(narrative.id),
    staleTime: 30 * 60 * 1000,
  });

  const refreshMutation = useMutation({
    mutationFn: refreshNarrativeData,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setIsRefreshing(false);
    },
    onError: () => {
      setIsRefreshing(false);
    },
  });

  const watchlistMutation = useMutation({
    mutationFn: ({ coinId, note, priority }: { coinId: number; note?: string; priority?: number }) => 
      addToWatchlist(coinId, note, priority),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  const handleRefresh = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`Refresh data for all coins in "${narrative.name}"?`)) {
      setIsRefreshing(true);
      refreshMutation.mutate(narrative.id);
    }
  };

  return (
    <Link href={`/narrative/${narrative.id}`}>
      <Card hover className="h-full">
        <CardContent>
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white mb-1">
                {narrative.name}
              </h3>
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Users className="h-4 w-4" />
                <span>{narrative.coinCount} coins</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <HealthBadge status={narrative.status} score={narrative.healthScore} />
              {correlation && correlation.avgCorrelation >= 0.4 && (
                <span className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded ${
                  correlation.avgCorrelation >= 0.7 ? 'bg-red-900/50 text-red-400' :
                  correlation.avgCorrelation >= 0.4 ? 'bg-yellow-900/50 text-yellow-400' :
                  'bg-green-900/50 text-green-400'
                }`}>
                  <AlertTriangle className="h-3 w-3" />
                  Corr: {correlation.avgCorrelation.toFixed(2)}
                </span>
              )}
              {narrative.weightingMethod && (
                <span className="text-xs text-blue-400 flex items-center gap-1">
                  <span>⚖️</span> {narrative.weightingMethod === 'market_cap' ? 'Market Cap Weighted' : 'Equal Weighted'}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing || refreshMutation.isPending}
                title="Refresh data for this narrative"
                className="hover:bg-slate-700"
              >
                <RefreshCw className={`h-4 w-4 text-cyan-400 ${isRefreshing || refreshMutation.isPending ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <span className="text-xs text-slate-500 block mb-1">Change</span>
              <ScoreChange change={narrative.scoreChange} />
            </div>
            <div>
              <span className="text-xs text-slate-500 block mb-1">Confidence</span>
              <ConfidenceBadge confidence={narrative.avgConfidence} />
            </div>
          </div>

          {narrative.topCoin && (
            <div className="pt-3 border-t border-slate-800">
              <div className="flex items-center justify-between text-sm mb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-slate-400">Top:</span>
                  <span className="text-white font-medium">
                    {narrative.topCoin.symbol}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-green-500 text-xs">
                    {narrative.topCoin.healthScore.toFixed(0)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedCoin({ id: narrative.topCoin!.id, symbol: narrative.topCoin!.symbol, name: narrative.topCoin!.name });
                      setWatchlistDialogOpen(true);
                    }}
                    title="Add to watchlist"
                    className="hover:bg-slate-700 h-6 w-6 p-0"
                  >
                    <Star className="h-3 w-3 text-yellow-500" />
                  </Button>
                </div>
              </div>
              {/* Health Sparkline */}
              {healthTimeline && (
                <div className="mt-2">
                  <HealthSparkline 
                    points={healthTimeline.points} 
                    trend={healthTimeline.trend}
                    width={80}
                    height={28}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Watchlist Dialog */}
      {selectedCoin && (
        <WatchlistDialog
          isOpen={watchlistDialogOpen}
          onClose={() => {
            setWatchlistDialogOpen(false);
            setSelectedCoin(null);
          }}
          coinId={selectedCoin.id}
          coinSymbol={selectedCoin.symbol}
          coinName={selectedCoin.name}
          onAdd={async (coinId, note, priority) => {
            await watchlistMutation.mutateAsync({ coinId, note, priority });
          }}
        />
      )}
    </Link>
  );
}
