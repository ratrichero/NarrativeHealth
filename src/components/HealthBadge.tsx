import { Badge } from "./ui/Badge";
import type { HealthStatus } from "@/types";

interface HealthBadgeProps {
  status: HealthStatus | null;
  score?: number;
  showScore?: boolean;
}

const statusConfig: Record<
  HealthStatus,
  { label: string; variant: "success" | "warning" | "danger" | "neutral" }
> = {
  STRONG: { label: "Strong", variant: "success" },
  HEALTHY: { label: "Healthy", variant: "success" },
  NEUTRAL: { label: "Neutral", variant: "warning" },
  CAUTION: { label: "Caution", variant: "warning" },
  WEAK: { label: "Weak", variant: "danger" },
};

export function HealthBadge({ status, score, showScore = true }: HealthBadgeProps) {
  if (!status) {
    return (
      <Badge variant="neutral">
        <span className="mr-1">-</span>
        <span>No Data</span>
      </Badge>
    );
  }

  const config = statusConfig[status];

  return (
    <Badge variant={config.variant}>
      <span className="mr-1">
        {config.variant === "success" && "🟢"}
        {config.variant === "warning" && "🟡"}
        {config.variant === "danger" && "🔴"}
      </span>
      {showScore && score !== undefined ? (
        <span>{score.toFixed(0)}</span>
      ) : (
        <span>{config.label}</span>
      )}
    </Badge>
  );
}
