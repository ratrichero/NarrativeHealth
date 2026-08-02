"use client";

import { cn } from "@/lib/utils";

interface ScoreBreakdownProps {
  trendScore: number | null;
  derivativeScore: number | null;
  volumeScore: number | null;
  momentumScore: number | null;
  weights?: {
    trend: number;
    derivative: number;
    volume: number;
    momentum: number;
  };
}

const defaultWeights = {
  trend: 0.35,
  derivative: 0.35,
  volume: 0.2,
  momentum: 0.1,
};

export function ScoreBreakdown({
  trendScore,
  derivativeScore,
  volumeScore,
  momentumScore,
  weights = defaultWeights,
}: ScoreBreakdownProps) {
  const scores = [
    { label: "Trend", score: trendScore, weight: weights.trend, color: "bg-cyan-500" },
    {
      label: "Derivative",
      score: derivativeScore,
      weight: weights.derivative,
      color: "bg-purple-500",
    },
    { label: "Volume", score: volumeScore, weight: weights.volume, color: "bg-orange-500" },
    { label: "Momentum", score: momentumScore, weight: weights.momentum, color: "bg-pink-500" },
  ];

  return (
    <div className="space-y-3">
      {scores.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">
              {item.label}{" "}
              <span className="text-slate-600">({(item.weight * 100).toFixed(0)}%)</span>
            </span>
            <span className="text-white font-medium">
              {item.score !== null ? item.score.toFixed(1) : "-"}
            </span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-500", item.color)}
              style={{ width: `${item.score || 0}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
