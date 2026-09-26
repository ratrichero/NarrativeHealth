"use client";

/**
 * Narrative phase workflow — P3 → P4 → P5 → P6.
 *
 * Dải workflow nằm ngay trên khối Coins (đọc theo thứ tự diễn giải: chuyện gì
 * đang xảy ra → nghĩa là gì → nên cân nhắc gì → hệ thống cảnh báo gì). Mỗi node
 * = kết luận ngắn gọn 1 dòng lấy từ dữ liệu thật của tầng đó; nhấn node để
 * mở/đóng khối chi tiết bên dưới. Khối chi tiết tái sử dụng NGUYÊN VĂN các
 * panel tầng hiện có — không thay đổi hợp đồng hiển thị nào của P3/P4/P5/P6.
 *
 * Quy ước kết luận (đọc từ read model có sẵn, không tính toán mới):
 *  - P3: regime + rotation + breadth của artifact VALID mới nhất.
 *  - P4: direction (frozen vocabulary) + số signal bắn trong interpretation.
 *  - P5: presence + displayState của decision read view — ABSENT (chưa có bản
 *    ghi quyết định) là trạng thái hiển thị riêng, không lẫn với NO_ACTION.
 *  - P6: regime + số warning active + health delta của P6 pipeline.
 */

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Compass,
  Gauge,
} from "lucide-react";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { P3IntelligenceHistoryViewModel } from "@/lib/types/p3-intelligence-history";
import type { P4DecisionSupportViewModel } from "@/lib/p4/types";
import type { P5ActionDecisionReadViewModel, P5DisplayState } from "@/lib/p5/types";
import type {
  NarrativeIntelligenceDTO,
  P6ApiResponse,
} from "@/lib/p6/presentation";
import { P3IntelligencePanel } from "@/components/P3IntelligencePanel";
import { P4DecisionSupportPanel } from "@/components/P4DecisionSupportPanel";
import { P5ActionDecisionPanel } from "@/components/P5ActionDecisionPanel";
import { P6IntelligencePanel } from "@/components/P6IntelligencePanel";

// ─── Data ────────────────────────────────────────────────────────────────────────

async function fetchP5ActionDecision(
  narrativeId: number
): Promise<P5ActionDecisionReadViewModel | null> {
  const response = await fetch(`/api/narratives/${narrativeId}/action-decision`);
  const body = await response.json();
  if (!body.success) return null;
  return (body.data?.p5ActionDecision ?? null) as P5ActionDecisionReadViewModel | null;
}

async function fetchP6NarrativeIntelligence(
  narrativeId: number
): Promise<NarrativeIntelligenceDTO | null> {
  const response = await fetch(`/api/p6/narratives/${narrativeId}`);
  const body: P6ApiResponse<NarrativeIntelligenceDTO> = await response.json();
  if (!body.success) return null;
  return body.data ?? null;
}

// ─── Conclusion models ───────────────────────────────────────────────────────────

interface PhaseNode {
  id: "P3" | "P4" | "P5" | "P6";
  title: string;
  question: string;
  detail: ReactNode | null;
}

const P5_DISPLAY_STATE_META: Record<P5DisplayState, { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  NO_ACTION: { label: "No action", tone: "neutral" },
  POLICY_BLOCKED: { label: "Blocked", tone: "danger" },
  NOT_DETERMINED: { label: "Undetermined", tone: "warning" },
  SUPPRESSED: { label: "Suppressed", tone: "warning" },
  SELECTED: { label: "Selected", tone: "success" },
  SAFETY_BLOCKED: { label: "Safety blocked", tone: "danger" },
  APPROVAL_DENIED: { label: "Approval denied", tone: "danger" },
  ABSENT: { label: "Chưa có bản ghi quyết định", tone: "neutral" },
  UNAVAILABLE: { label: "Không khả dụng", tone: "warning" },
};

function phaseTone(state: string): "neutral" | "success" | "warning" | "danger" {
  const positive = ["STRONG", "POSITIVE", "HIGH", "ACCELERATING", "INFLOW", "SELECTED", "BROADENING", "IMPROVING"];
  const negative = ["WEAK", "WEAKENING", "NEGATIVE", "DEAD", "DETERIORATING", "NARROWING", "DECELERATING"];
  const s = state.toUpperCase();
  if (positive.some((p) => s.includes(p))) return "success";
  if (negative.some((n) => s.includes(n))) return "danger";
  return "neutral";
}

// ─── Component ───────────────────────────────────────────────────────────────────

