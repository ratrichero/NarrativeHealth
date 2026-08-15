"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react";
import type { P3TrendState, P3IntelligenceHistoryViewModel, P3TrendStep } from "@/lib/types/p3-intelligence-history";
import { classificationChipClass } from "./P3IntelligencePanel";

// ---------------------------------------------------------------------------
// Trend-state badges (P3-14 Part D semantics)
// ---------------------------------------------------------------------------

const TREND_LABELS: Record<P3TrendState, string> = {
  IMPROVING: "Improving",
  DETERIORATING: "Deteriorating",
  STABLE: "Stable",
  TRANSITION: "Transition",
  UNKNOWN: "Unknown",
};

function trendBadgeClass(state: P3TrendState): string {
  switch (state) {
    case "IMPROVING":
      return "border-green-500/30 bg-green-500/10 text-green-400";
    case "DETERIORATING":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    case "TRANSITION":
      return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
    case "STABLE":
      return "border-slate-600/40 bg-slate-800/60 text-slate-300";
    default:
      return "border-slate-700/50 bg-slate-800/40 text-slate-400";
  }
}

function TrendBadge({ state }: { state: P3TrendState }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${trendBadgeClass(state)}`}
    >
      {TREND_LABELS[state]}
    </span>
  );
}

function Chip({ value }: { value: string | null }) {
  if (value == null || value === "") {
    return <span className="text-slate-500">—</span>;
  }
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${classificationChipClass(value)}`}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function SeriesChain({ history }: { history: P3IntelligenceHistoryViewModel }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 text-xs font-medium text-slate-400 uppercase tracking-wide">
        Windows
      </div>
      <div className="space-y-1.5">
        {history.series.map((artifact, index) => (
          <div key={artifact.artifactId} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-20 shrink-0 text-xs text-slate-500 tabular-nums">
                {artifact.windowEndLabel}
              </span>
              <Chip value={artifact.regime.classification} />
              <Chip value={artifact.rotation.classification} />
              {artifact.rotation.score != null && (
                <span className="text-xs text-slate-400 tabular-nums">
                  {artifact.rotation.scoreDisplay}
                </span>
              )}
            </div>
            {index < history.series.length - 1 && (
              <div className="pl-10 text-slate-600">↓</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  previous,
  current,
  delta,
  state,
}: {
  label: string;
  previous: string;
  current: string;
  delta: string;
  state: P3TrendState;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-2.5">
      <span className="text-sm text-slate-400">{label}</span>
      <div className="flex items-center gap-3 text-sm tabular-nums">
        <span className="text-slate-500">{previous}</span>
        <span className="text-slate-600">→</span>
        <span className="text-slate-200">{current}</span>
        <span className="w-20 text-right text-xs text-slate-400">{delta}</span>
        <TrendBadge state={state} />
      </div>
    </div>
  );
}

function ClassificationRow({
  label,
  previous,
  current,
  state,
}: {
  label: string;
  previous: string | null;
  current: string | null;
  state: P3TrendState;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-2.5">
      <span className="text-sm text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        <Chip value={previous} />
        <span className="text-slate-600">→</span>
        <Chip value={current} />
        <TrendBadge state={state} />
      </div>
    </div>
  );
}

function LatestStepRows({ step }: { step: P3TrendStep }) {
  return (
    <div className="space-y-2">
      <div className="mb-1 text-xs font-medium text-slate-400 uppercase tracking-wide">
        Previous → Current · {step.previous.windowEndLabel} → {step.current.windowEndLabel}
      </div>
      <ClassificationRow label="Regime" previous={step.regime.previous} current={step.regime.current} state={step.regime.state} />
      <ClassificationRow label="Rotation" previous={step.rotation.previous} current={step.rotation.current} state={step.rotation.state} />
      <MetricRow
        label="Rotation score"
        previous={step.rotationScore.previousDisplay}
        current={step.rotationScore.currentDisplay}
        delta={step.rotationScore.deltaDisplay}
        state={step.rotationScore.state}
      />
      <MetricRow
        label="Breadth"
        previous={step.breadth.previousDisplay}
        current={step.breadth.currentDisplay}
        delta={step.breadth.deltaDisplay}
        state={step.breadth.state}
      />
      <MetricRow
        label="Momentum"
        previous={step.momentum.previousDisplay}
        current={step.momentum.currentDisplay}
        delta={step.momentum.deltaDisplay}
        state={step.momentum.state}
      />
      <MetricRow
        label="Rel. Strength"
        previous={step.relativeStrength.previousDisplay}
        current={step.relativeStrength.currentDisplay}
        delta={step.relativeStrength.deltaDisplay}
        state={step.relativeStrength.state}
      />
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-2.5">
        <span className="text-sm text-slate-400">Leadership</span>
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className="text-slate-500">
            {step.leadership.previous?.symbol ?? "—"} {step.leadership.previous?.scoreDisplay ?? ""}
          </span>
          <span className="text-slate-600">→</span>
          <span className="text-slate-200">
            {step.leadership.current?.symbol ?? "—"} {step.leadership.current?.scoreDisplay ?? ""}
          </span>
          <span className="w-20 text-right text-xs text-slate-400">
            {step.leadership.scoreDeltaDisplay}
          </span>
          <TrendBadge state={step.leadership.state} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-2.5">
        <span className="text-sm text-slate-400">Constituents</span>
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className="text-slate-500">{step.constituents.previousCount ?? "—"}</span>
          <span className="text-slate-600">→</span>
          <span className="text-slate-200">{step.constituents.currentCount ?? "—"}</span>
          <span className="w-20 text-right text-xs text-slate-400">
            {step.constituents.changed
              ? `+${step.constituents.added.length}/-${step.constituents.removed.length}`
              : "—"}
          </span>
          <TrendBadge state={step.constituents.state} />
        </div>
      </div>
    </div>
  );
}

function TrendSummary({ history }: { history: P3IntelligenceHistoryViewModel }) {
  const items: Array<[string, P3TrendState]> = [
    ["Regime", history.trend.regime],
    ["Rotation", history.trend.rotation],
    ["Momentum", history.trend.momentum],
    ["Breadth", history.trend.breadth],
    ["Rel. Str.", history.trend.relativeStrength],
    ["Leadership", history.trend.leadership],
    ["Constituents", history.trend.constituents],
  ];
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">
          Trend · {history.series.length} windows
        </span>
        <TrendBadge state={history.trend.overall} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map(([label, state]) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
            {label}
            <TrendBadge state={state} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function P3HistoricalTrend({
  narrativeName,
  history,
  defaultOpen = false,
}: {
  narrativeName: string;
  history: P3IntelligenceHistoryViewModel | null;
  /** Render the disclosure open (used by SSR/tests). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // No history at all: the parent panel already communicates the absence of P3
  // data; nothing extra to disclose here.
  if (history === null) return null;

  const insufficient = history.steps.length === 0;

  return (
    <div className="border-t border-slate-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-300">
          <TrendingUp className="h-4 w-4 text-cyan-400" />
          Historical Trend
          {!insufficient && <TrendBadge state={history.trend.overall} />}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-500" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {insufficient ? (
            <p className="text-sm text-slate-500">
              Not enough history yet — {history.series.length} same-identity
              artifact{history.series.length === 1 ? "" : "s"} available. At
              least {history.dataSufficiency.requiredMinimum} are required to
              compare windows.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2 text-xs text-slate-400">
                {narrativeName} · {history.identity.window} · algorithm{" "}
                {history.identity.algorithmKey}/{history.identity.algorithmVersion} ·{" "}
                {history.identity.calculationMode}
              </div>
              <SeriesChain history={history} />
              <LatestStepRows step={history.steps[history.steps.length - 1]} />
              <TrendSummary history={history} />
              <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="sr-only"
                aria-hidden="true"
              >
                close
              </button>
              <p className="text-xs text-slate-500">
                Why? — deltas compare only same-identity artifacts
                (narrative · window · algorithm · mode), ordered by window end.
                Epsilon thresholds follow the P3-14 contract.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
