"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import {
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Info,
  Lock,
  ShieldAlert,
  XCircle,
  Clock,
} from "lucide-react";
import type {
  P5ActionDecisionReadViewModel,
  P5DisplayState,
  P5ReadAvailability,
} from "@/lib/p5/types";
import {
  buildPresentationModel,
  type P5DecisionPresentationModel,
} from "@/lib/p5/read/presentation-model";

// ---------------------------------------------------------------------------
// Display state styling — same frozen vocabulary, user-facing labels
// ---------------------------------------------------------------------------

const DISPLAY_STATE_META: Record<
  P5DisplayState,
  { label: string; className: string; note: string }
> = {
  NO_ACTION: {
    label: "NO ACTION",
    className: "border-slate-500/40 bg-slate-700/40 text-slate-200",
    note: "Policy evaluation completed; no action was selected.",
  },
  POLICY_BLOCKED: {
    label: "BLOCKED",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    note: "A policy rule prevented an action.",
  },
  NOT_DETERMINED: {
    label: "UNDETERMINED",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    note: "Insufficient data for a reliable determination.",
  },
  SUPPRESSED: {
    label: "SUPPRESSED",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    note: "Suppressed by cooldown or duplicate detection.",
  },
  SELECTED: {
    label: "SELECTED",
    className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
    note: "An action was selected by the policy system.",
  },
  SAFETY_BLOCKED: {
    label: "SAFETY BLOCKED",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    note: "Safety constraints were not satisfied.",
  },
  APPROVAL_DENIED: {
    label: "APPROVAL DENIED",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    note: "Required authorization was not granted.",
  },
  ABSENT: {
    label: "NO DECISION",
    className: "border-slate-600/40 bg-slate-800/60 text-slate-400",
    note: "No decision has been made for this narrative yet.",
  },
  UNAVAILABLE: {
    label: "UNAVAILABLE",
    className: "border-slate-600/40 bg-slate-800/60 text-slate-400",
    note: "Could not determine the decision state.",
  },
};

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: "border-green-500/30 bg-green-500/10 text-green-400",
  MEDIUM: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  LOW: "border-red-500/30 bg-red-500/10 text-red-400",
};

const LABEL = "text-xs uppercase tracking-wider text-slate-500 font-medium";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={LABEL}>{label}</span>
      <span className="text-sm text-slate-200">{value}</span>
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
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

