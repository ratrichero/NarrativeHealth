"use client";

import { useState } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { ChevronDown, ChevronRight, Gauge, HelpCircle } from "lucide-react";
import type {
  P4DecisionSupportViewModel,
  P4DegradationCode,
  P4DirectionState,
  P4EvidenceReference,
  P4EvidenceStatus,
  P4ExplanationItemRole,
  P4InterpretationRole,
  P4QualitativeValue,
} from "@/lib/p4/types";

// ---------------------------------------------------------------------------
// P4-02 §11 UI contract — pure presentation of the frozen ViewModel values.
// No interpretation, no transformation, no recommendation language.
// ---------------------------------------------------------------------------

/** Direction renders exactly the frozen value (P4-02 §3.2). */
const DIRECTION_STYLES: Record<P4DirectionState, string> = {
  POSITIVE: "border-green-500/30 bg-green-500/10 text-green-400",
  NEGATIVE: "border-red-500/30 bg-red-500/10 text-red-400",
  MIXED: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  NEUTRAL: "border-slate-500/40 bg-slate-700/40 text-slate-100",
  UNKNOWN: "border-slate-600/40 bg-slate-800/60 text-slate-400",
};

/** Qualitative values render as their exact frozen labels — never numbers. */
const QUALITATIVE_STYLES: Record<P4QualitativeValue, string> = {
  HIGH: "border-green-500/30 bg-green-500/10 text-green-400",
  MEDIUM: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  LOW: "border-slate-500/40 bg-slate-700/40 text-slate-300",
  UNKNOWN: "border-slate-600/40 bg-slate-800/60 text-slate-400",
};

/** Risk inverts the qualitative color semantics (adverse = emphasized). */
const RISK_STYLES: Record<P4QualitativeValue, string> = {
  HIGH: "border-red-500/30 bg-red-500/10 text-red-400",
  MEDIUM: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  LOW: "border-green-500/30 bg-green-500/10 text-green-400",
  UNKNOWN: "border-slate-600/40 bg-slate-800/60 text-slate-400",
};

const EVIDENCE_STATUS_STYLES: Record<P4EvidenceStatus, string> = {
  VALID: "border-green-500/30 bg-green-500/10 text-green-400",
  PARTIAL: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  STALE: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  INVALID: "border-red-500/30 bg-red-500/10 text-red-400",
  AMBIGUOUS: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  UNAVAILABLE: "border-slate-600/40 bg-slate-800/60 text-slate-400",
  INSUFFICIENT_HISTORY: "border-slate-600/40 bg-slate-800/60 text-slate-400",
  NOT_APPLICABLE: "border-slate-600/40 bg-slate-800/60 text-slate-400",
};

const ROLE_LABELS: Record<P4ExplanationItemRole, string> = {
  primary: "Primary",
  conflicting: "Conflicting",
  contextual: "Contextual",
  caveat: "Caveat",
};

const REF_ROLE_LABELS: Record<P4InterpretationRole, string> = {
  primary: "Primary",
  secondary: "Secondary",
  contextual: "Contextual",
  conflicting: "Conflicting",
};

const ROLE_BADGE_STYLES: Record<P4ExplanationItemRole, string> = {
  primary: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  conflicting: "border-red-500/30 bg-red-500/10 text-red-400",
  contextual: "border-slate-600/40 bg-slate-800/60 text-slate-300",
  caveat: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
};

const REF_ROLE_BADGE_STYLES: Record<P4InterpretationRole, string> = {
  primary: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  secondary: "border-slate-600/40 bg-slate-800/60 text-slate-300",
  contextual: "border-slate-600/40 bg-slate-800/60 text-slate-300",
  conflicting: "border-red-500/30 bg-red-500/10 text-red-400",
};

/** Degradation codes → human reasons (never fabricates a value). */
const DEGRADATION_REASONS: Record<P4DegradationCode, string> = {
  NO_VALID_CURRENT: "No valid current evidence",
  INSUFFICIENT_HISTORY: "Insufficient history for a comparison",
  CRITICAL_EVIDENCE_MISSING: "Critical evidence is missing",
  STALE: "Evidence is stale",
  INVALID: "Evidence is invalid",
  AMBIGUOUS: "Evidence is ambiguous",
  IDENTITY_AMBIGUOUS: "Evidence identity is ambiguous",
  P2_UNAVAILABLE: "P2 event risk evidence is unavailable",
};

