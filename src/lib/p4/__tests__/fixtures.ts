import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { P3AvailabilityState } from "@/lib/p3/availability";
import type {
  P3IntelligenceHistoryViewModel,
  P3TrendState,
  P3TrendStep,
} from "@/lib/types/p3-intelligence-history";
import type { EventRisk } from "@/lib/types/event-risk";
import { assembleP4Evidence, classifyP2, type P2AssemblyEvidence, type P4AssemblyResult } from "../assembler";

/**
 * P4-05A test fixtures — persisted P3 view models, history and P2 events in
 * the exact shape the P3 read services produce. All values are deterministic;
 * tests derive assertions from the frozen P4-03 canonical scenarios.
 */

const DAY_MS = 86_400_000;

/** Base frontend-safe artifact read model (P3 read services output). */
export function makeVm(
  overrides: Partial<P3IntelligenceViewModel> & { artifactId: number; windowEnd: string }
): P3IntelligenceViewModel {
  return {
    narrativeId: 1,
    window: "7D",
    windowEndLabel: "11 Aug 2026",
    calculationMode: "observed",
    algorithmKey: "p3-orchestrator",
    algorithmVersion: "1",
    availabilityState: "VALID",
    regime: { availabilityState: "VALID", classification: "NEUTRAL", display: "NEUTRAL" },
    rotation: { availabilityState: "VALID", classification: "STABLE", score: 50, scoreDisplay: "50.00" },
    breadth: { availabilityState: "VALID", value: 0.5, display: "0.500" },
    momentum: { availabilityState: "VALID", value: 1, display: "+1.00" },
    relativeStrength: { availabilityState: "VALID", value: 0.02, display: "+0.020" },
    leadership: { availabilityState: "VALID", coinId: 1, symbol: "BTC", score: 80, scoreDisplay: "80.00" },
    constituents: { count: 10, availabilityState: "VALID" },
    ...overrides,
  };
}

function deltaDisplay(prev: number | null, curr: number | null): string {
  if (prev == null || curr == null) return "—";
  const delta = curr - prev;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
}

/** A latest-step trend comparison over two artifacts (frozen P3-18 shape). */
export function makeStep(spec: {
  previous: P3IntelligenceViewModel;
  current: P3IntelligenceViewModel;
  regime?: P3TrendState;
  rotation?: P3TrendState;
  rotationScore?: P3TrendState;
  momentum?: P3TrendState;
  breadth?: P3TrendState;
  relativeStrength?: P3TrendState;
  leadership?: P3TrendState;
  leaderChanged?: boolean;
  leaderScoreDelta?: number | null;
  rotationScoreDelta?: number | null;
  momentumDelta?: number | null;
  breadthDelta?: number | null;
  relativeStrengthDelta?: number | null;
}): P3TrendStep {
  const {
    previous,
    current,
    regime = "STABLE",
    rotation = "STABLE",
    rotationScore = "STABLE",
    momentum = "STABLE",
    breadth = "STABLE",
    relativeStrength = "STABLE",
    leadership = "STABLE",
    leaderChanged = false,
  } = spec;

  const rotationScoreDelta = spec.rotationScoreDelta ?? (rotationScore === "STABLE" ? 0 : null);
  const momentumDelta = spec.momentumDelta ?? (momentum === "STABLE" ? 0 : null);
  const breadthDelta = spec.breadthDelta ?? (breadth === "STABLE" ? 0 : null);
  const relativeStrengthDelta = spec.relativeStrengthDelta ?? (relativeStrength === "STABLE" ? 0 : null);

  const leaderScoreDelta =
    spec.leaderScoreDelta ?? (leadership === "STABLE" ? 0 : null);

  const prevLeader = previous.leadership;
  const currLeader = current.leadership;
  const leadershipChanged = leaderChanged || (prevLeader.coinId != null && currLeader.coinId != null && prevLeader.coinId !== currLeader.coinId);

  const step: P3TrendStep = {
    previous,
    current,
    regime: {
      previous: previous.regime.classification,
      current: current.regime.classification,
      state: regime,
    },
    rotation: {
      previous: previous.rotation.classification,
      current: current.rotation.classification,
      state: rotation,
    },
    rotationScore: {
      previous: previous.rotation.score,
      current: current.rotation.score,
      delta: rotationScoreDelta,
      previousDisplay: previous.rotation.scoreDisplay,
      currentDisplay: current.rotation.scoreDisplay,
      deltaDisplay: deltaDisplay(previous.rotation.score, current.rotation.score),
      state: rotationScore,
    },
    breadth: {
      previous: previous.breadth.value,
      current: current.breadth.value,
      delta: breadthDelta,
      previousDisplay: previous.breadth.display,
      currentDisplay: current.breadth.display,
      deltaDisplay: deltaDisplay(previous.breadth.value, current.breadth.value),
      state: breadth,
    },
    momentum: {
      previous: previous.momentum.value,
      current: current.momentum.value,
      delta: momentumDelta,
      previousDisplay: previous.momentum.display,
      currentDisplay: current.momentum.display,
      deltaDisplay: deltaDisplay(previous.momentum.value, current.momentum.value),
      state: momentum,
    },
    relativeStrength: {
      previous: previous.relativeStrength.value,
      current: current.relativeStrength.value,
      delta: relativeStrengthDelta,
      previousDisplay: previous.relativeStrength.display,
      currentDisplay: current.relativeStrength.display,
      deltaDisplay: deltaDisplay(previous.relativeStrength.value, current.relativeStrength.value),
      state: relativeStrength,
    },
    leadership: {
      previous: {
        coinId: prevLeader.coinId,
        symbol: prevLeader.symbol,
        score: prevLeader.score,
        scoreDisplay: prevLeader.scoreDisplay,
      },
      current: {
        coinId: currLeader.coinId,
        symbol: currLeader.symbol,
        score: currLeader.score,
        scoreDisplay: currLeader.scoreDisplay,
      },
      changed: leadershipChanged,
      scoreDelta: leaderScoreDelta,
      scoreDeltaDisplay: deltaDisplay(prevLeader.score, currLeader.score),
      state: leadership,
    },
    constituents: {
      previousCount: previous.constituents.count,
      currentCount: current.constituents.count,
      added: [],
      removed: [],
      changed: false,
      state: "STABLE",
    },
    state: regime === "IMPROVING" || rotation === "IMPROVING" || momentum === "IMPROVING"
      ? "IMPROVING"
      : regime === "DETERIORATING" || rotation === "DETERIORATING" || momentum === "DETERIORATING"
        ? "DETERIORATING"
        : "STABLE",
  };
  return step;
}

