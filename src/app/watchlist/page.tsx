"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { HealthBadge } from "@/components/HealthBadge";
import { SignalBadge } from "@/components/SignalBadge";
import { ScoreChange } from "@/components/ScoreChange";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { Star, Trash2, AlertCircle } from "lucide-react";
import type { WatchlistItem } from "@/types";

async function fetchWatchlist(): Promise<WatchlistItem[]> {
  const response = await fetch("/api/watchlist");
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

async function removeFromWatchlist(id: number): Promise<void> {
  const response = await fetch(`/api/watchlist/${id}`, {
    method: "DELETE",
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
}

export default function WatchlistPage() {
  const queryClient = useQueryClient();

  const { data: watchlist, isLoading, error } = useQuery({
    queryKey: ["watchlist"],
    queryFn: fetchWatchlist,
  });

  const removeMutation = useMutation({
    mutationFn: removeFromWatchlist,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
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
        <h2 className="text-xl font-semibold text-white mb-2">Failed to load watchlist</h2>
        <p className="text-slate-400">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Star className="h-6 w-6 text-yellow-500" />
        <h1 className="text-2xl font-bold text-white">Watchlist</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          {!watchlist || watchlist.length === 0 ? (
            <div className="text-center py-12">
              <Star className="h-12 w-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 mb-2">Your watchlist is empty</p>
              <p className="text-slate-500 text-sm">
                Add coins from the dashboard or coin pages
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-6">
                      Coin
                    </th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                      Health
                    </th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                      Change
                    </th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                      Signal
                    </th>
                    <th className="text-center text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                      Confidence
                    </th>
                    <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
                      Note
                    </th>
                    <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-6">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                    >
                      <td className="py-4 px-6">
                        <Link
                          href={`/coin/${item.coinId}`}
                          className="flex items-center gap-2 hover:text-cyan-400 transition-colors"
                        >
                          <span className="font-medium text-white">{item.symbol}</span>
                          <span className="text-xs text-slate-500">{item.name}</span>
                        </Link>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <HealthBadge status={item.status} score={item.healthScore || undefined} />
                      </td>
                      <td className="py-4 px-4 text-center">
                        <ScoreChange change={item.scoreChange} />
                      </td>
                      <td className="py-4 px-4 text-center">
                        <SignalBadge signal={item.signal} />
                      </td>
                      <td className="py-4 px-4 text-center">
                        <ConfidenceBadge confidence={item.confidenceScore} />
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-slate-400">{item.note || "-"}</span>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMutation.mutate(item.id)}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