export function PhaseWorkflow({
  narrativeId,
  narrativeName,
  p3Intelligence,
  p3History,
  p4ViewModel,
}: {
  narrativeId: number;
  narrativeName: string;
  p3Intelligence: P3IntelligenceViewModel | null;
  p3History: P3IntelligenceHistoryViewModel | null;
  p4ViewModel: P4DecisionSupportViewModel | null;
}) {
  // P5/P6 tự fetch — P5 panel cũng tự fetch với cùng queryKey nên cache chung.
  const { data: p5View } = useQuery({
    queryKey: ["p5-action-decision", narrativeId],
    queryFn: () => fetchP5ActionDecision(narrativeId),
    enabled: narrativeId > 0,
  });
  const { data: p6View } = useQuery({
    queryKey: ["p6-intelligence", "narrative", narrativeId],
    queryFn: () => fetchP6NarrativeIntelligence(narrativeId),
    enabled: narrativeId > 0,
  });

  const [openPhase, setOpenPhase] = useState<"P3" | "P4" | "P5" | "P6" | null>(null);

  const toggle = (id: "P3" | "P4" | "P5" | "P6") =>
    setOpenPhase((cur) => (cur === id ? null : id));

  // ─── Kết luận từng tầng ────────────────────────────────────────────────────────

  // P3 — "Chuyện gì đang xảy ra?"
  const p3 = p3Intelligence;
  const p3Regime = p3?.regime.classification ?? null;
  const p3Rotation = p3?.rotation.classification ?? null;
  const p3Breadth = p3?.breadth.value ?? null;
  const p3Line = p3
    ? [
        p3Regime ? `Regime ${p3Regime}` : null,
        p3Rotation ? `rotation ${p3Rotation.toLowerCase()}` : null,
        p3Breadth != null ? `breadth ${(p3Breadth * 100).toFixed(0)}%` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  // P4 — "Nghĩa là gì?"
  const p4 = p4ViewModel;
  const p4SignalCount = p4?.signals.length ?? 0;
  const p4Line = p4
    ? p4.status === "DEGRADED"
      ? "Interpretation degraded — dữ liệu chưa đủ để kết luận đầy đủ"
      : `Direction ${p4.direction.toLowerCase()}${p4SignalCount > 0 ? ` · ${p4SignalCount} signal${p4SignalCount > 1 ? "s" : ""} active` : ""}`
    : null;

  // P5 — "Nên cân nhắc gì?"
  const p5 = p5View ?? null;
  const p5Meta = p5 ? P5_DISPLAY_STATE_META[p5.displayState] : null;
  const p5Line = !p5
    ? null
    : p5.decisionPresence === "PRESENT" && p5.decision
      ? p5Meta
        ? `${p5Meta.label}${p5.decision.actionType ? ` — ${p5.decision.actionType}` : ""}`
        : p5.displayState
      : "Chưa có bản ghi quyết định cho chu kỳ này";

  // P6 — "Hệ thống cảnh báo gì?"
  const p6 = p6View ?? null;
  const activeWarnings = p6?.warnings.filter((w) => w.lifecycle === "ACTIVE") ?? [];
  const p6Line = !p6
    ? null
    : `${p6.regime ? p6.regime.replace(/_/g, " ").toLowerCase() : "regime unknown"} · ${activeWarnings.length} active warning${activeWarnings.length === 1 ? "" : "s"}`;

  const nodes: PhaseNode[] = [
    {
      id: "P3",
      title: "P3 — Chuyện gì đang xảy ra?",
      question: "Intelligence",
      detail: (
        <P3IntelligencePanel
          narrativeName={narrativeName}
          viewModel={p3Intelligence}
          history={p3History}
        />
      ),
    },
    {
      id: "P4",
      title: "P4 — Nghĩa là gì?",
      question: "Decision support",
      detail: <P4DecisionSupportPanel viewModel={p4ViewModel} />,
    },
    {
      id: "P5",
      title: "P5 — Nên cân nhắc gì?",
      question: "Action decision",
      detail: <P5ActionDecisionPanel narrativeId={narrativeId} />,
    },
    {
      id: "P6",
      title: "P6 — Hệ thống cảnh báo gì?",
      question: "Early warning",
      detail: (
        <P6IntelligencePanel entityType="narrative" entityId={narrativeId} entityName={narrativeName} />
      ),
    },
  ];

  return (
    <Card className="border-slate-800 bg-slate-900/60">
      <div className="p-4 md:p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {nodes.map((node, idx) => {
            const conclusion =
              node.id === "P3" ? p3Line
              : node.id === "P4" ? p4Line
              : node.id === "P5" ? p5Line
              : p6Line;
            const tone =
              node.id === "P3" ? phaseTone(p3Regime ?? "")
              : node.id === "P4" ? phaseTone(p4?.direction ?? "")
              : node.id === "P5" ? (p5Meta?.tone ?? "neutral")
              : phaseTone(p6?.regime ?? "");

            const isOpen = openPhase === node.id;
            const Icon = node.id === "P3" ? Activity : node.id === "P4" ? Compass : node.id === "P5" ? ClipboardList : Gauge;

            return (
              <div key={node.id} className="relative">
                {/* connector (desktop) */}
                {idx > 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 -left-3 hidden h-px w-3 bg-slate-700 md:block"
                  />
                )}
                <button
                  type="button"
                  onClick={() => toggle(node.id)}
                  aria-expanded={isOpen}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    isOpen
                      ? "border-cyan-500/50 bg-cyan-500/5"
                      : "border-slate-800 bg-slate-900/80 hover:border-slate-600"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${isOpen ? "text-cyan-400" : "text-slate-400"}`} />
                      <span className="text-sm font-semibold text-white">{node.id}</span>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-500" />
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{node.question}</p>
                  <div className="mt-2">
                    {conclusion ? (
                      <Badge variant={tone}>
                        {conclusion.length > 44 ? `${conclusion.slice(0, 44)}…` : conclusion}
                      </Badge>
                    ) : (
                      <Badge variant="neutral">No data</Badge>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Khối chi tiết của phase đang mở — tái sử dụng panel tầng nguyên văn */}
      {openPhase !== null && (
        <div className="border-t border-slate-800 p-4 md:p-5">
          {nodes.map((node) =>
            node.id === openPhase ? (
              <div key={node.id}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
                  {node.title}
                </h3>
                {node.detail}
              </div>
            ) : null
          )}
        </div>
      )}
    </Card>
  );
}
