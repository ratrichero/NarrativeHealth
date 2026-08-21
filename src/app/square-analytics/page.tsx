"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import {
  BarChart3, TrendingUp, TrendingDown, AlertCircle, RefreshCw,
  FileText, Coins, Zap, Clock, Shield, Activity,
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, AreaChart, Area, Legend,
} from "recharts";

// ─── Types ─────────────────────────────────────────────

type TimeRange = "TODAY" | "7D" | "30D" | "ALL";

interface Overview {
  totalExecutions: number;
  totalPublished: number;
  totalFailed: number;
  totalDeduplicated: number;
  totalQuotaBlocked: number;
  successRate: number;
  avgDurationMs: number;
  avgEvaluated: number;
  avgQualified: number;
}

interface Funnel {
  evaluated: number;
  qualified: number;
  published: number;
  failed: number;
  deduplicated: number;
  quotaBlocked: number;
}

interface CoinItem {
  coinSymbol: string;
  total: number;
  published: number;
  failed: number;
  avgScore: number;
}

interface NarrativeItem {
  narrativeId: number;
  narrativeName: string;
  total: number;
  published: number;
  failed: number;
  avgScore: number;
}

interface LlmData {
  llmUsed: number;
  templateFallback: number;
  llmPublishRate: number;
  templatePublishRate: number;
}

interface FailureItem {
  category: string;
  count: number;
  avgRetries: number;
}

interface RetryData {
  totalRetries: number;
  avgRetries: number;
  maxRetries: number;
  retrySuccessRate: number;
}

interface LatencyData {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface QuotaData {
  todayPublished: number;
  todayRemaining: number;
  dailyCap: number;
  warningThreshold: boolean;
  avgDailyUsage: number;
}

interface ScoreItem {
  range: string;
  count: number;
}

interface TrendItem {
  date: string;
  rate: number;
  published: number;
  total: number;
}

interface ExecItem {
  id: number;
  startedAt: string;
  triggerType: string;
  evaluated: number;
  qualified: number;
  published: number;
  failed: number;
  deduplicated: number;
  quotaBlocked: number;
  durationMs: number | null;
  status: string;
}

interface PubRecord {
  id: number;
  createdAt: string;
  coinSymbol: string | null;
  narrativeName: string | null;
  type: string;
  status: string;
  score: number | null;
  llmUsed: boolean;
  externalPostId: string | null;
}

interface TypeItem {
  type: string;
  total: number;
  published: number;
  failed: number;
  avgScore: number;
}

interface AnalyticsData {
  overview?: Overview;
  funnel?: Funnel;
  coins?: CoinItem[];
  narratives?: NarrativeItem[];
  llm?: LlmData;
  failures?: FailureItem[];
  retry?: RetryData;
  latency?: LatencyData;
  quota?: QuotaData;
  scores?: ScoreItem[];
  trend?: TrendItem[];
  executions?: ExecItem[];
  publications?: PubRecord[];
  types?: TypeItem[];
}

// ─── Constants ─────────────────────────────────────────

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "TODAY", label: "Today" },
  { value: "7D", label: "7D" },
  { value: "30D", label: "30D" },
  { value: "ALL", label: "All" },
];

const PIE_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f87171"];
const SCORE_ORDER = ["90-100", "80-89", "70-79", "60-69", "50-59", "<50"];

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "8px",
  fontSize: 12,
};

// ─── Helper Components ─────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, color = "text-cyan-400" }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof TrendingUp;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-slate-400 text-sm font-medium">{label}</span>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div className="text-2xl font-bold text-white">{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <FileText className="h-8 w-8 text-slate-600 mb-3" />
      <p className="text-slate-500 text-sm">{message}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-slate-800 rounded w-1/3" />
      <div className="h-8 bg-slate-800 rounded w-1/2" />
      <div className="h-3 bg-slate-800 rounded w-2/3" />
    </div>
  );
}

