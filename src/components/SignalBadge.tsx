import { Badge } from "./ui/Badge";
import type { RecommendationSignal } from "@/types";

interface SignalBadgeProps {
  signal: RecommendationSignal | null;
}

const signalConfig: Record<
  RecommendationSignal,
  { label: string; variant: "success" | "warning" | "danger" | "neutral" }
> = {
  STRONG_WATCH: { label: "Strong Watch", variant: "success" },
  WATCH: { label: "Watch", variant: "success" },
  OBSERVE: { label: "Observe", variant: "warning" },
  CAUTION: { label: "Caution", variant: "warning" },
  WEAK: { label: "Weak", variant: "danger" },
};

export function SignalBadge({ signal }: SignalBadgeProps) {
  if (!signal) {
    return <Badge variant="neutral">-</Badge>;
  }

  const config = signalConfig[signal];

  return <Badge variant={config.variant}>{config.label}</Badge>;
}
