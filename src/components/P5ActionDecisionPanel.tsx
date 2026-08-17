"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import {
  ClipboardList,
  Eye,
  History,
  Info,
  Lock,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type {
  P5ActionDecisionReadViewModel,
  P5DisplayState,
  P5ReadAvailability,
} from "@/lib/p5/types";

// ---------------------------------------------------------------------------
// P5-06C UI contract — pure presentation of the frozen P5 read model values.
// No interpretation, no transformation, no recommendation language, no
// execution surface. "Approved" never means "executed"; "selected" never
// means "executed"; an absent record is never rendered as "No action."
// ---------------------------------------------------------------------------

const DISPLAY_STATE_META: Record<P5DisplayState, { label: string; className: string; note: string }> = {
  NO_ACTION: {
    label: "NO_ACTION",
    className: "border-slate-500/40 bg-slate-700/40 text-slate-200",
    note: "Policy evaluation completed; no action was selected.",
  },
  POLICY_BLOCKED: {
    label: "POLICY-BLOCKED",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    note: "A candidate existed but a policy rule prevented selection.",
  },
  NOT_DETERMINED: {
    label: "NOT_DETERMINED",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    note: "The system could not reliably determine the policy outcome.",
  },
  SUPPRESSED: {
    label: "SUPPRESSED",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    note: "Cooldown/duplicate suppression applied — no decision was produced.",
  },
  SELECTED: {
    label: "SELECTED",
    className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
    note: "An eligible candidate was selected by policy. Selection is not approval and not execution.",
  },
  SAFETY_BLOCKED: {
    label: "SAFETY-BLOCKED",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    note: "The safety/guardrail layer rejected the action — safety constraints were not satisfied.",
  },
  APPROVAL_DENIED: {
    label: "APPROVAL-DENIED",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    note: "The required authority/approval was not granted.",
  },
  ABSENT: {
    label: "ABSENT",
    className: "border-slate-600/40 bg-slate-800/60 text-slate-400",
    note: "No P5 action decision record exists for this narrative.",
  },
  UNAVAILABLE: {
    label: "UNAVAILABLE",
    className: "border-slate-600/40 bg-slate-800/60 text-slate-400",
    note: "The read layer could not establish the decision state — see availability below.",
  },
};

const AVAILABILITY_META: Record<
  P5ReadAvailability,
  { label: string; className: string; message: string }
> = {
  OK: {
    label: "OK",
    className: "border-green-500/30 bg-green-500/10 text-green-400",
    message: "Decision record present and readable.",
  },
  NO_DECISION_RECORD: {
    label: "NO_DECISION_RECORD",
    className: "border-slate-600/40 bg-slate-800/60 text-slate-400",
    message:
      "This narrative has no P5 action decision record. Nothing was selected, blocked, suppressed, denied, or executed. This is an absence of records — not an action outcome.",
  },
  DECISION_NOT_FOUND: {
    label: "DECISION_NOT_FOUND",
    className: "border-slate-600/40 bg-slate-800/60 text-slate-400",
    message: "No decision exists for the requested decision identity.",
  },
  P4_CONTEXT_UNAVAILABLE: {
    label: "P4_CONTEXT_UNAVAILABLE",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    message:
      "No decision record exists and the P4 context could not be derived. This is an unavailability — it is not the same as a completed NO_ACTION evaluation.",
  },
  SERVICE_ERROR: {
    label: "SERVICE_ERROR",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
    message: "The read service failed. This is an infrastructure failure — it is not an action outcome.",
  },
};

const STATE_CHIP = "px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/60 text-xs text-slate-300";
const LABEL = "text-xs uppercase tracking-wider text-slate-500 font-medium";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={LABEL}>{label}</span>
      <span className="text-sm text-slate-200">{value}</span>
    </div>
  );
}

function JsonValue({ value }: { value: unknown }) {
  return <code className="text-xs text-slate-400 break-all">{JSON.stringify(value)}</code>;
}