function SectionCard({ title, children, className = "" }: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ─── Funnel Bar ────────────────────────────────────────

function FunnelBar({ data }: { data: Funnel }) {
  const steps = [
    { label: "Evaluated", value: data.evaluated, color: "bg-cyan-500" },
    { label: "Qualified", value: data.qualified, color: "bg-blue-500" },
    { label: "Published", value: data.published, color: "bg-green-500" },
  ];
  const maxVal = Math.max(...steps.map((s) => s.value), 1);

  return (
    <div className="space-y-4">
      {steps.map((step) => (
        <div key={step.label}>
          <div className="flex justify-between mb-1">
            <span className="text-sm text-slate-300">{step.label}</span>
            <span className="text-sm font-mono text-white">{step.value.toLocaleString()}</span>
          </div>
          <div className="h-6 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${step.color} rounded-full transition-all`}
              style={{ width: `${(step.value / maxVal) * 100}%`, minWidth: step.value > 0 ? 8 : 0 }}
            />
          </div>
        </div>
      ))}
      <div className="flex gap-6 pt-2 text-sm">
        <span className="text-slate-400">Failed: <span className="text-red-400 font-mono">{data.failed}</span></span>
        <span className="text-slate-400">Deduped: <span className="text-yellow-400 font-mono">{data.deduplicated}</span></span>
        <span className="text-slate-400">Quota Blocked: <span className="text-orange-400 font-mono">{data.quotaBlocked}</span></span>
      </div>
    </div>
  );
}

// ─── Quota Gauge ───────────────────────────────────────

function QuotaGauge({ data }: { data: QuotaData }) {
  const pct = data.dailyCap > 0 ? (data.todayPublished / data.dailyCap) * 100 : 0;
  const barColor =
    pct >= 90 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold text-white">{data.todayPublished}</span>
        <span className="text-slate-500">/ {data.dailyCap}</span>
        <span className="text-xs text-slate-500 ml-1">today</span>
      </div>
      <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>{data.todayRemaining} remaining</span>
        <span>{pct.toFixed(1)}% used</span>
      </div>
    </div>
  );
}

// ─── Time Range Selector ───────────────────────────────

