export * from "./availability";
export * from "./constituents";
export * from "./context";
export * from "./persistence";
export * from "./windows";
export * from "./breadth";

// P3 Momentum is owned by the existing MomentumService (AD-003). Re-export the
// P3-facing API so kernel consumers share one engine — no parallel Momentum path.
export {
  P3_MOMENTUM_ALGORITHM_KEY,
  P3_MOMENTUM_ALGORITHM_VERSION,
  DEFAULT_ACCELERATION_THRESHOLDS,
  calculateWindowMomentum,
  calculateP3Momentum,
  calculateP3MomentumResult,
  calculateAcceleration,
  classifyAcceleration,
  projectP3ToLegacy,
  utcDateLabel,
  parseUtcDateLabel,
  momentumService,
} from "@/lib/services/momentum.service";
export type { MomentumService } from "@/lib/services/momentum.service";