export function P5ActionDecisionPanel({ narrativeId }: { narrativeId: number | string }) {
  const { data, isLoading } = useQuery<P5ActionDecisionReadViewModel>({
    queryKey: ["p5-action-decision", narrativeId],
    queryFn: async () => {
      const response = await fetch(`/api/narratives/${narrativeId}/action-decision`);
      const body = await response.json();
      if (!body.success) throw new Error(body.error || "Failed to read P5 action decision");
      return body.data.p5ActionDecision as P5ActionDecisionReadViewModel;
    },
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-slate-500" />
            <CardTitle>P5 Action Decision</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">Loading read-only action decision state…</p>
        </CardContent>
      </Card>
    );
  }

  const display = DISPLAY_STATE_META[data.displayState];
  const availability = AVAILABILITY_META[data.availability];
  const decision = data.decision;
  const context = data.context;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-cyan-400" />
            <CardTitle>P5 Action Decision</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral" size="sm">
              <Lock className="h-3 w-3 mr-1" /> Read-only
            </Badge>
            <Badge variant="neutral" size="sm">Advisory-only</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Decision state classification */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium ${display.className}`}>
            {data.displayState}
          </span>
          <span className="text-xs text-slate-400">{display.note}</span>
        </div>

        {/* Availability — explicit, distinct from domain outcomes */}
        <div className={`rounded-lg border px-3 py-2 text-xs ${availability.className}`}>
          <span className="font-medium">Availability: {data.availability}</span>
          <span className="block mt-0.5 text-slate-400">{availability.message}</span>
          {data.error && <span className="block mt-0.5 text-slate-500">Detail: {data.error.message}</span>}
        </div>

        {/* Orthogonal state dimensions — never collapsed */}
        <div>
          <span className={LABEL}>State dimensions (orthogonal — not one status)</span>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className={STATE_CHIP}>decision: {decision?.decisionState ?? "—"}</span>
            <span className={STATE_CHIP}>approval: {decision?.approvalState ?? "—"}</span>
            <span className={STATE_CHIP}>execution: {decision?.executionState ?? "—"}</span>
          </div>
        </div>

        {decision ? (
          <>
            {/* 1. What was decided */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Row label="Decision ID" value={decision.decisionId} />
              <Row label="Candidate ID" value={decision.candidateId ?? "—"} />
              <Row label="Action ID" value={decision.actionId ?? "— (created only if SELECTED)"} />
              <Row label="Outcome" value={decision.outcome} />
              <Row label="Action type" value={decision.actionType ?? "—"} />
              <Row label="Parameters" value={decision.parameters ? <JsonValue value={decision.parameters} /> : "—"} />
            </div>
            {decision.suppressed && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
                Suppressed by cooldown/duplicate policy — no decision was produced (SUPPRESSED, not NO_ACTION).
              </div>
            )}
            {decision.blockerReport && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                Blocker: {decision.blockerReport.source}
                {decision.blockerReport.ref ? ` · ${decision.blockerReport.ref}` : ""}
                {decision.blockerReport.reason ? ` — ${decision.blockerReport.reason}` : ""}
              </div>
            )}

            {/* 2. Why — explanation derived from records */}
            <div>
              <span className={LABEL}>Why (explanation of the recorded decision)</span>
              <div className="mt-1 space-y-1 text-sm text-slate-300">
                <p>{decision.explanation.what || "—"}</p>
                {decision.explanation.why && <p className="text-slate-400">{decision.explanation.why}</p>}
                {decision.explanation.whatDidNotHappen.length > 0 && (
                  <p className="text-slate-500">
                    Did not happen: {decision.explanation.whatDidNotHappen.join("; ")}
                  </p>
                )}
              </div>
            </div>

            {/* 3-7. Policy / Safety / Approval / Permission / Execution */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-700/60 px-3 py-2">
                <Row label="Policy" value={decision.provenance.policy.policyVersion ?? "—"} />
                <div className="mt-1">
                  <span className={LABEL}>Rules</span>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {decision.provenance.policy.ruleRefs.length > 0
                      ? decision.provenance.policy.ruleRefs.join(", ")
                      : "—"}
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/60 px-3 py-2">
                <Row label="Safety / guardrail" value={decision.safetyResult?.aggregate ?? "NOT_EVALUATED"} />
                <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                  {decision.safetyResult?.guardrailResults.map((g) => (
                    <div key={g.guardrailId}>
                      {g.guardrailId} ({g.outcome})
                      {g.reason ? ` — ${g.reason}` : ""}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/60 px-3 py-2">
                <Row
                  label="Approval (explicit authorization event)"
                  value={decision.approvalRecord ? decision.approvalRecord.approvalId : decision.approvalState}
                />
                <div className="mt-0.5 text-xs text-slate-500">
                  Acknowledging an alert or a P2 evidence status is NOT approval.
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/60 px-3 py-2">
                <Row label="Execution permission" value={decision.permissionResult} />
                <div className="mt-0.5 text-xs text-slate-500">
                  Permission is an authorization result — it is not execution.
                </div>
              </div>
            </div>
            <Row label="Execution result" value={decision.executionState} />
            <p className="text-xs text-slate-500">
              {decision.executionState === "EXECUTED"
                ? "Recorded execution result (from the execution layer)."
                : "No execution has occurred. v1 is advisory-only: no execution mechanism exists."}
            </p>

            {/* 9. Audit history — read-only */}
            <div>
              <span className={`${LABEL} flex items-center gap-1`}>
                <History className="h-3 w-3" /> Audit history (read-only)
              </span>
              {decision.auditEvents.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">No audit events recorded.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {decision.auditEvents.map((event) => (
                    <li key={event.eventId} className="text-xs text-slate-400 flex flex-wrap gap-x-2">
                      <span className="text-slate-300">{event.eventType}</span>
                      <span>{event.timestamp}</span>
                      {event.actor && <span>by {event.actor}</span>}
                      {event.previousState && <span>{event.previousState} → {event.newState}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Provenance */}
            <div>
              <span className={`${LABEL} flex items-center gap-1`}>
                <Eye className="h-3 w-3" /> Provenance
              </span>
              <div className="mt-1 rounded-lg bg-slate-900/60 border border-slate-800 px-3 py-2">
                <JsonValue value={decision.provenance} />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* ABSENT / UNAVAILABLE — never "No action." */}
            <div className="rounded-lg border border-slate-700/60 px-3 py-2">
              <span className={LABEL}>P4 context {context?.source === "LIVE_P4_CONTEXT" ? "(live — not a decision basis)" : ""}</span>
              {context?.p4SnapshotRef ? (
                <div className="mt-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={STATE_CHIP}>
                      P4 status: {context.p4SnapshotRef.status}
                    </span>
                    <span className={STATE_CHIP}>as of {context.p4SnapshotRef.asOf}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    The P4 status above preserves any UNKNOWN / DEGRADED /
                    NO_EVIDENCE condition — it is never rendered as an action.
                    Full degradation detail is shown in the P4 Decision Support panel.
                  </p>
                  <JsonValue value={context.p4SnapshotRef} />
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-400">
                  No P4 context could be derived. See availability above.
                </p>
              )}
            </div>
            <div className="flex items-start gap-2 text-xs text-slate-500">
              {data.displayState === "UNAVAILABLE" ? (
                <XCircle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
              ) : (
                <Info className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
              )}
              <span>
                {data.displayState === "UNAVAILABLE"
                  ? "The decision state could not be established. This is not a NO_ACTION outcome."
                  : "No decision record exists. This is an absence of records — not a completed NO_ACTION evaluation, and not a blocked/denied action."}
              </span>
            </div>
          </>
        )}

        {/* Read-only / safety boundary note */}
        <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-500">
          <ShieldAlert className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
          <span>
            Informational read surface only. This panel does not create, approve,
            reject, or execute actions. There is no execution mechanism in v1
            (advisory-only). No buy/sell/order semantics exist anywhere in P5-06.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