function TimeRangeSelector({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  return (
    <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1">
      {TIME_RANGES.map((tr) => (
        <button
          key={tr.value}
          onClick={() => onChange(tr.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === tr.value
              ? "bg-cyan-600 text-white"
              : "text-slate-400 hover:text-white hover:bg-slate-700"
          }`}
        >
          {tr.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────

export default function SquareAnalyticsPage() {
  const [range, setRange] = useState<TimeRange>("7D");

  const { data: analytics, isLoading, error, refetch } = useQuery({
    queryKey: ["square-analytics", range],
    queryFn: async (): Promise<AnalyticsData> => {
      const res = await fetch(`/api/admin/square/analytics?range=${range}&section=all`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div><div className="h-8 w-64 bg-slate-800 rounded animate-pulse" /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-slate-900/50 rounded-xl border border-slate-800 p-5"><Skeleton /></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">Unable to load Square Analytics</h2>
        <p className="text-slate-400 mb-4">{(error as Error).message}</p>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const d = analytics ?? {};
  const o = d.overview;
  const f = d.funnel;
  const q = d.quota;

  // Sort scores for consistent display
  const sortedScores = d.scores
    ? [...d.scores].sort((a, b) => SCORE_ORDER.indexOf(a.range) - SCORE_ORDER.indexOf(b.range))
    : [];

  // Prepare mix pie data
  const mixPieData = d.types
    ? d.types.map((t) => ({
        name: t.type === "COIN_SETUP" ? "Coin" : t.type === "NARRATIVE_SETUP" ? "Narrative" : t.type,
        value: t.total,
        published: t.published,
      }))
    : [];

  const rangeLabel = TIME_RANGES.find((t) => t.value === range)?.label ?? range;

  return (
    <div className="space-y-6">
      {/* Section A — Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Binance Square Analytics</h1>
          <p className="text-slate-400">
            Monitor content generation, publication performance and pipeline health.
          </p>
        </div>
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      {/* Section B — Executive KPI Cards */}
      {o && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Evaluated" value={f?.evaluated?.toLocaleString() ?? "0"} sub={`${rangeLabel}`} icon={Activity} color="text-cyan-400" />
          <KpiCard label="Qualified" value={f?.qualified?.toLocaleString() ?? "0"} sub={`${rangeLabel}`} icon={Shield} color="text-blue-400" />
          <KpiCard label="Published" value={o.totalPublished?.toLocaleString() ?? "0"} sub={`${rangeLabel}`} icon={TrendingUp} color="text-green-400" />
          <KpiCard label="Publication Rate" value={o.successRate > 0 ? `${o.successRate}%` : "—"} sub="published / (published + failed)" icon={BarChart3} color="text-emerald-400" />
          <KpiCard label="Failed" value={o.totalFailed?.toLocaleString() ?? "0"} sub={`${rangeLabel}`} icon={TrendingDown} color="text-red-400" />
          <KpiCard label="Deduped" value={o.totalDeduplicated?.toLocaleString() ?? "0"} sub={`${rangeLabel}`} icon={Shield} color="text-yellow-400" />
          <KpiCard label="Quota Blocked" value={o.totalQuotaBlocked?.toLocaleString() ?? "0"} sub={`${rangeLabel}`} icon={AlertCircle} color="text-orange-400" />
          <KpiCard label="Avg Duration" value={o.avgDurationMs > 0 ? `${(o.avgDurationMs / 1000).toFixed(1)}s` : "—"} sub={`${rangeLabel}`} icon={Clock} color="text-slate-400" />
        </div>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Section C — Publication Funnel */}
        {f && (
          <SectionCard title="Publication Funnel" className="lg:col-span-2">
            {f.evaluated === 0 ? (
              <EmptyState message="No pipeline executions in this period." />
            ) : (
              <FunnelBar data={f} />
            )}
          </SectionCard>
        )}

        {/* Section J — Quota */}
        {q ? (
          <SectionCard title="Daily Quota">
            <QuotaGauge data={q} />
            <div className="mt-3 text-xs text-slate-500">
              Avg daily usage: <span className="text-slate-400 font-mono">{q.avgDailyUsage}</span>
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Daily Quota">
            <EmptyState message="Quota data is currently unavailable." />
          </SectionCard>
        )}

        {/* Section D — Publication Mix */}
        <SectionCard title="Publication Mix">
          {mixPieData.length === 0 ? (
            <EmptyState message="No publications in this period." />
          ) : (
            <div className="flex flex-col items-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={mixPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {mixPieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                {mixPieData.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2 text-sm">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="text-slate-300">{item.name}</span>
                    <span className="text-white font-mono">{item.value}</span>
                    <span className="text-slate-500">({item.published} pub)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* Section E — Top Coins */}
        <SectionCard title="Top Coins">
          {!d.coins || d.coins.length === 0 ? (
            <EmptyState message="No coin publications in this period." />
          ) : (
            <div className="space-y-2">
              {d.coins.slice(0, 8).map((coin) => (
                <div key={coin.coinSymbol} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-cyan-400" />
                    <span className="font-medium text-white">{coin.coinSymbol}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-slate-400">{coin.total} posts</span>
                    <span className="text-green-400 font-mono">{coin.avgScore.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Section F — Top Narratives */}
        <SectionCard title="Top Narratives">
          {!d.narratives || d.narratives.length === 0 ? (
            <EmptyState message="No narrative publications in this period." />
          ) : (
            <div className="space-y-2">
              {d.narratives.slice(0, 8).map((n) => (
                <div key={n.narrativeId} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/30 hover:bg-slate-800/60 transition-colors">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-purple-400" />
                    <span className="font-medium text-white text-sm truncate max-w-[180px]">{n.narrativeName}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-slate-400">{n.total} posts</span>
                    <span className="text-green-400 font-mono">{n.avgScore.toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Section G — Content Generation (LLM vs Template) */}
        <SectionCard title="Content Generation">
          {d.llm ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-cyan-400">{d.llm.llmUsed}</div>
                  <div className="text-xs text-slate-500 mt-1">LLM Generated</div>
                </div>
                <div className="bg-slate-800/30 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-purple-400">{d.llm.templateFallback}</div>
                  <div className="text-xs text-slate-500 mt-1">Template Fallback</div>
                </div>
              </div>
              <div className="flex gap-4 text-sm text-slate-400">
                <span>LLM publish rate: <span className="text-white font-mono">{d.llm.llmPublishRate}%</span></span>
                <span>Template publish rate: <span className="text-white font-mono">{d.llm.templatePublishRate}%</span></span>
              </div>
            </div>
          ) : (
            <EmptyState message="No content generation data in this period." />
          )}
        </SectionCard>

        {/* Section H — Opportunity Quality */}
        <SectionCard title="Opportunity Quality" className="lg:col-span-2">
          {sortedScores.length === 0 ? (
            <EmptyState message="No opportunity data in this period." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={sortedScores}>
                <XAxis dataKey="range" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="#22d3ee" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        {/* Section I — Reliability */}
        <SectionCard title="Reliability">
          <div className="space-y-4">
            {d.failures && d.failures.length > 0 ? (
              <div className="space-y-2">
                {d.failures.map((fail) => (
                  <div key={fail.category} className="flex items-center justify-between p-2 rounded bg-slate-800/30">
                    <span className="text-sm text-slate-300">{fail.category}</span>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-red-400 font-mono">{fail.count}</span>
                      <span className="text-slate-500">avg retries: {fail.avgRetries}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-green-400 flex items-center gap-2">
                <Shield className="h-4 w-4" /> No publication failures
              </div>
            )}

            {d.retry && (
              <div className="pt-2 border-t border-slate-800 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total retries</span>
                  <span className="text-white font-mono">{d.retry.totalRetries}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Retry success rate</span>
                  <span className="text-white font-mono">{d.retry.retrySuccessRate}%</span>
                </div>
              </div>
            )}

            {d.latency && (
              <div className="pt-2 border-t border-slate-800 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg API latency</span>
                  <span className="text-white font-mono">{d.latency.avgMs}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">P50</span>
                  <span className="text-white font-mono">{d.latency.p50Ms}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">P95</span>
                  <span className="text-white font-mono">{d.latency.p95Ms}ms</span>
                </div>
                {d.latency.p99Ms > 0 && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">P99</span>
                    <span className="text-white font-mono">{d.latency.p99Ms}ms</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </SectionCard>

        {/* Section K — Pipeline Execution History */}
        <SectionCard title="Pipeline Execution History" className="lg:col-span-2">
          {!d.executions || d.executions.length === 0 ? (
            <EmptyState message="No pipeline executions in this period." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-2 px-2 text-slate-400 font-medium">Time</th>
                    <th className="text-left py-2 px-2 text-slate-400 font-medium">Trigger</th>
                    <th className="text-right py-2 px-2 text-slate-400 font-medium">Eval</th>
                    <th className="text-right py-2 px-2 text-slate-400 font-medium">Qual</th>
                    <th className="text-right py-2 px-2 text-slate-400 font-medium">Pub</th>
                    <th className="text-right py-2 px-2 text-slate-400 font-medium">Fail</th>
                    <th className="text-right py-2 px-2 text-slate-400 font-medium">Dedup</th>
                    <th className="text-right py-2 px-2 text-slate-400 font-medium">Quota</th>
                    <th className="text-right py-2 px-2 text-slate-400 font-medium">Dur</th>
                    <th className="text-center py-2 px-2 text-slate-400 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {d.executions.slice(0, 15).map((ex) => (
                    <tr key={ex.id} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                      <td className="py-2 px-2 text-slate-300 font-mono text-xs">
                        {new Date(ex.startedAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-2 text-slate-400 text-xs">{ex.triggerType}</td>
                      <td className="py-2 px-2 text-right font-mono text-white">{ex.evaluated}</td>
                      <td className="py-2 px-2 text-right font-mono text-white">{ex.qualified}</td>
                      <td className="py-2 px-2 text-right font-mono text-green-400">{ex.published}</td>
                      <td className="py-2 px-2 text-right font-mono text-red-400">{ex.failed}</td>
                      <td className="py-2 px-2 text-right font-mono text-yellow-400">{ex.deduplicated}</td>
                      <td className="py-2 px-2 text-right font-mono text-orange-400">{ex.quotaBlocked}</td>
                      <td className="py-2 px-2 text-right font-mono text-slate-400 text-xs">
                        {ex.durationMs ? `${(ex.durationMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          ex.status === "SUCCESS" ? "bg-green-900/50 text-green-400" :
                          ex.status === "PARTIAL" ? "bg-yellow-900/50 text-yellow-400" :
                          "bg-red-900/50 text-red-400"
                        }`}>
                          {ex.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Section L — Recent Publications */}
        <SectionCard title="Recent Publications">
          {!d.publications || d.publications.length === 0 ? (
            <EmptyState message="No publications in this period." />
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {d.publications.slice(0, 15).map((pub) => (
                <div
                  key={pub.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        pub.status === "PUBLISHED" ? "bg-green-900/50 text-green-400" :
                        pub.status === "FAILED" ? "bg-red-900/50 text-red-400" :
                        "bg-slate-800 text-slate-400"
                      }`}>
                        {pub.status}
                      </span>
                      <span className="text-sm text-white truncate">
                        {pub.coinSymbol ? `$${pub.coinSymbol}` : pub.narrativeName ?? "Unknown"}
                      </span>
                      <span className="text-xs text-slate-500">{pub.type?.replace("_SETUP", "").toLowerCase()}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span>{pub.llmUsed ? "LLM" : "Template"}</span>
                      {pub.score != null && <span>Score: {Number(pub.score).toFixed(1)}</span>}
                      {pub.externalPostId && (
                        <a
                          href={`https://www.binance.com/en/square/post/${pub.externalPostId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300"
                        >
                          View on Binance ↗
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 ml-3 whitespace-nowrap">
                    {new Date(pub.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Success Rate Trend — full width */}
        {d.trend && d.trend.length > 0 && (
          <SectionCard title="Success Rate Trend" className="lg:col-span-3">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={[...d.trend].reverse()}>
                <XAxis dataKey="date" stroke="#64748b" fontSize={12} tickFormatter={(v) => String(v).slice(5)} />
                <YAxis stroke="#64748b" fontSize={12} domain={[0, 100]} />
                <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "Success Rate"]} />
                <Area type="monotone" dataKey="rate" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.1} strokeWidth={2} />
                <Area type="monotone" dataKey="published" stroke="#34d399" fill="#34d399" fillOpacity={0.05} strokeWidth={1} />
                <Legend />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
