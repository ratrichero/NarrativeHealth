"use client";

import Link from "next/link";
import { HealthBadge } from "./HealthBadge";
import { SignalBadge } from "./SignalBadge";
import { ScoreChange } from "./ScoreChange";
import { ConfidenceBadge } from "./ConfidenceBadge";
import type { CoinInNarrative } from "@/types";
import { coinUrl } from "@/lib/seo-urls";

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
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-xs min-w-[560px] sm:min-w-0">
        <thead className="text-xs text-slate-500 uppercase tracking-wider">
          <tr className="border-b border-slate-800">
            <th className="text-left pb-2 pr-2 whitespace-nowrap">#</th>
            <th className="text-left pb-2 pr-2 whitespace-nowrap">Coin</th>
            <th className="text-center pb-2 pr-2 whitespace-nowrap">Health</th>
            <th className="text-center pb-2 pr-2 whitespace-nowrap">Change</th>
            <th className="text-center pb-2 pr-2 whitespace-nowrap">Signal</th>
            <th className="text-center pb-2 pr-2 whitespace-nowrap">Conf.</th>
            <th className="text-right pb-2 pr-2 whitespace-nowrap">Trend</th>
            <th className="text-right pb-2 pr-2 whitespace-nowrap">Deriv</th>
            <th className="text-right pb-2 pr-2 whitespace-nowrap">Vol</th>
            <th className="text-right pb-2 whitespace-nowrap">Mom</th>
          </tr>
        </thead>
        <tbody>
          {coins.map((coin, index) => (
            <tr
              key={coin.id}
              className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
            >
              <td className="py-2.5 pr-2 text-slate-500">{index + 1}</td>
              <td className="py-2.5 pr-2">
                <Link
                  href={coinUrl(coin.id, coin.symbol)}
                  className="flex items-center gap-2 hover:text-cyan-400 transition-colors min-w-0"
                >
                  <span className="font-medium text-white text-sm whitespace-nowrap">{coin.symbol}</span>
                  <span className="text-xs text-slate-500 truncate max-w-[90px] sm:max-w-none">{coin.name}</span>
                </Link>
              </td>
              <td className="py-2.5 pr-2 text-center">
                <HealthBadge status={coin.status} score={coin.healthScore} />
              </td>
              <td className="py-2.5 pr-2 text-center">
                <ScoreChange change={coin.scoreChange} />
              </td>
              <td className="py-2.5 pr-2 text-center">
                <SignalBadge signal={coin.signal} />
              </td>
              <td className="py-2.5 pr-2 text-center">
                <ConfidenceBadge confidence={coin.confidenceScore} />
              </td>
              <td className="py-2.5 pr-2 text-right text-sm text-slate-300">
                {coin.trendScore?.toFixed(0) || "-"}
              </td>
              <td className="py-2.5 pr-2 text-right text-sm text-slate-300">
                {coin.derivativeScore?.toFixed(0) || "-"}
              </td>
              <td className="py-2.5 pr-2 text-right text-sm text-slate-300">
                {coin.volumeScore?.toFixed(0) || "-"}
              </td>
              <td className="py-2.5 text-right text-sm text-slate-300">
                {coin.momentumScore?.toFixed(0) || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
