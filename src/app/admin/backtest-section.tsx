"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Percent,
  Play,
  Scale,
  Search,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/Button";
import { buildBacktestInsights, type InsightTone } from "@/lib/backtest/insights";
import { aggregateOutcomes, type PickOutcome } from "@/lib/backtest/engine";
import {
  longestLosingStreak,
  maxDrawdownR,
  profitFactor,
  wilsonInterval,
} from "@/lib/backtest/metrics";

/* ────────────────────────────────────────────────────────────────────────────
 * BT-06 + BT-07 — Admin Backtest tab.
 *
 *  A. Chạy thông minh: status chip "N sẵn sàng chốt" theo horizon, auto-settle
 *     1 lần/phiên khi mở tab (localStorage `bt_auto_settle`, mặc định BẬT),
 *     chip vàng "N thiếu nến" (BT-07a), dòng lần chốt cuối.
 *  B. Dashboard tương tác: 5 KPI + risk strip (Wilson CI, max DD, profit
 *     factor, chuỗi thua) + benchmark BTC; toggle NET/GROSS R
 *     (localStorage `bt_r_mode`) qua một helper `rOf()`; insights
 *     deterministic; 4 chart recharts; bảng pick filter/sort/pagination/CSV;
 *     4 bảng nhóm tính client (loại NO_SETUP khỏi win rate).
 *  C. Health Power + Signal Quality gói trong <details> (mặc định đóng).
 *
 * Read-only với DB ngoài nút chạy; mọi số liệu client-side lấy từ picks đã
 * chốt do setup-performance trả về.
 * ──────────────────────────────────────────────────────────────────────────── */

const HORIZONS = [7, 14, 30, 60] as const;
const PAGE_SIZE = 50;
const RISK_PCT_PER_TRADE = 1; // giả định 1% vốn/lệnh khi quy R → % vốn
const SETTLED = new Set(["TP1_WIN", "TP2_WIN", "SL_LOSS", "NO_HIT"]);
const OUTCOME_ORDER = ["TP1_WIN", "TP2_WIN", "SL_LOSS", "NO_HIT"] as const;
const BAND_ORDER = ["80+", "60-80", "40-60", "<40", "unknown"] as const;

type RMode = "NET" | "GROSS";

/** Pick row as returned by GET /api/admin/backtest/setup-performance. */
interface PickOutcomeT {
  pickId: number;
  dataDate: string;
  symbol: string;
  direction: string;
  signal: string;
  healthScore: number | null;
  pickKind: string;
  status: string; // EVALUATED | EXPIRED | SKIPPED
  outcome: string | null; // TP1_WIN | TP2_WIN | SL_LOSS | NO_HIT | NO_SETUP
  exitR: number | null;
  costR: number | null;
  exitRNet: number | null;
  hitDay: number | null;
  mfePct: number | null;
  maePct: number | null;
  entryFilled: boolean | null;
  horizonDays: number | null;
  evaluatedAt: string | null;
  repeatCount: number;
}

interface PerfData {
  params: { includeAll: boolean; cutoff: string; feeBps: number; slippageBps: number };
  benchmark: {
    from: string;
    to: string;
    startClose: number;
    endClose: number;
    returnPct: number;
  } | null;
  totalPicks: number;
  evaluatedCount: number;
  pendingCount: number;
  statusCounts: { PENDING: number; EVALUATED: number; EXPIRED: number; SKIPPED: number };
  picks: PickOutcomeT[];
}

interface StatusData {
  pending: number;
  readyByHorizon: Record<string, number>;
  stillOpenByHorizon: Record<string, number>;
  noDataByHorizon: Record<string, number>;
  skippable: number;
  lastEvaluatedAt: string | null;
}

interface RunResult {
  runId: string;
  horizon: number;
  dryRun: boolean;
  pendingBefore: number;
  evaluated?: number;
  expired?: number;
  skipped?: number;
  stillOpen?: number;
  noData?: number;
  errors?: number;
  willSkip?: number;
  willEvaluate?: number;
  willNoData?: number;
  note?: string;
}

/* ─── Pure helpers ─────────────────────────────────────────────── */

const isWin = (o: string | null) => o === "TP1_WIN" || o === "TP2_WIN";
const fmtR = (v: number | null | undefined) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
}

function bandOf(score: number | null): string {
  if (score == null) return "unknown";
  if (score >= 80) return "80+";
  if (score >= 60) return "60-80";
  if (score >= 40) return "40-60";
  return "<40";
}

/** NET khi bật chế độ net (mặc định) — thiếu costR thì rơi về gross. */
function rOf(p: PickOutcomeT, mode: RMode): number | null {
  return mode === "NET" ? (p.exitRNet ?? p.exitR) : p.exitR;
}

/** Map một pick row của route → shape engine để tái dùng aggregateOutcomes. */
function toEnginePick(p: PickOutcomeT, r: number | null): PickOutcome {
  return {
    pickId: p.pickId,
    dataDate: p.dataDate,
    coinId: 0,
    symbol: p.symbol,
    direction: p.direction,
    signal: p.signal,
    healthScore: p.healthScore,
    pickKind: p.pickKind,
    entryMid: null,
    outcome: (p.outcome as PickOutcome["outcome"]) ?? "INVALID",
    exitR: r,
    hitDay: p.hitDay,
    mfePct: p.mfePct,
    maePct: p.maePct,
    entryFilled: p.entryFilled,
  };
}

