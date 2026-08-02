import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface ConfidenceBadgeProps {
  confidence: number | null;
  showWarning?: boolean;
}

export function ConfidenceBadge({ confidence, showWarning = true }: ConfidenceBadgeProps) {
  if (confidence === null) {
    return <span className="text-xs text-slate-500">-</span>;
  }

  const isLow = confidence < 70;
  const isMedium = confidence >= 70 && confidence < 90;

  return (
    <div className="flex items-center gap-1">
      {showWarning && isLow && (
        <AlertTriangle className="h-3 w-3 text-yellow-500" />
      )}
      <span
        className={cn(
          "text-xs",
          isLow && "text-yellow-500",
          isMedium && "text-slate-400",
          !isLow && !isMedium && "text-slate-300"
        )}
      >
        {confidence.toFixed(0)}%
      </span>
    </div>
  );
}