function DirectionChip({ direction }: { direction: P4DirectionState }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-3 py-1.5 text-lg font-bold ${DIRECTION_STYLES[direction]}`}
    >
      {direction}
    </span>
  );
}

function QualitativeBadge({
  label,
  value,
  styles,
}: {
  label: string;
  value: P4QualitativeValue;
  styles: Record<P4QualitativeValue, string>;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-3">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-semibold ${styles[value]}`}>
        {value}
      </span>
    </div>
  );
}

function CollapsibleSection({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm text-slate-300 hover:text-white transition-colors"
      >
        <span>{label}</span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function EvidenceReferenceRow({ ref }: { ref: P4EvidenceReference }) {
  const isP2 = ref.sourceLayer === "P2";
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-800/30 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-medium ${REF_ROLE_BADGE_STYLES[ref.interpretationRole]}`}>
          {REF_ROLE_LABELS[ref.interpretationRole]}
        </span>
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-medium ${EVIDENCE_STATUS_STYLES[ref.status]}`}>
          {ref.status}
        </span>
        <span className="text-slate-300 font-medium">{ref.sourceType}</span>
        {isP2 && <span className="text-slate-400">P2 event risk</span>}
        <span className="text-slate-500">#{ref.sourceId}</span>
      </div>
      <div className="text-slate-400">
        field <span className="text-slate-300">{ref.field}</span>
        {" · "}window/date <span className="text-slate-300">{ref.windowOrDate}</span>
        {ref.artifactIdentity != null && (
          <>
            {" · "}artifact identity <span className="text-slate-300">{ref.artifactIdentity}</span>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * P4 Decision Support panel (P4-02 §11). Renders the frozen ViewModel
 * verbatim: Direction, Signals, Opportunity/Risk, Confidence/Actionability,
 * P4-04 explanation, traceable evidence. Pure presentation — no scoring, no
 * recommendation, no frontend interpretation. A null ViewModel renders a
 * compact unavailable state and never breaks the page.
 *
 * `defaultExpanded` is a presentation-only prop (seeds the collapsible state);
 * it carries no semantic meaning and is unused by the page.
 */
export function P4DecisionSupportPanel({
  viewModel,
  defaultExpanded = false,
}: {
  viewModel: P4DecisionSupportViewModel | null;
  defaultExpanded?: boolean;
}) {
  const [whyOpen, setWhyOpen] = useState(defaultExpanded);
  const [evidenceOpen, setEvidenceOpen] = useState(defaultExpanded);

  if (viewModel === null) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-slate-500" />
            <CardTitle>P4 Decision Support</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            P4 Decision Support is not available for this narrative yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { direction, degradation } = viewModel;
  const directionUnknown = direction === "UNKNOWN";
  const degraded = viewModel.status === "DEGRADED";
  const reasons = degradation.map((reason) => DEGRADATION_REASONS[reason.code]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-cyan-400" />
            <CardTitle>P4 Decision Support</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <Badge variant={degraded ? "warning" : "success"} size="sm">
              {degraded ? "Partial evidence" : "Available"}
            </Badge>
            {viewModel.asOf && (
              <span className="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/60">
                as of {viewModel.asOf.slice(0, 10)}
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {/* Decision Summary — Direction is the headline (P4-02 §11). */}
          <section aria-label="Decision summary">
            <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-2">Decision Summary</h3>
            <div className="flex flex-wrap items-center gap-3">
              <DirectionChip direction={direction} />
              {!directionUnknown && (
                <>
                  <span className="inline-flex items-center gap-2 text-sm text-slate-400">
                    Confidence
                    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-semibold ${QUALITATIVE_STYLES[viewModel.confidence]}`}>
                      {viewModel.confidence}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-2 text-sm text-slate-400">
                    Actionability
                    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-semibold ${QUALITATIVE_STYLES[viewModel.actionability]}`}>
                      {viewModel.actionability}
                    </span>
                  </span>
                </>
              )}
            </div>
          </section>

          {/* UNKNOWN direction — reason, never fabricated values (P4-02 §11). */}
          {directionUnknown && (
            <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-800/30 px-4 py-3 text-sm text-slate-400">
              <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-slate-500" />
              <div>
                <span className="text-slate-300">Evidence insufficient</span>
                {reasons.length > 0 ? ` — ${reasons.join("; ")}.` : "."}
              </div>
            </div>
          )}

          {/* Degraded banner (status DEGRADED with determinable direction). */}
          {degraded && !directionUnknown && reasons.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200/90">
              <HelpCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>Partial evidence — {reasons.join("; ")}.</div>
            </div>
          )}

          {/* Signals — catalog chips from the ViewModel (never inferred). */}
          <section aria-label="Signals">
            <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-2">Signals</h3>
            {viewModel.signals.length === 0 ? (
              <p className="text-sm text-slate-500">
                No signals fired for this window.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {viewModel.signals.map((signal) => (
                  <li
                    key={signal.id}
                    className="inline-flex flex-col gap-0.5 rounded-lg border border-slate-800 bg-slate-800/30 px-3 py-2 text-xs"
                  >
                    <span className="text-sm font-medium text-slate-200">{signal.label}</span>
                    <span className="flex items-center gap-2 text-slate-400">
                      <span>Direction {signal.directionRelation}</span>
                      {signal.severity && (
                        <span
                          className={`inline-flex items-center rounded border px-1.5 py-0.5 font-medium ${
                            signal.id === "EVIDENCE_CONFLICT"
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                              : "border-slate-600/40 bg-slate-800/60 text-slate-400"
                          }`}
                        >
                          {signal.severity} severity
                        </span>
                      )}
                      <span className="text-slate-500">{signal.evidenceRefs.length} refs</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Opportunity / Risk — hidden when Direction is UNKNOWN (§11). */}
          {!directionUnknown && (
            <section aria-label="Opportunity and risk">
              <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-2">Opportunity / Risk</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <QualitativeBadge label="Opportunity" value={viewModel.opportunity} styles={QUALITATIVE_STYLES} />
                <QualitativeBadge label="Risk" value={viewModel.risk} styles={RISK_STYLES} />
              </div>
            </section>
          )}

          {/* Historical context — contextual metadata only; the P3HistoricalTrend
              panel remains the history visualization (§11, no duplicate chart). */}
          {viewModel.historicalContext && (
            <section aria-label="Historical context">
              <h3 className="text-xs text-slate-500 uppercase tracking-wide mb-2">Historical Context</h3>
              <p className="text-xs text-slate-400">
                Series of {viewModel.historicalContext.seriesLength} artifacts ·{" "}
                {viewModel.historicalContext.steps} step{viewModel.historicalContext.steps === 1 ? "" : "s"} ·{" "}
                overall trend {viewModel.historicalContext.overallTrend} ·{" "}
                {viewModel.historicalContext.dataSufficiency.sufficient
                  ? "sufficient for comparison"
                  : "insufficient for comparison"}
                {" · "}current artifact #{viewModel.historicalContext.current?.artifactId ?? "—"}
              </p>
            </section>
          )}

          {/* Why? — exact P4-04 explanation output (§7). */}
          <CollapsibleSection
            open={whyOpen}
            onToggle={() => setWhyOpen((open) => !open)}
            label={whyOpen ? "Hide explanation" : "Why? — explanation"}
          >
            {viewModel.explanation.items.length === 0 ? (
              <p className="text-xs text-slate-500">No explanation available.</p>
            ) : (
              <ol className="space-y-2">
                {viewModel.explanation.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-800/30 px-3 py-2.5"
                  >
                    <span className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-xs font-medium ${ROLE_BADGE_STYLES[item.role]}`}>
                      {ROLE_LABELS[item.role]}
                    </span>
                    <p className="text-sm text-slate-200">{item.statement}</p>
                  </li>
                ))}
              </ol>
            )}
          </CollapsibleSection>

          {/* Evidence — traceable references with role/status/provenance (§8). */}
          <CollapsibleSection
            open={evidenceOpen}
            onToggle={() => setEvidenceOpen((open) => !open)}
            label={evidenceOpen ? "Hide evidence" : "Evidence — traceability"}
          >
            {viewModel.evidence.length === 0 ? (
              <p className="text-xs text-slate-500">No evidence references available.</p>
            ) : (
              <ul className="space-y-2">
                {viewModel.evidence.map((ref, index) => (
                  <EvidenceReferenceRow key={`${ref.sourceType}-${ref.sourceId}-${ref.field}-${index}`} ref={ref} />
                ))}
              </ul>
            )}
          </CollapsibleSection>
        </div>
      </CardContent>
    </Card>
  );
}