function groupBy(rows: PickOutcome[], keyFn: (p: PickOutcome) => string) {
  const map = new Map<string, PickOutcome[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .map(([group, os]) => aggregateOutcomes(group, os))
    .sort((a, b) => b.picks - a.picks);
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV 16 cột, đúng bộ filter hiện tại — escape chuẩn (quote + nhân đôi quote). */
function buildCsv(rows: PickOutcomeT[]): string {
  const header = [
    "pickId",
    "dataDate",
    "symbol",
    "direction",
    "signal",
    "healthScore",
    "pickKind",
    "status",
    "outcome",
    "horizonDays",
    "hitDay",
    "exitR",
    "costR",
    "exitRNet",
    "mfePct",
    "maePct",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.pickId,
        r.dataDate,
        r.symbol,
        r.direction,
        r.signal,
        r.healthScore ?? "",
        r.pickKind,
        r.status,
        r.outcome ?? "",
        r.horizonDays ?? "",
        r.hitDay ?? "",
        r.exitR ?? "",
        r.costR ?? "",
        r.exitRNet ?? "",
        r.mfePct ?? "",
        r.maePct ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\n");
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "8px",
  fontSize: 12,
};

const TONE_CLASS: Record<InsightTone, string> = {
  positive: "border-l-green-500 bg-green-950/20 text-green-300",
  negative: "border-l-red-500 bg-red-950/20 text-red-300",
  warning: "border-l-amber-500 bg-amber-950/20 text-amber-300",
  info: "border-l-slate-500 bg-slate-800/40 text-slate-300",
};

/* ─── Component ────────────────────────────────────────────────── */

function BacktestSection() {
  const qc = useQueryClient();
  const [horizon, setHorizon] = useState<number>(14);
  const [daysBack, setDaysBack] = useState(90);

  // View filters (client-side).
  const [viewHorizon, setViewHorizon] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Sort + pagination.
  const [sortKey, setSortKey] = useState<keyof PickOutcomeT>("dataDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  // NET/GROSS R mode (BT-07b).
  const [rMode, setRMode] = useState<RMode>("NET");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem("bt_r_mode");
    if (v === "GROSS" || v === "NET") setRMode(v);
  }, []);
  const setRModePersist = (m: RMode) => {
    setRMode(m);
    if (typeof window !== "undefined") window.localStorage.setItem("bt_r_mode", m);
  };

  // Auto-settle toggle (BT-06a).
  const [autoSettle, setAutoSettle] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem("bt_auto_settle");
    setAutoSettle(v == null ? true : v === "1");
  }, []);
  const toggleAutoSettle = () => {
    setAutoSettle((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") window.localStorage.setItem("bt_auto_settle", next ? "1" : "0");
      return next;
    });
  };

  /* ── Status (GET run) ── */
  const statusQuery = useQuery({
    queryKey: ["admin", "backtest", "status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/backtest/run");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as StatusData;
    },
  });

  /* ── Chốt kết quả (POST run) ── */
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const { mutate: runMutate, isPending: runPending } = useMutation({
    mutationFn: async (opts: { dryRun?: boolean; horizon?: number } = {}) => {
      const res = await fetch("/api/admin/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon: opts.horizon ?? horizon, dryRun: opts.dryRun ?? false }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as RunResult;
    },
    onSuccess: (data) => {
      setRunResult(data);
      qc.invalidateQueries({ queryKey: ["admin", "backtest", "perf"] });
      qc.invalidateQueries({ queryKey: ["admin", "backtest", "status"] });
    },
  });

  /* ── Auto-settle: 1 lần/phiên khi mở tab và có pick sẵn sàng ── */
  const autoRanRef = useRef(false);
  const readyNow = statusQuery.data?.readyByHorizon?.[horizon] ?? 0;
  useEffect(() => {
    if (autoRanRef.current || !autoSettle || !statusQuery.data) return;
    if ((statusQuery.data.readyByHorizon?.[horizon] ?? 0) <= 0) return;
    autoRanRef.current = true;
    runMutate({ horizon });
  }, [autoSettle, statusQuery.data, horizon, runMutate]);

  /* ── Setup performance (read-only, stored results) ── */
  const perfQuery = useQuery({
    queryKey: ["admin", "backtest", "perf"],
    queryFn: async () => {
      const res = await fetch("/api/admin/backtest/setup-performance");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as PerfData;
    },
  });

  /* ── Health Power + Signal Quality (moved into <details>) ── */
  const powerQuery = useQuery({
    queryKey: ["admin", "backtest", "power", daysBack],
    queryFn: async () => {
      const res = await fetch(`/api/admin/backtest/health-power?daysBack=${daysBack}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        params: { daysBack: number };
        totalSamples: number;
        byBand: { band: string; samples: number; median1d: number | null; median3d: number | null; median7d: number | null; median14d: number | null }[];
        correlations: { horizonDays: number; samples: number; health: number | null; trend: number | null; volume: number | null; momentum: number | null }[];
        note: string | null;
      };
    },
  });

  const signalQuery = useQuery({
    queryKey: ["admin", "backtest", "signal", daysBack],
    queryFn: async () => {
      const res = await fetch(`/api/admin/backtest/signal-quality?daysBack=${daysBack}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        params: { daysBack: number };
        totalSamples: number;
        bySignal: { signal: string; samples: number; median1d: number | null; median3d: number | null; median7d: number | null; median14d: number | null; positive7dRate: number | null }[];
        byScoreChange: { bucket: string; samples: number; median7d: number | null; positive7dRate: number | null }[];
      };
    },
  });

  /* ── Filtered picks (drives KPIs, insights, charts, tables, CSV) ── */
  const allPicks = useMemo(() => perfQuery.data?.picks ?? [], [perfQuery.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return allPicks.filter((p) => {
      if (viewHorizon !== "all" && String(p.horizonDays ?? "") !== viewHorizon) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (outcomeFilter !== "all" && p.outcome !== outcomeFilter) return false;
      if (directionFilter !== "all" && p.direction !== directionFilter) return false;
      if (signalFilter !== "all" && p.signal !== signalFilter) return false;
      if (q && !p.symbol.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [allPicks, viewHorizon, statusFilter, outcomeFilter, directionFilter, signalFilter, search]);

  // Reset trang khi filter đổi.
  useEffect(() => {
    setPage(1);
  }, [viewHorizon, statusFilter, outcomeFilter, directionFilter, signalFilter, search]);

  const signalOptions = useMemo(
    () => [...new Set(allPicks.map((p) => p.signal))].sort(),
    [allPicks]
  );

  /* ── Derived metrics ── */
  const settled = useMemo(
    () => filtered.filter((p) => p.outcome != null && SETTLED.has(p.outcome)),
    [filtered]
  );
  const wins = settled.filter((p) => isWin(p.outcome)).length;
  const losses = settled.filter((p) => p.outcome === "SL_LOSS").length;
  const noHit = settled.filter((p) => p.outcome === "NO_HIT").length;
  const winRate = wins + losses > 0 ? +((wins / (wins + losses)) * 100).toFixed(1) : null;
  const ci = wilsonInterval(wins, losses);
  const rs = useMemo(
    () => settled.map((p) => rOf(p, rMode)).filter((r): r is number => r != null),
    [settled, rMode]
  );
  const avgR = mean(rs);
  const totalR = +rs.reduce((a, b) => a + b, 0).toFixed(2);
  const noHitPct = settled.length > 0 ? +((noHit / settled.length) * 100).toFixed(1) : null;
  const strategyPct = +(totalR * RISK_PCT_PER_TRADE).toFixed(2);
  const benchmark = perfQuery.data?.benchmark ?? null;
  const readyToSettle = statusQuery.data?.readyByHorizon?.[horizon] ?? 0;
  const noDataNow = statusQuery.data?.noDataByHorizon?.[horizon] ?? 0;
  const stillOpenNow = statusQuery.data?.stillOpenByHorizon?.[horizon] ?? 0;

  /* ── Group tables (client-side, NO_SETUP excluded by aggregateOutcomes) ── */
  const enginePicks = useMemo(
    () => filtered.map((p) => toEnginePick(p, rOf(p, rMode))),
    [filtered, rMode]
  );
  const groupTables = useMemo(
    () => ({
      direction: groupBy(enginePicks, (p) => (p.direction === "BULLISH" ? "LONG" : "SHORT")),
      signal: groupBy(enginePicks, (p) => p.signal),
      band: groupBy(enginePicks, (p) => bandOf(p.healthScore)),
      kind: groupBy(enginePicks, (p) => p.pickKind),
    }),
    [enginePicks]
  );

  /* ── Insights (deterministic, respects current R mode) ── */
  const insights = useMemo(() => {
    const distinctHorizons = new Set(filtered.map((p) => p.horizonDays).filter((h) => h != null));
    return buildBacktestInsights(
      filtered.map((p) => ({
        dataDate: p.dataDate,
        direction: p.direction,
        signal: p.signal,
        healthScore: p.healthScore,
        outcome: p.outcome,
        exitR: rOf(p, rMode),
      })),
      { mixedHorizon: viewHorizon === "all" && distinctHorizons.size > 1 }
    );
  }, [filtered, rMode, viewHorizon]);

  /* ── Chart data ── */
  const equityCurve = useMemo(() => {
    const ordered = enginePicks
      .filter((p) => p.exitR != null)
      .slice()
      .sort((a, b) => (a.dataDate < b.dataDate ? -1 : a.dataDate > b.dataDate ? 1 : a.pickId - b.pickId));
    let cum = 0;
    return ordered.map((p) => {
      cum = +(cum + (p.exitR as number)).toFixed(2);
      return { date: p.dataDate, cumR: cum };
    });
  }, [enginePicks]);

  const monthly = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number }>();
    for (const p of settled) {
      const key = p.dataDate.slice(0, 7);
      const cur = map.get(key) ?? { wins: 0, losses: 0 };
      if (isWin(p.outcome)) cur.wins++;
      else if (p.outcome === "SL_LOSS") cur.losses++;
      map.set(key, cur);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, v]) => {
        const n = v.wins + v.losses;
        return { month, trades: n, winRate: n > 0 ? +((v.wins / n) * 100).toFixed(1) : 0 };
      })
      .filter((m) => m.trades > 0);
  }, [settled]);

  const outcomeDist = useMemo(
    () =>
      OUTCOME_ORDER.map((o) => ({
        name: o,
        value: settled.filter((p) => p.outcome === o).length,
      })),
    [settled]
  );

  const bandChart = useMemo(
    () =>
      BAND_ORDER.map((band) => {
        const subset = enginePicks.filter((p) => bandOf(p.healthScore) === band);
        const subRs = subset.map((p) => p.exitR).filter((r): r is number => r != null);
        const w = subset.filter((p) => isWin(p.outcome)).length;
        const l = subset.filter((p) => p.outcome === "SL_LOSS").length;
        return {
          band,
          n: subset.length,
          avgR: mean(subRs) ?? 0,
          winRate: w + l > 0 ? +((w / (w + l)) * 100).toFixed(1) : 0,
        };
      }).filter((b) => b.n > 0),
    [enginePicks]
  );

  /* ── Sort + paginate pick table ── */
  const sorted = useMemo(() => {
    const rows = filtered.slice();
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const toggleSort = (key: keyof PickOutcomeT) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([buildCsv(sorted)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest-picks-${viewHorizon === "all" ? "all" : viewHorizon + "d"}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const fmt = (v: number | null | undefined, suffix = "") =>
    v == null ? "—" : `${v > 0 && suffix === "%" ? "+" : ""}${v}${suffix}`;
  const bandColor = (b: string) =>
    b === "80+" ? "text-green-400" : b === "60-80" ? "text-cyan-400" : b === "40-60" ? "text-yellow-400" : "text-red-400";

  /* ── Shared renderers ── */
  const th = (key: keyof PickOutcomeT, label: string, align = "left") => (
    <th
      className={`py-2 pr-3 cursor-pointer select-none hover:text-slate-300 ${align === "right" ? "text-right" : "text-left"}`}
      onClick={() => toggleSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === key && <ArrowUpDown className="h-3 w-3 text-cyan-400" />}
      </span>
    </th>
  );

  const outcomeCell = (o: string | null) =>
    o === "TP1_WIN" ? <span className="text-green-400">TP1_WIN</span>
      : o === "TP2_WIN" ? <span className="text-cyan-400">TP2_WIN</span>
      : o === "SL_LOSS" ? <span className="text-red-400">SL_LOSS</span>
      : o === "NO_HIT" ? <span className="text-yellow-400">NO_HIT</span>
      : o === "NO_SETUP" ? <span className="text-slate-500">NO_SETUP</span>
      : "—";

  const statsTable = (title: string, rows: ReturnType<typeof groupBy>) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-white mb-3">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">Chưa có picks nào đủ điều kiện trong view hiện tại.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                <th className="py-2 pr-3">Nhóm</th>
                <th className="py-2 pr-3">Picks</th>
                <th className="py-2 pr-3">Win rate</th>
                <th className="py-2 pr-3">TP1/TP2/SL</th>
                <th className="py-2 pr-3">No-hit</th>
                <th className="py-2 pr-3">Avg R ({rMode})</th>
                <th className="py-2 pr-3">Ngày thoát</th>
                <th className="py-2 pr-3">Entry fill</th>
                <th className="py-2 pr-3">MFE/MAE %</th>
                <th className="py-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.group} className="border-b border-slate-800 last:border-0">
                  <td className="py-2 pr-3 font-mono text-slate-200">{g.group}</td>
                  <td className="py-2 pr-3 text-slate-300">{g.picks}</td>
                  <td className={`py-2 pr-3 font-medium ${g.winRate == null ? "text-slate-500" : g.winRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                    {g.winRate == null ? "—" : `${g.winRate}%`}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-400">
                    <span className="text-green-400">{g.tp1Wins}</span>/<span className="text-cyan-400">{g.tp2Wins}</span>/<span className="text-red-400">{g.slLosses}</span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{g.noHit}</td>
                  <td className={`py-2 pr-3 ${g.avgR == null ? "text-slate-500" : g.avgR >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmtR(g.avgR)}
                  </td>
                  <td className="py-2 pr-3 text-slate-400">{g.avgDaysToExit ?? "—"}</td>
                  <td className="py-2 pr-3 text-slate-400">{g.entryFillRate == null ? "—" : `${g.entryFillRate}%`}</td>
                  <td className="py-2 pr-3 text-xs text-slate-400">
                    {fmt(g.avgMfePct)} / {fmt(g.avgMaePct)}
                  </td>
                  <td className="py-2 text-slate-500">{g.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const kpi = (
    label: string,
    value: string,
    sub: React.ReactNode,
    Icon: typeof TrendingUp,
    valueClass = "text-white"
  ) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400 font-medium">{label}</span>
        <Icon className="h-4 w-4 text-cyan-400" />
      </div>
      <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );

  const chartCard = (title: string, body: React.ReactNode) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-white mb-3">{title}</h4>
      {body}
    </div>
  );

  /* ── Render ── */
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* ── Header: title + horizon + status chip + auto-settle + R toggle ── */}
      <div className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-5 w-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Backtest</h3>
        <span className="text-xs text-slate-500">
          đo hiệu quả picks + sức mạnh health score · GENUINE có setup
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-400">Horizon</label>
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            {HORIZONS.map((h) => (
              <option key={h} value={h}>{h} ngày</option>
            ))}
          </select>

          <span
            className={`px-2 py-1 rounded text-xs ${
              readyToSettle > 0 ? "bg-green-900/50 text-green-400" : "bg-slate-800 text-slate-500"
            }`}
          >
            ● {readyToSettle} pick sẵn sàng chốt
          </span>

          <button
            onClick={toggleAutoSettle}
            className={`px-2 py-1 rounded text-xs border ${
              autoSettle
                ? "border-cyan-800 bg-cyan-950/40 text-cyan-300"
                : "border-slate-700 bg-slate-800 text-slate-400"
            }`}
            title="Tự chốt kết quả khi mở tab (1 lần/phiên)"
          >
            Tự chốt: {autoSettle ? "BẬT" : "TẮT"}
          </button>

          <div className="flex items-center rounded border border-slate-700 overflow-hidden text-xs">
            {(["NET", "GROSS"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setRModePersist(m)}
                className={`px-2 py-1 ${
                  rMode === m ? "bg-cyan-950/60 text-cyan-300" : "bg-slate-900 text-slate-400"
                }`}
                title={m === "NET" ? "R đã trừ phí + slippage" : "R gộp, chưa trừ phí"}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Status + run controls ── */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            loading={runPending}
            onClick={() => runMutate({ dryRun: true })}
            title="Xem sẽ đánh giá bao nhiêu pick, không ghi gì"
          >
            <Search className="h-4 w-4 mr-2" />
            Dry run
          </Button>
          <Button
            loading={runPending}
            onClick={() => runMutate({})}
            title="Chốt kết quả cho picks PENDING đã đóng cửa sổ horizon — mỗi pick chỉ chạy 1 lần"
          >
            <Play className="h-4 w-4 mr-2" />
            Chạy backtest
          </Button>
          <span className="text-xs text-slate-500">
            Pick đã chốt <span className="text-slate-300">không bao giờ chạy lại</span>.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">
            Lần chốt cuối:{" "}
            <span className="text-slate-200">
              {statusQuery.data?.lastEvaluatedAt
                ? new Date(statusQuery.data.lastEvaluatedAt).toLocaleString()
                : "—"}
            </span>
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">
            còn <span className="text-slate-200">{statusQuery.data?.pending ?? 0}</span> PENDING (·
            thiếu nến: <span className="text-amber-400">{noDataNow}</span>)
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-400">
            còn window <span className="text-cyan-300">{stillOpenNow}</span>
          </span>
          {(statusQuery.data?.skippable ?? 0) > 0 && (
            <>
              <span className="text-slate-500">·</span>
              <span className="text-slate-500">{statusQuery.data?.skippable} không setup (sẽ SKIP)</span>
            </>
          )}
          {noDataNow > 0 && (
            <span className="px-2 py-1 rounded bg-amber-900/40 text-amber-300 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {noDataNow} thiếu nến (chưa thể chốt)
            </span>
          )}
        </div>

        {statusQuery.error && (
          <p className="text-xs text-red-400">Lỗi status: {(statusQuery.error as Error).message}</p>
        )}

        {runResult && (
          <div className="text-xs bg-slate-900/60 border border-slate-700 rounded p-3 text-slate-300">
            <span className="font-mono text-cyan-400">{runResult.runId}</span> · horizon {runResult.horizon}d ·{" "}
            {runResult.dryRun ? (
              <>
                (dry) sẽ chốt <span className="text-green-400">{runResult.willEvaluate ?? 0}</span> · bỏ qua (không setup){" "}
                <span className="text-slate-400">{runResult.willSkip ?? 0}</span> · thiếu nến{" "}
                <span className="text-amber-400">{runResult.willNoData ?? 0}</span> · còn window{" "}
                <span className="text-cyan-300">{runResult.stillOpen ?? 0}</span>
              </>
            ) : (
              <>
                <span className="text-green-400">{runResult.evaluated ?? 0} chốt kết quả</span> ·{" "}
                <span className="text-yellow-400">{runResult.expired ?? 0} hết hạn (no-hit)</span> ·{" "}
                <span className="text-slate-400">{runResult.skipped ?? 0} bỏ qua</span> ·{" "}
                <span className="text-amber-400">{runResult.noData ?? 0} thiếu nến (giữ PENDING)</span> ·{" "}
                <span className="text-cyan-300">{runResult.stillOpen ?? 0} còn trong window</span>
                {(runResult.errors ?? 0) > 0 && <span className="text-red-400"> · {runResult.errors} lỗi</span>}
              </>
            )}
          </div>
        )}

        {perfQuery.data && (
          <div className="flex flex-wrap gap-2 text-xs">
            {([
              ["PENDING", "chưa chạy / trong window", "bg-slate-700 text-slate-300"],
              ["EVALUATED", "đã có kết quả TP/SL", "bg-green-900/50 text-green-400"],
              ["EXPIRED", "hết horizon không chạm TP/SL", "bg-yellow-900/50 text-yellow-400"],
              ["SKIPPED", "không có setup", "bg-slate-800 text-slate-500"],
            ] as const).map(([st, label, cls]) => (
              <span key={st} className={`px-2 py-1 rounded ${cls}`}>
                {st}: {perfQuery.data.statusCounts[st] ?? 0}
                <span className="ml-1 opacity-70">— {label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {perfQuery.isLoading ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-slate-400">
          Đang tính setup performance…
        </div>
      ) : perfQuery.error || !perfQuery.data ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-red-400">
          Lỗi setup-performance: {(perfQuery.error as Error)?.message ?? "không có dữ liệu"}
          <span className="block mt-2 text-xs text-slate-500">
            Chưa có picks trong DB? Picks được lưu từ BT-01 (mỗi lần dashboard gọi top-recommendations) — cần dữ liệu tích lũy.
          </span>
        </div>
      ) : (
        <>
          {/* ── KPI tiles (5) ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {kpi("Đã chốt view", String(settled.length), `${filtered.length} pick trong view`, BarChart3)}
            {kpi(
              "Win rate",
              winRate == null ? "—" : `${winRate}%`,
              ci ? `95% CI ${ci.lo}–${ci.hi}% · ${wins}W/${losses}L` : `${wins}W/${losses}L`,
              Percent,
              winRate == null ? "text-slate-400" : winRate >= 50 ? "text-green-400" : "text-red-400"
            )}
            {kpi(
              `Avg R (${rMode})`,
              fmtR(avgR),
              `expectancy ${fmtR(avgR)}/lệnh · tổng ${fmtR(totalR)}`,
              TrendingUp,
              avgR == null ? "text-slate-400" : avgR >= 0 ? "text-green-400" : "text-red-400"
            )}
            {kpi(
              "NO_HIT",
              noHitPct == null ? "—" : `${noHitPct}%`,
              `${noHit} pick hết horizon không chạm TP/SL`,
              TrendingDown,
              noHitPct == null ? "text-slate-400" : noHitPct >= 40 ? "text-amber-400" : "text-slate-300"
            )}
            {kpi(
              "Sẵn sàng chốt",
              String(readyToSettle),
              noDataNow > 0 ? `⚠ ${noDataNow} thiếu nến (chưa thể chốt)` : `horizon ${horizon}d · còn window ${stillOpenNow}`,
              Target,
              readyToSettle > 0 ? "text-green-400" : "text-slate-300"
            )}
          </div>

          {/* ── Risk strip ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-slate-400 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-400" /> Max drawdown (R)
              </span>
              <span className={`text-lg font-semibold ${maxDrawdownR(rs) < 0 ? "text-red-400" : "text-slate-300"}`}>
                {maxDrawdownR(rs).toFixed(2)}R
              </span>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-slate-400 flex items-center gap-2">
                <Scale className="h-4 w-4 text-blue-400" /> Profit factor
              </span>
              <span className="text-lg font-semibold text-slate-200">
                {profitFactor(rs) == null ? "—" : profitFactor(rs)?.toFixed(2)}
              </span>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-slate-400 flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400" /> Chuỗi thua dài nhất
              </span>
              <span className="text-lg font-semibold text-slate-200">
                {longestLosingStreak(settled.map((p) => p.outcome))}
              </span>
            </div>
          </div>

          {/* ── BT-07c: BTC benchmark strip ── */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
            {benchmark == null ? (
              <span className="text-xs text-slate-500">
                Benchmark BTC chưa sẵn sàng (cần đủ nến BTC trong cùng cửa sổ giao dịch).
              </span>
            ) : (
              <>
                <span className="text-slate-300">
                  BTC buy-hold{" "}
                  <span className={benchmark.returnPct >= 0 ? "text-green-400" : "text-red-400"}>
                    {benchmark.returnPct >= 0 ? "+" : ""}
                    {benchmark.returnPct}%
                  </span>
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-300">
                  strategy{" "}
                  <span className={strategyPct >= 0 ? "text-green-400" : "text-red-400"}>
                    {strategyPct >= 0 ? "+" : ""}
                    {strategyPct}%
                  </span>
                </span>
                <span className="text-xs text-slate-500">
                  ({benchmark.from} → {benchmark.to} · giả định rủi ro {RISK_PCT_PER_TRADE}% vốn/lệnh)
                </span>
                <span className={`ml-auto text-xs font-medium ${strategyPct > benchmark.returnPct ? "text-green-400" : "text-amber-400"}`}>
                  {strategyPct > benchmark.returnPct ? "Strategy đang thắng BTC" : "BTC đang thắng strategy"}
                </span>
              </>
            )}
          </div>

          {/* ── Insights ── */}
          {insights.length > 0 && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Info className="h-4 w-4 text-cyan-400" /> Nhận định tự động
              </h4>
              <ul className="space-y-2">
                {insights.map((ins, i) => (
                  <li
                    key={i}
                    className={`text-xs border-l-2 rounded px-3 py-2 ${TONE_CLASS[ins.tone]}`}
                  >
                    {ins.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── 4 charts ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {chartCard(
              `Equity curve (cumulative ${rMode} R)`,
              equityCurve.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">Chưa có lệnh nào có R để vẽ.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={equityCurve} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="btEquity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickFormatter={(v) => String(v).slice(5)} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [`${v}R`, "Cumulative"]} />
                    <ReferenceLine y={0} stroke="#475569" />
                    <Area type="monotone" dataKey="cumR" stroke="#22d3ee" strokeWidth={2} fill="url(#btEquity)" />
                  </AreaChart>
                </ResponsiveContainer>
              )
            )}

            {chartCard(
              "Win rate theo tháng",
              monthly.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">Chưa có tháng nào đủ trade.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} />
                    <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [`${v}%`, "Win rate"]} />
                    <ReferenceLine y={50} stroke="#475569" strokeDasharray="4 4" />
                    <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                      {monthly.map((m) => (
                        <Cell key={m.month} fill={m.winRate >= 50 ? "#22c55e" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            )}

            {chartCard(
              "Phân bố outcome",
              settled.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">Chưa có outcome nào để đếm.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={outcomeDist} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                    <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v) => [String(v), "Số pick"]} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      <Cell fill="#22c55e" />
                      <Cell fill="#22d3ee" />
                      <Cell fill="#ef4444" />
                      <Cell fill="#eab308" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            )}

            {chartCard(
              "Health band (avg R + win rate)",
              bandChart.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">Chưa có pick theo band.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={bandChart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="band" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={11} />
                    <RechartsTooltip contentStyle={CHART_TOOLTIP_STYLE} />
                    <ReferenceLine y={0} stroke="#475569" />
                    <Bar dataKey="avgR" name="Avg R" radius={[4, 4, 0, 0]}>
                      {bandChart.map((b) => (
                        <Cell key={b.band} fill={b.avgR >= 0 ? "#22c55e" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )
            )}
          </div>

          {/* ── Pick table: filters + sort + pagination + CSV ── */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h4 className="text-sm font-semibold text-white">
                Bảng pick ({sorted.length})
              </h4>

              <select
                value={viewHorizon}
                onChange={(e) => setViewHorizon(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="all">Horizon: tất cả</option>
                {HORIZONS.map((h) => (
                  <option key={h} value={String(h)}>{h}d</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                {["all", "EVALUATED", "EXPIRED", "SKIPPED"].map((s) => (
                  <option key={s} value={s}>{s === "all" ? "Status: tất cả" : s}</option>
                ))}
              </select>

              <select
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                {["all", "TP1_WIN", "TP2_WIN", "SL_LOSS", "NO_HIT", "NO_SETUP"].map((o) => (
                  <option key={o} value={o}>{o === "all" ? "Outcome: tất cả" : o}</option>
                ))}
              </select>

              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                {["all", "BULLISH", "BEARISH"].map((d) => (
                  <option key={d} value={d}>{d === "all" ? "Hướng: tất cả" : d === "BULLISH" ? "LONG" : "SHORT"}</option>
                ))}
              </select>

              <select
                value={signalFilter}
                onChange={(e) => setSignalFilter(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                <option value="all">Signal: tất cả</option>
                {signalOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm coin…"
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 w-28"
              />

              <Button variant="secondary" size="sm" className="ml-auto" onClick={downloadCsv}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
              </Button>
            </div>

            {sorted.length === 0 ? (
              <p className="text-xs text-slate-500">
                Không có pick nào khớp filter — nới filter hoặc bấm “Chạy backtest” khi đã tích lũy đủ window.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b border-slate-700">
                        {th("dataDate", "Ngày")}
                        {th("symbol", "Coin")}
                        {th("direction", "Dir")}
                        {th("signal", "Signal")}
                        {th("healthScore", "Health")}
                        {th("pickKind", "Kind")}
                        {th("status", "Status")}
                        {th("outcome", "Outcome")}
                        {th("exitR", `R (${rMode})`)}
                        {th("hitDay", "Ngày hit")}
                        {th("evaluatedAt", "Chốt lúc")}
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((p) => {
                        const r = rOf(p, rMode);
                        return (
                          <tr key={p.pickId} className="border-b border-slate-800 last:border-0">
                            <td className="py-2 pr-3 font-mono text-slate-400">{p.dataDate}</td>
                            <td className="py-2 pr-3 font-medium text-slate-200">{p.symbol}</td>
                            <td className={`py-2 pr-3 ${p.direction === "BULLISH" ? "text-green-400" : "text-red-400"}`}>
                              {p.direction === "BULLISH" ? "LONG" : "SHORT"}
                            </td>
                            <td className="py-2 pr-3 text-slate-400">{p.signal}</td>
                            <td className="py-2 pr-3 text-slate-300">{p.healthScore?.toFixed(0) ?? "—"}</td>
                            <td className="py-2 pr-3 text-slate-500">{p.pickKind}</td>
                            <td className="py-2 pr-3">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                p.status === "EVALUATED" ? "bg-green-900/50 text-green-400"
                                : p.status === "EXPIRED" ? "bg-yellow-900/50 text-yellow-400"
                                : p.status === "SKIPPED" ? "bg-slate-800 text-slate-500"
                                : "bg-slate-700 text-slate-300"
                              }`}>{p.status}</span>
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs">{outcomeCell(p.outcome)}</td>
                            <td
                              className={`py-2 pr-3 ${r == null ? "text-slate-500" : r >= 0 ? "text-green-400" : "text-red-400"}`}
                              title={`gross ${fmtR(p.exitR)} · net ${fmtR(p.exitRNet)} · phí ${p.costR == null ? "—" : p.costR + "R"}`}
                            >
                              {fmtR(r)}
                            </td>
                            <td className="py-2 pr-3 text-slate-400">{p.hitDay ?? "—"}</td>
                            <td className="py-2 pr-3 text-xs text-slate-500">
                              {p.evaluatedAt ? new Date(p.evaluatedAt).toLocaleDateString() : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
                  <span>
                    Trang {currentPage}/{pageCount} · {sorted.length} pick
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage <= 1}
                      className="p-1 rounded border border-slate-700 disabled:opacity-40 hover:bg-slate-700/40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      disabled={currentPage >= pageCount}
                      className="p-1 rounded border border-slate-700 disabled:opacity-40 hover:bg-slate-700/40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── 4 group tables (client-side) ── */}
          {statsTable("Theo direction", groupTables.direction)}
          {statsTable("Theo signal", groupTables.signal)}
          {statsTable("Theo health band", groupTables.band)}
          {statsTable("Genuine vs fill (tham khảo)", groupTables.kind)}

          <p className="text-xs text-slate-500">
            Quy tắc bảo thủ: một ngày giá chạm cả TP và SL → tính THUA (SL). Win rate = (TP1+TP2) /
            (TP1+TP2+SL) — NO_HIT và NO_SETUP không tính thua.{" "}
            {rMode === "NET"
              ? `R đang ở chế độ NET: đã trừ phí taker ${perfQuery.data.params.feeBps}bps + slippage ${perfQuery.data.params.slippageBps}bps mỗi bên.`
              : "R đang ở chế độ GROSS: chưa trừ phí/slippage."}{" "}
            Kết quả chốt 1 lần và lưu DB — xem lại bất cứ lúc nào.
          </p>
        </>
      )}

      {/* ── Health Power + Signal Quality (collapsed) ── */}
      <details className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <summary className="cursor-pointer text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" /> Health Power — sức mạnh dự báo của health score
        </summary>
        <div className="mt-4">
          {powerQuery.isLoading ? (
            <p className="text-sm text-slate-400">Đang tính health power…</p>
          ) : powerQuery.error || !powerQuery.data ? (
            <p className="text-sm text-red-400">
              Lỗi health-power: {(powerQuery.error as Error)?.message ?? "không có dữ liệu"}
            </p>
          ) : powerQuery.data.totalSamples === 0 ? (
            <p className="text-xs text-slate-500">{powerQuery.data.note ?? "Chưa có mẫu."}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                      <th className="py-2 pr-3">Band health</th>
                      <th className="py-2 pr-3">Samples</th>
                      <th className="py-2 pr-3">1d</th>
                      <th className="py-2 pr-3">3d</th>
                      <th className="py-2 pr-3">7d</th>
                      <th className="py-2">14d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powerQuery.data.byBand.map((b) => (
                      <tr key={b.band} className="border-b border-slate-800 last:border-0">
                        <td className={`py-2 pr-3 font-mono font-medium ${bandColor(b.band)}`}>{b.band}</td>
                        <td className="py-2 pr-3 text-slate-300">{b.samples}</td>
                        <td className={`py-2 pr-3 ${b.median1d == null ? "text-slate-500" : b.median1d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median1d, "%")}</td>
                        <td className={`py-2 pr-3 ${b.median3d == null ? "text-slate-500" : b.median3d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median3d, "%")}</td>
                        <td className={`py-2 pr-3 ${b.median7d == null ? "text-slate-500" : b.median7d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median7d, "%")}</td>
                        <td className={`py-2 pr-3 ${b.median14d == null ? "text-slate-500" : b.median14d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median14d, "%")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="text-sm font-semibold text-white mt-6 mb-3">Tương quan Pearson (score ↔ forward return %)</h4>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                      <th className="py-2 pr-3">Horizon</th>
                      <th className="py-2 pr-3">Samples</th>
                      <th className="py-2 pr-3">Health</th>
                      <th className="py-2 pr-3">Trend</th>
                      <th className="py-2 pr-3">Volume</th>
                      <th className="py-2 pr-3">Momentum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {powerQuery.data.correlations.map((c) => (
                      <tr key={c.horizonDays} className="border-b border-slate-800 last:border-0">
                        <td className="py-2 pr-3 font-mono text-slate-200">{c.horizonDays}d</td>
                        <td className="py-2 pr-3 text-slate-300">{c.samples}</td>
                        <td className="py-2 pr-3 font-medium text-slate-200">{fmt(c.health)}</td>
                        <td className="py-2 pr-3 text-slate-400">{fmt(c.trend)}</td>
                        <td className="py-2 pr-3 text-slate-400">{fmt(c.volume)}</td>
                        <td className="py-2 pr-3 text-slate-400">{fmt(c.momentum)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Health nên có |r| cao hơn trend/volume/momentum đơn lẻ — nếu không, composite chưa thêm giá trị. |r| &lt; 0.1 ≈ không có tín hiệu; mẫu &lt; 100 điểm thì đọc thận trọng.
              </p>
            </>
          )}
        </div>
      </details>

      <details className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
        <summary className="cursor-pointer text-sm font-semibold text-white flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" /> Signal Quality — chất lượng tín hiệu rule engine
        </summary>
        <div className="mt-4">
          <p className="text-xs text-slate-500 mb-3">
            Engine tốt: STRONG_WATCH có median return cao nhất, giảm dần về OBSERVE; WEAK/CAUTION âm. Nguồn: bảng recommendations + health_scores hiện có, so return 1/3/7/14 ngày.
          </p>
          {signalQuery.isLoading ? (
            <p className="text-sm text-slate-400">Đang tính chất lượng tín hiệu…</p>
          ) : signalQuery.error || !signalQuery.data ? (
            <p className="text-sm text-red-400">
              Lỗi signal-quality: {(signalQuery.error as Error)?.message ?? "không có dữ liệu"}
            </p>
          ) : signalQuery.data.totalSamples === 0 ? (
            <p className="text-xs text-slate-500">Chưa có mẫu trong lookback.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                      <th className="py-2 pr-3">Signal</th>
                      <th className="py-2 pr-3">Samples</th>
                      <th className="py-2 pr-3">1d</th>
                      <th className="py-2 pr-3">3d</th>
                      <th className="py-2 pr-3">7d</th>
                      <th className="py-2 pr-3">14d</th>
                      <th className="py-2">%7d dương</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signalQuery.data.bySignal.map((s) => (
                      <tr key={s.signal} className="border-b border-slate-800 last:border-0">
                        <td className="py-2 pr-3 font-mono text-slate-200">{s.signal}</td>
                        <td className="py-2 pr-3 text-slate-300">{s.samples}</td>
                        <td className={`py-2 pr-3 ${s.median1d == null ? "text-slate-500" : s.median1d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median1d, "%")}</td>
                        <td className={`py-2 pr-3 ${s.median3d == null ? "text-slate-500" : s.median3d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median3d, "%")}</td>
                        <td className={`py-2 pr-3 ${s.median7d == null ? "text-slate-500" : s.median7d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median7d, "%")}</td>
                        <td className={`py-2 pr-3 ${s.median14d == null ? "text-slate-500" : s.median14d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(s.median14d, "%")}</td>
                        <td className="py-2 text-slate-300">{s.positive7dRate == null ? "—" : `${s.positive7dRate}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="text-sm font-semibold text-white mt-6 mb-3">Score change có dự báo được không? (median 7d theo bucket)</h4>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                      <th className="py-2 pr-3">Δ score</th>
                      <th className="py-2 pr-3">Samples</th>
                      <th className="py-2 pr-3">Median 7d</th>
                      <th className="py-2">%7d dương</th>
                    </tr>
                  </thead>
                  <tbody>
                    {signalQuery.data.byScoreChange.map((b) => (
                      <tr key={b.bucket} className="border-b border-slate-800 last:border-0">
                        <td className="py-2 pr-3 font-mono text-slate-200">{b.bucket}</td>
                        <td className="py-2 pr-3 text-slate-300">{b.samples}</td>
                        <td className={`py-2 pr-3 ${b.median7d == null ? "text-slate-500" : b.median7d >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(b.median7d, "%")}</td>
                        <td className="py-2 text-slate-300">{b.positive7dRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Bucket Δ dương nên có median tốt hơn bucket Δ âm — nếu không, scoreChange chưa mang thông tin dự báo.
              </p>
            </>
          )}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <TrendingUp className="h-3.5 w-3.5" /> Lookback health/signal
        </span>
        <select
          value={daysBack}
          onChange={(e) => setDaysBack(Number(e.target.value))}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
        >
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>{d} ngày</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default BacktestSection;
