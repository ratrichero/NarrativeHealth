"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { HealthBadge } from "@/components/HealthBadge";
import { ScoreChange } from "@/components/ScoreChange";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { CoinRankingTable } from "@/components/CoinRankingTable";
import { ArrowLeft, AlertCircle } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CorrelationHeatmap } from "@/components/CorrelationHeatmap";
import type { NarrativeDetail } from "@/types";

async function fetchNarrative(id: string): Promise<NarrativeDetail> {
  const response = await fetch(`/api/narratives/${id}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error);
  return data.data;
}

export default function NarrativeDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: narrative, isLoading, error } = useQuery({
    queryKey: ["narrative", id],
    queryFn: () => fetchNarrative(id),
  });

  const { data: correlation, isLoading: correlationLoading } = useQuery({
    queryKey: ["narrative", id, "correlations"],
    queryFn: async () => {
      const response = await fetch(`/api/narratives/${id}/correlations?days=30`);
      const data = await response.json();
      if (!data.success) throw new Error(data.error);
      return data.data;
    },
    enabled: !!narrative,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
      </div>
    );
  }

  if (error || !narrative) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Failed to load narrative</h2>
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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">{narrative.name}</h1>
          {narrative.description && (
            <p className="text-slate-400">{narrative.description}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <HealthBadge status={narrative.status} score={narrative.healthScore} />
          <ScoreChange change={narrative.scoreChange} />
          <ConfidenceBadge confidence={narrative.avgConfidence} />
        </div>
      </div>

      {/* Health History Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Health Score History</CardTitle>
        </CardHeader>
        <CardContent>
          {narrative.healthHistory.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No history available</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={narrative.healthHistory}>
                  <XAxis
                    dataKey="date"
                    stroke="#64748b"
                    fontSize={12}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis
                    stroke="#64748b"
                    fontSize={12}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: "8px",
                    }}
                    labelStyle={{ color: "#94a3b8" }}
                    itemStyle={{ color: "#22d3ee" }}
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

      {/* Correlation Matrix */}
      <CorrelationHeatmap data={correlation ?? null} isLoading={correlationLoading} />

      {/* Coin Ranking Table */}
      <Card>
        <CardHeader>
          <CardTitle>Coins in {narrative.name}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <CoinRankingTable coins={narrative.coins} />
        </CardContent>
      </Card>
    </div>
  );
}
