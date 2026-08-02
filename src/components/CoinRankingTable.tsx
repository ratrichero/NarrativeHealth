"use client";

import Link from "next/link";
import { HealthBadge } from "./HealthBadge";
import { SignalBadge } from "./SignalBadge";
import { ScoreChange } from "./ScoreChange";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { CoinInNarrative } from "@/types";

interface CoinRankingTableProps {
  coins: CoinInNarrative[];
}

export function CoinRankingTable({ coins }: CoinRankingTableProps) {
  if (coins.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        No coins in this narrative
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-800">
            <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
              #
            </th>
            <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
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
            <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
              Trend
            </th>
            <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
              Deriv
            </th>
            <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
              Vol
            </th>
            <th className="text-right text-xs font-medium text-slate-500 uppercase tracking-wider py-3 px-4">
              Mom
            </th>
          </tr>
        </thead>
        <tbody>
          {coins.map((coin, index) => (
            <tr
              key={coin.id}
              className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
            >
              <td className="py-3 px-4 text-slate-500 text-sm">{index + 1}</td>
              <td className="py-3 px-4">
                <Link
                  href={`/coin/${coin.id}`}
                  className="flex items-center gap-2 hover:text-cyan-400 transition-colors"
                >
                  <span className="font-medium text-white">{coin.symbol}</span>
                  <span className="text-xs text-slate-500">{coin.name}</span>
                </Link>
              </td>
              <td className="py-3 px-4 text-center">
                <HealthBadge status={coin.status} score={coin.healthScore} />
              </td>
              <td className="py-3 px-4 text-center">
                <ScoreChange change={coin.scoreChange} />
              </td>
              <td className="py-3 px-4 text-center">
                <SignalBadge signal={coin.signal} />
              </td>
              <td className="py-3 px-4 text-center">
                <ConfidenceBadge confidence={coin.confidenceScore} />
              </td>
              <td className="py-3 px-4 text-right text-sm text-slate-300">
                {coin.trendScore?.toFixed(0) || "-"}
              </td>
              <td className="py-3 px-4 text-right text-sm text-slate-300">
                {coin.derivativeScore?.toFixed(0) || "-"}
              </td>
              <td className="py-3 px-4 text-right text-sm text-slate-300">
                {coin.volumeScore?.toFixed(0) || "-"}
              </td>
              <td className="py-3 px-4 text-right text-sm text-slate-300">
                {coin.momentumScore?.toFixed(0) || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
