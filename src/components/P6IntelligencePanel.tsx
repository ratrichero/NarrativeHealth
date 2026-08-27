"use client";

/**
 * P6-09C — P6 Intelligence Panel
 *
 * Consumes:
 *   /api/p6/coins/[id] or /api/p6/narratives/[id]   → P6-07 presentation DTO
 *   /api/p6/history/[entityType]/[id]?window=7d|30d|baseline  → P6-08 comparison
 *
 * Does NOT:
 *   - recalculate health/regime/warnings
 *   - import P4/P5 modules
 *   - contain action/BUY/SELL semantics
 *   - modify any frozen P6 contract
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AlertCircle, Clock, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import type { P6ApiResponse, CoinIntelligenceDTO, NarrativeIntelligenceDTO, WarningDTO } from "@/lib/p6/presentation";
import type { HistoricalComparisonResult } from "@/lib/p6/historical/types";

// ─── TYPES ────────────────────────────────────────────────────────

interface P6IntelligencePanelProps {
  entityType: "coin" | "narrative";
  entityId: number;
  entityName: string;
}

type ComparisonWindow = "7d" | "30d" | "baseline";

// ─── API FETCHERS ─────────────────────────────────────────────────

async function fetchP6CoinIntelligence(id: number): Promise<CoinIntelligenceDTO | null> {
  const response = await fetch(`/api/p6/coins/${id}`);
  const json: P6ApiResponse<CoinIntelligenceDTO> = await response.json();
  if (!json.success) throw new Error(json.error || "Failed to fetch P6 intelligence");
  return json.data;
}

async function fetchP6NarrativeIntelligence(id: number): Promise<NarrativeIntelligenceDTO | null> {
  const response = await fetch(`/api/p6/narratives/${id}`);
  const json: P6ApiResponse<NarrativeIntelligenceDTO> = await response.json();
  if (!json.success) throw new Error(json.error || "Failed to fetch P6 intelligence");
  return json.data;
}

async function fetchHistoricalComparison(
  entityType: string,
  entityId: number,
  window: ComparisonWindow
): Promise<HistoricalComparisonResult | null> {
  const response = await fetch(`/api/p6/history/${entityType}/${entityId}?window=${window}`);
  const json = await response.json();
  if (!json.success) throw new Error(json.error || "Failed to fetch historical comparison");
  return json.data?.comparison ?? null;
}

// ─── HELPER COMPONENTS ────────────────────────────────────────────

function RegimeIndicator({ regime }: { regime: string | null }) {
  if (!regime) return <Badge variant="neutral">Unknown</Badge>;

  const colorMap: Record<string, string> = {
    STRONG_UPTREND: "success",
    UPTREND: "success",
    RANGING: "neutral",
    DOWNTREND: "danger",
    STRONG_DOWNTREND: "danger",
    UNKNOWN: "neutral",
  };

  const label = regime.replace(/_/g, " ");

  return (
    <Badge variant={(colorMap[regime] as any) || "neutral"}>
      {label}
    </Badge>
  );
}

function WarningList({ warnings }: { warnings: ReadonlyArray<WarningDTO> }) {
  if (warnings.length === 0) {
    return <p className="text-slate-500 text-sm">No active warnings</p>;
  }

  const severityColor: Record<string, string> = {
    HIGH: "text-red-400",
    MEDIUM: "text-yellow-400",
    LOW: "text-slate-400",
    CRITICAL: "text-red-500",
  };

  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <div key={w.warning_id} className="flex items-center gap-3 text-sm">
          <span className={severityColor[w.severity] || "text-slate-400"}>
            ●
          </span>
          <span className="text-white font-medium">{w.warning_type.replace(/_/g, " ")}</span>
          <span className="text-slate-500">· {w.severity}</span>
          <span className="text-slate-600 text-xs">
            detected {new Date(w.detection_window).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExplanationList({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{ category: string; text: string; severity: string | null }> | undefined;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs text-slate-500 uppercase tracking-wider mb-1">{title}</h4>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-slate-300">
            <span className="text-slate-500">[{item.category}]</span>{" "}
            {item.text}
            {item.severity && (
              <span className="text-xs text-slate-600 ml-1">({item.severity})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonWindowSelector({
  selected,
  onChange,
}: {
  selected: ComparisonWindow | null;
  onChange: (w: ComparisonWindow | null) => void;
}) {
  const windows: Array<{ value: ComparisonWindow | null; label: string }> = [
    { value: null, label: "Off" },
    { value: "7d", label: "7 Days" },
    { value: "30d", label: "30 Days" },
    { value: "baseline", label: "Baseline" },
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">Compare:</span>
      {windows.map((w) => (
        <button
          key={w.label}
          onClick={() => onChange(w.value)}
          className={`px-2 py-1 text-xs rounded ${
            selected === w.value
              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
              : "bg-slate-800/50 text-slate-400 hover:bg-slate-700/50"
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

function DeltaDisplay({
  current,
  historical,
  label,
}: {
  current: number | null;
  historical: number | null;
  label: string;
}) {
  if (current === null || historical === null) return null;

  const delta = current - historical;
  const pct = historical !== 0 ? (delta / historical) * 100 : null;
  const isPositive = delta > 0;
  const isZero = delta === 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">{label}:</span>
      <span className="text-white font-medium">{current.toFixed(2)}</span>
      <span className="text-slate-600">→</span>
      <span className="text-slate-400">{historical.toFixed(2)}</span>
      <span
        className={`font-medium ${
          isZero ? "text-slate-400" : isPositive ? "text-green-400" : "text-red-400"
        }`}
      >
        {isPositive ? "+" : ""}
        {delta.toFixed(2)}
      </span>
      {pct !== null && (
        <span
          className={`text-xs ${
            isZero ? "text-slate-500" : isPositive ? "text-green-500" : "text-red-500"
          }`}
        >
          ({isPositive ? "+" : ""}
          {pct.toFixed(1)}%)
        </span>
      )}
    </div>
  );
}

function ComparisonResultDisplay({ comparison }: { comparison: HistoricalComparisonResult }) {
  return (
    <div className="space-y-3 mt-3 p-3 bg-slate-800/30 rounded-lg border border-slate-700/50">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Clock className="h-3 w-3" />
        <span>
          Comparing: {comparison.comparison_window} · Current:{" "}
          {comparison.current?.window_end
            ? new Date(comparison.current.window_end).toLocaleDateString()
            : "N/A"}{" "}
          vs Historical:{" "}
          {comparison.historical?.window_end
            ? new Date(comparison.historical.window_end).toLocaleDateString()
            : "N/A"}
        </span>
      </div>

      {comparison.insufficient_history ? (
        <p className="text-sm text-yellow-400">
          Insufficient historical data for {comparison.comparison_window} comparison.
        </p>
      ) : (
        <>
          <DeltaDisplay
            current={comparison.current?.health_score ?? null}
            historical={comparison.historical?.health_score ?? null}
            label="Health"
          />
          <DeltaDisplay
            current={comparison.current?.confidence_score ?? null}
            historical={comparison.historical?.confidence_score ?? null}
            label="Confidence"
          />

          {comparison.delta?.regime_changed !== undefined && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Regime:</span>
              <span className="text-slate-400">{comparison.historical_regime ?? "N/A"}</span>
              <span className="text-slate-600">→</span>
              <span className="text-white">{comparison.current_regime ?? "N/A"}</span>
              {comparison.delta.regime_changed && (
                <Badge variant="warning" className="text-xs">Changed</Badge>
              )}
            </div>
          )}

          {comparison.new_warnings.length > 0 && (
            <div>
              <span className="text-xs text-slate-500">New warnings: </span>
              {comparison.new_warnings.map((w, i) => (
                <Badge key={i} variant="danger" className="text-xs ml-1">
                  {w.warning_type}
                </Badge>
              ))}
            </div>
          )}

          {comparison.resolved_warnings.length > 0 && (
            <div>
              <span className="text-xs text-slate-500">Resolved: </span>
              {comparison.resolved_warnings.map((w, i) => (
                <Badge key={i} variant="success" className="text-xs ml-1">
                  {w.warning_type}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}

      {comparison.provenance && (
        <details className="mt-2">
          <summary className="text-xs text-slate-600 cursor-pointer hover:text-slate-400">
            Provenance
          </summary>
          <pre className="text-xs text-slate-600 mt-1 whitespace-pre-wrap">
            {JSON.stringify(comparison.provenance, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────

export function P6IntelligencePanel({ entityType, entityId, entityName }: P6IntelligencePanelProps) {
  const [compareWindow, setCompareWindow] = useState<ComparisonWindow | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const { data: intel, isLoading, error } = useQuery<CoinIntelligenceDTO | NarrativeIntelligenceDTO | null>({
    queryKey: ["p6-intelligence", entityType, entityId],
    queryFn: () => (entityType === "coin" ? fetchP6CoinIntelligence(entityId) : fetchP6NarrativeIntelligence(entityId)),
    staleTime: 30_000,
  });

  const { data: comparison, isLoading: compLoading } = useQuery({
    queryKey: ["p6-history", entityType, entityId, compareWindow],
    queryFn: () => fetchHistoricalComparison(entityType, entityId, compareWindow!),
    enabled: !!compareWindow,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500" />
            <span className="ml-3 text-slate-400 text-sm">Loading P6 intelligence…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-l-4 border-l-yellow-500/50">
        <CardContent className="py-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-slate-400">
              P6 intelligence unavailable: {(error as Error).message}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!intel) {
    return (
      <Card className="border-l-4 border-l-slate-700">
        <CardContent className="py-4">
          <p className="text-sm text-slate-500">
            No P6 intelligence data for {entityName}. Run a data refresh to generate P6 artifacts.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-l-4 border-l-cyan-500/50">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="text-cyan-500">●</span>
            P6 Intelligence
          </CardTitle>
          <div className="flex items-center gap-3">
            <ComparisonWindowSelector selected={compareWindow} onChange={setCompareWindow} />
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showDetails ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Health & Confidence */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-xs text-slate-500">Health Score</p>
            <p className={`text-2xl font-bold ${intel.health_score !== null ? "text-white" : "text-slate-500"}`}>
              {intel.health_score !== null ? intel.health_score.toFixed(1) : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Confidence</p>
            <p className={`text-2xl font-bold ${intel.confidence !== null ? "text-white" : "text-slate-500"}`}>
              {intel.confidence !== null ? intel.confidence.toFixed(1) : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Regime</p>
            <RegimeIndicator regime={intel.regime} />
          </div>
          <div>
            <p className="text-xs text-slate-500">Warnings</p>
            <p className="text-2xl font-bold text-white">
              {intel.warnings.length}
            </p>
          </div>
        </div>

        {/* Historical Comparison */}
        {compareWindow && compLoading && (
          <div className="flex items-center gap-2 py-3">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-500" />
            <span className="text-sm text-slate-400">Loading comparison…</span>
          </div>
        )}
        {compareWindow && comparison && (
          <ComparisonResultDisplay comparison={comparison} />
        )}
        {compareWindow && !compLoading && !comparison && (
          <div className="py-3 text-sm text-slate-500">
            Historical comparison unavailable for this {compareWindow} window.
          </div>
        )}

        {/* Warnings */}
        {intel.warnings.length > 0 && (
          <div className="mt-4">
            <WarningList warnings={intel.warnings} />
          </div>
        )}

        {/* Expandable Details */}
        {showDetails && intel.summary && (
          <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
            {intel.summary.health_delta !== null && (
              <div className="text-sm">
                <span className="text-slate-500">Health Delta: </span>
                <span className={intel.summary.health_delta > 0 ? "text-green-400" : intel.summary.health_delta < 0 ? "text-red-400" : "text-slate-400"}>
                  {intel.summary.health_delta > 0 ? "+" : ""}
                  {intel.summary.health_delta.toFixed(2)}
                </span>
                {intel.summary.health_change_pct !== null && (
                  <span className="text-slate-500 ml-2">
                    ({intel.summary.health_change_pct > 0 ? "+" : ""}
                    {intel.summary.health_change_pct.toFixed(1)}%)
                  </span>
                )}
              </div>
            )}

            <ExplanationList title="What Changed" items={intel.summary.what_changed as any} />
            <ExplanationList title="Why" items={intel.summary.why as any} />
            <ExplanationList title="What to Watch" items={intel.summary.what_to_watch as any} />
          </div>
        )}

        {/* Quality / Metadata */}
        {showDetails && (
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-600">
            <span>Quality: {intel.quality.quality_state}</span>
            <span>Freshness: {intel.quality.freshness_state}</span>
            {intel.window_end && (
              <span>As of: {new Date(intel.window_end).toLocaleString()}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
