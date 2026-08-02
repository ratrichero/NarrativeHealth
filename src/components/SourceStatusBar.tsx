import { cn } from "@/lib/utils";
import type { SourceStatusSummary } from "@/types";

interface SourceStatusBarProps {
  sourceStatus: SourceStatusSummary;
}

const statusColor = {
  OK: "bg-green-500",
  PARTIAL: "bg-yellow-500",
  FAILED: "bg-red-500",
};

export function SourceStatusBar({ sourceStatus }: SourceStatusBarProps) {
  const sources = [
    { key: "binanceSpot", label: "Binance Spot", status: sourceStatus.binanceSpot },
    { key: "binanceFutures", label: "Binance Futures", status: sourceStatus.binanceFutures },
    { key: "coingecko", label: "CoinGecko", status: sourceStatus.coingecko },
  ];

  return (
    <div className="flex items-center gap-4">
      {sources.map((source) => (
        <div key={source.key} className="flex items-center gap-2">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              statusColor[source.status.status] || "bg-gray-500"
            )}
          />
          <span className="text-xs text-slate-400">{source.label}</span>
        </div>
      ))}
    </div>
  );
}
