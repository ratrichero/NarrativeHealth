"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardContent, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { BrainCircuit, ChevronDown, ChevronRight } from "lucide-react";
import type { P3AvailabilityState, P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { P3IntelligenceHistoryViewModel } from "@/lib/types/p3-intelligence-history";
import { P3HistoricalTrend } from "./P3HistoricalTrend";

// ---------------------------------------------------------------------------
// Availability-state semantics (Part F)
// ---------------------------------------------------------------------------

const STATE_LABELS: Record<P3AvailabilityState, string> = {
  VALID: "Valid",
  MISSING: "Missing",
  INVALID: "Invalid",
  STALE: "Stale",
  INSUFFICIENT_HISTORY: "Insufficient data",
  NOT_APPLICABLE: "N/A",
  AMBIGUOUS: "Ambiguous",
};

const STATE_VARIANTS: Record<P3AvailabilityState, "success" | "warning" | "danger" | "neutral"> = {
  VALID: "success",
  MISSING: "neutral",
  INVALID: "danger",
  STALE: "warning",
  INSUFFICIENT_HISTORY: "warning",
  NOT_APPLICABLE: "neutral",
  AMBIGUOUS: "warning",
};

/**
 * A persisted VALID classification (e.g. regime NEUTRAL) is rendered from its
 * stored value and is never treated as an unavailable state. NOT_APPLICABLE is
 * a distinct availability state rendered via the state badge ("N/A") only.
 */
export function classificationChipClass(classification: string): string {
  const value = classification.toUpperCase();
  switch (value) {
    case "EMERGING":
    case "STRONG":
      return "border-green-500/30 bg-green-500/10 text-green-400";
    case "MATURE":
    case "WEAKENING":
    case "STABLE":
      return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
    case "DEAD":
    case "DECELERATING":
    case "OUTFLOW":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    case "INFLOW":
    case "ACCELERATING":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-400";
    case "NEUTRAL":
      return "border-slate-500/40 bg-slate-700/40 text-slate-100";
    default:
      return "border-slate-600/40 bg-slate-800/60 text-slate-300";
  }
}

function AvailabilityBadge({ state }: { state: P3AvailabilityState }) {
  return (
    <Badge variant={STATE_VARIANTS[state]} size="sm">
      {STATE_LABELS[state]}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StageTile({
  label,
  state,
  display,
}: {
  label: string;
  state: P3AvailabilityState;
  display: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-800/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
        <AvailabilityBadge state={state} />
      </div>
      <div className="text-lg font-semibold text-white tabular-nums">{display}</div>
    </div>
  );
}

function ClassificationRow({
  label,
  classification,
  state,
  score,
  scoreDisplay,
}: {
  label: string;
  classification: string | null;
  state: P3AvailabilityState;
  score?: number | null;
  scoreDisplay?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-3">
      <span className="text-sm text-slate-400">{label}</span>
      <div className="flex items-center gap-2">
        {classification != null && classification !== "" ? (
          <span
            className={`inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-semibold ${classificationChipClass(classification)}`}
          >
            {classification}
          </span>
        ) : (
          <AvailabilityBadge state={state} />
        )}
        {score != null && <span className="text-xs text-slate-500 tabular-nums">{scoreDisplay}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function P3IntelligencePanel({
  narrativeName,
  viewModel,
  history,
}: {
  narrativeName: string;
  viewModel: P3IntelligenceViewModel | null;
  history?: P3IntelligenceHistoryViewModel | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-cyan-400" />
            <CardTitle>P3 Intelligence</CardTitle>
          </div>
          {viewModel && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/60">
                {narrativeName} · {viewModel.window} · {viewModel.windowEndLabel}
              </span>
              <AvailabilityBadge state={viewModel.availabilityState} />
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {viewModel === null ? (
          <p className="text-sm text-slate-500">
            No P3 intelligence available for this narrative yet.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Regime + Rotation (priority 1-2) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ClassificationRow
                label="Regime"
                classification={viewModel.regime.classification}
                state={viewModel.regime.availabilityState}
              />
              <ClassificationRow
                label="Rotation"
                classification={viewModel.rotation.classification}
                state={viewModel.rotation.availabilityState}
                score={viewModel.rotation.score}
                scoreDisplay={viewModel.rotation.scoreDisplay}
              />
            </div>

            {/* Breadth / Momentum / Relative Strength (priority 3-5) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StageTile label="Breadth" state={viewModel.breadth.availabilityState} display={viewModel.breadth.display} />
              <StageTile label="Momentum" state={viewModel.momentum.availabilityState} display={viewModel.momentum.display} />
              <StageTile
                label="Rel. Strength"
                state={viewModel.relativeStrength.availabilityState}
                display={viewModel.relativeStrength.display}
              />
            </div>

            {/* Leadership (priority 6) */}
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-3">
              <span className="text-sm text-slate-400">Leadership</span>
              {viewModel.leadership.coinId != null && viewModel.leadership.symbol != null ? (
                <div className="flex items-center gap-3">
                  <Link
                    href={`/coin/${viewModel.leadership.coinId}`}
                    className="text-sm font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    {viewModel.leadership.symbol}
                  </Link>
                  <span className="text-sm text-slate-300 tabular-nums">
                    {viewModel.leadership.scoreDisplay}
                  </span>
                  <AvailabilityBadge state={viewModel.leadership.availabilityState} />
                </div>
              ) : (
                <AvailabilityBadge state={viewModel.leadership.availabilityState} />
              )}
            </div>

            {/* Provenance / explainability (Part H — lightweight) */}
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {detailsOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {detailsOpen ? "Hide details" : "Why? — window, mode & stage validity"}
            </button>

            <P3HistoricalTrend narrativeName={narrativeName} history={history ?? null} />

            {detailsOpen && (
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400 space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <div>Calculation window</div>
                  <div className="text-slate-200">{viewModel.window} · ends {viewModel.windowEndLabel}</div>
                  <div>Calculation mode</div>
                  <div className="text-slate-200">{viewModel.calculationMode}</div>
                  <div>Algorithm</div>
                  <div className="text-slate-200">
                    {viewModel.algorithmKey}/{viewModel.algorithmVersion}
                  </div>
                  <div>Availability</div>
                  <div className="text-slate-200">{viewModel.availabilityState}</div>
                  <div>Constituents</div>
                  <div className="text-slate-200">
                    {viewModel.constituents.count != null ? `${viewModel.constituents.count} members` : "—"}
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-800">
                  <div className="mb-1.5 text-slate-500">Stage validity</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="flex items-center gap-1.5">
                      Regime <AvailabilityBadge state={viewModel.regime.availabilityState} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      Rotation <AvailabilityBadge state={viewModel.rotation.availabilityState} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      Breadth <AvailabilityBadge state={viewModel.breadth.availabilityState} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      Momentum <AvailabilityBadge state={viewModel.momentum.availabilityState} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      Rel. Strength{" "}
                      <AvailabilityBadge state={viewModel.relativeStrength.availabilityState} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      Leadership <AvailabilityBadge state={viewModel.leadership.availabilityState} />
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