/** Same-identity historical series + trend (frozen P3-18 read model). */
export function makeHistory(opts: {
  seriesLength?: number;
  windowEnd?: string;
  trendOverall?: P3TrendState;
  step?: P3TrendStep;
  narrativeId?: number;
  window?: string;
} = {}): P3IntelligenceHistoryViewModel {
  const seriesLength = opts.seriesLength ?? 3;
  const windowEnd = opts.windowEnd ?? "2026-08-11T00:00:00.000Z";
  const trendOverall = opts.trendOverall ?? "IMPROVING";
  const narrativeId = opts.narrativeId ?? 1;
  const window = opts.window ?? "7D";

  const series: P3IntelligenceViewModel[] = [];
  for (let i = 0; i < seriesLength; i += 1) {
    const artifactWindowEnd = new Date(new Date(windowEnd).getTime() - (seriesLength - 1 - i) * DAY_MS).toISOString();
    series.push(
      makeVm({
        artifactId: 100 + i,
        windowEnd: artifactWindowEnd,
        narrativeId,
        window,
      })
    );
  }

  const current = series[series.length - 1];
  const previous = series.length >= 2 ? series[series.length - 2] : null;

  const latestStep =
    opts.step ??
    (previous
      ? makeStep({ previous, current })
      : undefined);

  const trend = {
    regime: "STABLE",
    rotation: "STABLE",
    rotationScore: "STABLE",
    breadth: "STABLE",
    momentum: "STABLE",
    relativeStrength: "STABLE",
    leadership: "STABLE",
    constituents: "STABLE",
    overall: trendOverall,
  } as const;

  return {
    identity: {
      narrativeId: current.narrativeId,
      window: current.window,
      algorithmKey: current.algorithmKey,
      algorithmVersion: current.algorithmVersion,
      calculationMode: current.calculationMode,
    },
    series,
    current,
    previous,
    steps: latestStep ? [latestStep] : [],
    trend,
    dataSufficiency: {
      comparableArtifacts: seriesLength,
      requiredMinimum: 2,
      sufficient: seriesLength >= 2,
    },
  };
}

/** Normalize a partial event spec into an EventRisk row. */
export function makeEventRisk(overrides: Partial<EventRisk> & { title: string }): EventRisk {
  return {
    id: 1,
    coinId: null,
    narrativeId: null,
    eventType: "UNLOCK",
    eventDate: "2026-08-10",
    riskLevel: "HIGH",
    riskScore: null,
    description: null,
    sourceUrl: null,
    isActive: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: null,
    ...overrides,
  };
}

/** Build a P2 assembly from compact event specs (scope classified by §10). */
export function makeP2(opts?: {
  narrativeWide?: Array<Partial<EventRisk> & { title: string }>;
  coinLocal?: Array<Partial<EventRisk> & { title: string; symbol?: string | null }>;
}): P2AssemblyEvidence {
  const narrativeWideEvents = (opts?.narrativeWide ?? []).map((event) => makeEventRisk(event));
  const coinLocalEvents = (opts?.coinLocal ?? []).map((event) => ({
    ...makeEventRisk(event),
    symbol: event.symbol ?? null,
  }));
  return classifyP2({ narrativeWideEvents, coinLocalEvents });
}

/** Default current artifact — matches the default history's latest artifact (id 102). */
export function makeDefaultCurrent(): P3IntelligenceViewModel {
  return makeVm({ artifactId: 102, windowEnd: "2026-08-11T00:00:00.000Z" });
}

/**
 * Assemble evidence from explicit current/history/P2 (pure — no DB).
 * Defaults are identity-consistent: current = latest series artifact.
 */
export function makeAssembly(opts: {
  current?: P3IntelligenceViewModel | null;
  history?: P3IntelligenceHistoryViewModel | null;
  p2?: P2AssemblyEvidence;
} = {}): P4AssemblyResult {
  return assembleP4Evidence({
    current: opts.current !== undefined ? opts.current : makeDefaultCurrent(),
    history: opts.history !== undefined ? opts.history : makeHistory({ seriesLength: 3 }),
    p2: opts.p2 ?? makeP2(),
  });
}

export type { P3AvailabilityState, P4AssemblyResult };
