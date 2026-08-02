import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ScoreChangeProps {
  change: number | null;
  showIcon?: boolean;
  className?: string;
}

export function ScoreChange({ change, showIcon = true, className }: ScoreChangeProps) {
  if (change === null || change === undefined) {
    return (
      <div className={cn("flex items-center gap-1 text-slate-500", className)}>
        {showIcon && <Minus className="h-3 w-3" />}
        <span className="text-xs">-</span>
      </div>
    );
  }

  const isPositive = change >= 1;
  const isNegative = change <= -1;
  const isSignificant = Math.abs(change) >= 5;

  return (
    <div
      className={cn(
        "flex items-center gap-1",
        isPositive && "text-green-500",
        isNegative && "text-red-500",
        !isPositive && !isNegative && "text-slate-500",
        className
      )}
    >
      {showIcon && (
        <>
          {isPositive && <TrendingUp className={cn("h-3 w-3", isSignificant && "h-4 w-4")} />}
          {isNegative && <TrendingDown className={cn("h-3 w-3", isSignificant && "h-4 w-4")} />}
          {!isPositive && !isNegative && <Minus className="h-3 w-3" />}
        </>
      )}
      <span className="text-xs font-medium">
        {isPositive && "+"}
        {change.toFixed(1)}
      </span>
    </div>
  );
}