export function P5ActionDecisionPanel({
  narrativeId,
  initialData,
}: {
  narrativeId: number | string;
  initialData?: P5ActionDecisionReadViewModel | null;
}) {
  const [technicalOpen, setTechnicalOpen] = useState(false);

  const { data: fetchedData, isLoading } =
    useQuery<P5ActionDecisionReadViewModel>({
      queryKey: ["p5-action-decision", narrativeId],
      queryFn: async () => {
        const response = await fetch(
          `/api/narratives/${narrativeId}/action-decision`
        );
        const body = await response.json();
        if (!body.success)
          throw new Error(
            body.error || "Failed to read P5 action decision"
          );
        return body.data.p5ActionDecision as P5ActionDecisionReadViewModel;
      },
      enabled: initialData === undefined,
    });

  const rawData = initialData ?? fetchedData ?? null;

  if ((initialData === undefined && isLoading) || !rawData) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-slate-500" />
            <CardTitle>Decision</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">
            Loading decision state…
          </p>
        </CardContent>
      </Card>
    );
  }

  // Transform raw data into user-facing presentation model
  const model = buildPresentationModel(rawData);
  const display = DISPLAY_STATE_META[model.displayState];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-cyan-400" />
            <CardTitle>Decision</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" size="sm">
              <Lock className="h-3 w-3 mr-1" /> Read-only
            </Badge>
            <Badge variant="neutral" size="sm">Advisory</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ================================================================
            SECTION 1: Executive Decision Summary
            "What does the system think?"
            ================================================================ */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-5 space-y-4">
          {/* State badge */}
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-semibold ${display.className}`}
            >
              {display.label}
            </span>
            {model.executive.posture && (
              <span className="text-lg font-bold text-white">
                {model.executive.posture}
              </span>
            )}
          </div>

          {/* Headline — what the system thinks */}
          <p className="text-base text-slate-200 leading-relaxed">
            {model.executive.headline}
          </p>

          {/* Rationale — why */}
          <div>
            <span className={LABEL}>Why?</span>
            <p className="mt-1 text-sm text-slate-300 leading-relaxed">
              {model.executive.rationale}
            </p>
          </div>

          {/* Confidence — with guidance */}
          {model.confidence.level && (
            <div className="flex items-start gap-3">
              <span className={LABEL}>Confidence</span>
              <span
                className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${CONFIDENCE_STYLES[model.confidence.level] ?? "border-slate-600/40 bg-slate-800/60 text-slate-400"}`}
              >
                {model.confidence.level}
              </span>
            </div>
          )}
          <p className="text-xs text-slate-400 leading-relaxed">
            {model.confidence.meaning}
          </p>

          {/* What should I do? — recommended posture */}
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
            <span className={LABEL}>What should I do?</span>
            <p className="mt-1 text-sm text-slate-200 leading-relaxed">
              {model.executive.guidance}
            </p>
          </div>
        </div>

        {/* ================================================================
            SECTION 2: Plain-language Why (detailed facts)
            ================================================================ */}
        {model.why && model.why.facts.length > 0 && (
          <div>
            <span className={LABEL}>How the system decided</span>
            <ul className="mt-2 space-y-1.5">
              {model.why.facts.map((fact, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-slate-300"
                >
                  <span className="text-slate-500 mt-0.5">•</span>
                  <span>
                    <span className="text-slate-400">{fact.label}:</span>{" "}
                    {fact.value}
                  </span>
                </li>
              ))}
            </ul>
            {model.why.alternatives.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                Not considered: {model.why.alternatives.join("; ")}
              </p>
            )}
          </div>
        )}

        {/* ================================================================
            SECTION 3: Decision History
            ================================================================ */}
        {model.history.length > 0 && (
          <div>
            <span className={`${LABEL} flex items-center gap-1`}>
              <Clock className="h-3 w-3" /> Decision history
            </span>
            <div className="mt-2 space-y-1.5">
              {model.history.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 text-sm"
                >
                  {entry.isCurrent && (
                    <span className="text-xs text-cyan-400 font-medium">
                      Current
                    </span>
                  )}
                  {!entry.isCurrent && (
                    <span className="text-xs text-slate-500 w-14">
                      Previous
                    </span>
                  )}
                  <span className="text-slate-200 font-medium">
                    {entry.label}
                  </span>
                  <span className="text-xs text-slate-500">{entry.date}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ================================================================
            SECTION 4: Availability (when no decision)
            ================================================================ */}
        {!model.hasDecision && (
          <div className="rounded-lg border border-slate-700/60 px-4 py-3">
            <p className="text-sm text-slate-400">
              {rawData.availability === "NO_DECISION_RECORD"
                ? "This narrative has not been evaluated by the decision system yet. A decision will be created when the narrative is first processed."
                : rawData.availability === "P4_CONTEXT_UNAVAILABLE"
                  ? "The underlying data needed for a decision is currently unavailable."
                  : rawData.availability === "SERVICE_ERROR"
                    ? "The decision system encountered a technical issue. Please try again later."
                    : "No decision record is available."}
            </p>
          </div>
        )}

        {/* ================================================================
            SECTION 5: Technical Details (collapsed by default)
            ================================================================ */}
        <CollapsibleSection
          open={technicalOpen}
          onToggle={() => setTechnicalOpen((o) => !o)}
          label={technicalOpen ? "Hide technical details" : "Technical details"}
        >
          <div className="space-y-3">
            {/* Core decision fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {model.technical.decisionId && (
                <Row label="Decision ID" value={model.technical.decisionId} />
              )}
              {model.technical.outcome && (
                <Row label="Outcome" value={model.technical.outcome} />
              )}
              {model.technical.actionType && (
                <Row label="Action type" value={model.technical.actionType} />
              )}
              <Row
                label="Suppressed"
                value={model.technical.suppressed ? "Yes" : "No"}
              />
              {model.technical.policyVersion && (
                <Row
                  label="Policy version"
                  value={model.technical.policyVersion}
                />
              )}
              {model.technical.ruleRefs.length > 0 && (
                <Row
                  label="Rules evaluated"
                  value={model.technical.ruleRefs.join(", ")}
                />
              )}
            </div>

            {/* Safety / Approval / Permission / Execution */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Row
                label="Safety"
                value={model.technical.safetyAggregate ?? "—"}
              />
              <Row
                label="Approval"
                value={model.technical.approvalState ?? "—"}
              />
              <Row
                label="Permission"
                value={model.technical.permissionResult ?? "—"}
              />
              <Row
                label="Execution"
                value={model.technical.executionState ?? "—"}
              />
            </div>

            {/* Blocker */}
            {model.technical.blockerReport && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
                Blocker: {model.technical.blockerReport.source}
                {model.technical.blockerReport.reason
                  ? ` — ${model.technical.blockerReport.reason}`
                  : ""}
              </div>
            )}

            {/* Audit events */}
            {model.technical.auditEvents.length > 0 && (
              <div>
                <span className={LABEL}>Audit events</span>
                <ul className="mt-1 space-y-1">
                  {model.technical.auditEvents.map((event, i) => (
                    <li
                      key={i}
                      className="text-xs text-slate-400 flex flex-wrap gap-x-2"
                    >
                      <span className="text-slate-300">
                        {event.eventType}
                      </span>
                      <span>{event.timestamp}</span>
                      {event.actor && <span>by {event.actor}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Provenance */}
            {model.technical.provenance != null && (
              <div>
                <span className={LABEL}>Provenance</span>
                <div className="mt-1 rounded-lg bg-slate-900/60 border border-slate-800 px-3 py-2">
                  <code className="text-xs text-slate-400 break-all">
                    {JSON.stringify(model.technical.provenance as Record<string, unknown>)}
                  </code>
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Safety boundary note */}
        <div className="flex items-start gap-2 text-xs text-slate-500">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            This is an advisory-only read surface. No actions are created,
            approved, or executed. The decision system provides guidance — it
            does not take action on your behalf.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
