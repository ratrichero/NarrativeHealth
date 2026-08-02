"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardContent } from "./ui/Card";
import { Button } from "./ui/Button";
import { HealthBadge } from "./HealthBadge";
import { ScoreChange } from "./ScoreChange";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { TrendingUp, Users, RefreshCw } from "lucide-react";
import type { NarrativeSummary } from "@/types";

interface NarrativeCardProps {
  narrative: NarrativeSummary;
}

async function refreshNarrativeData(narrativeId: number): Promise<{ message: string; coinsProcessed: number; totalCoins: number; duration: number }> {
  const response = await fetch(`/api/refresh/narrative/${narrativeId}`, { method: "POST" });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export function NarrativeCard({ narrative }: NarrativeCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();

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
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-slate-400">Top:</span>
                  <span className="text-white font-medium">
                    {narrative.topCoin.symbol}
                  </span>
                </div>
                <span className="text-green-500 text-xs">
                  {narrative.topCoin.healthScore.toFixed(0)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
