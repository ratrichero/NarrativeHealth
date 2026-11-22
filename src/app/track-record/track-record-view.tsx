"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { trackRecordFreshness } from "@/lib/backtest/track-record";
import {
  Activity,
  BarChart3,
  Info,
  Percent,
  Scale,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

// ─── Types (mirror of /api/track-record) ───────────────

export interface WilsonCI {
  lo: number;
  hi: number;
}

export interface DirectionStats {
  direction: string;
  picks: number;
  trades: number;
  wins: number;
  losses: number;
  noHit: number;
  winRate: number | null;
  avgRNet: number | null;
  entryFillRate: number | null;
}

export interface FillStats {
  known: number;
  filled: number;
  unfilled: number;
  rate: number | null;
  filledTrades: number;
  filledWins: number;
  filledLosses: number;
  filledWinRate: number | null;
  filledWinRateCI: WilsonCI | null;
  unfilledTrades: number;
  unfilledWins: number;
  unfilledLosses: number;
  unfilledWinRate: number | null;
}

export interface MonthStats {
  month: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgRNet: number | null;
}

export interface TrackRecordSummary {
  totals: {
    picks: number;
    trades: number;
    wins: number;
    losses: number;
    noHit: number;
    skipped: number;
  };
  winRate: number | null;
  winRateCI: WilsonCI | null;
  avgRNet: number | null;
  avgRGross: number | null;
  totalRNet: number;
  maxDrawdownR: number;
  profitFactor: number | null;
  /** Sharpe trên mỗi lệnh (avg net R / độ lệch chuẩn), chưa annualize. */
  sharpePerTrade: number | null;
  /** MAR = tổng net R / |max drawdown|; null khi chưa có drawdown. */
  marRatio: number | null;
  /** SAMPLE-01: đủ mẫu để kết luận chưa. */
  sample: {
    trades: number;
    episodes: number;
    minTrades: number;
    minEpisodes: number;
    sufficient: boolean;
    reason: "no-trades" | "thin-sample" | null;
  };
  /** DD-01: drawdown theo độ sâu và thời gian. */
  drawdown: {
    maxR: number;
    maxDays: number | null;
    currentR: number;
    currentFromDate: string | null;
  };
  /** ALPHA-01: chênh lệch so với basket kèm bootstrap CI. */
  alpha: {
    strategyPct: number;
    benchmarkPct: number;
    deltaPct: number;
    strategyCI: { lo: number; hi: number } | null;
    deltaCI: { lo: number; hi: number } | null;
    probOutperform: number | null;
    resamples: number;
    seed: number;
  } | null;
  longestLosingStreak: number;
  firstDate: string | null;
  lastDate: string | null;
  lastEvaluatedAt: string | null;
  equityCurve: { date: string; cumR: number }[];
  byDirection: DirectionStats[];
  monthly: MonthStats[];
  /** FILL-01: fill rate + win rate split by whether the entry filled. */
  fill: FillStats;
  /** BT-09: bootstrap CI + cỡ mẫu thật (episode độc lập). */
  uncertainty: {
    avgRNetCI: { lo: number; hi: number } | null;
    profitFactorCI: { lo: number; hi: number } | null;
    resamples: number;
    seed: number;
    episodes: number;
    largestEpisode: number;
  };
  metricsVersion: string;
}

export interface Benchmark {
  method?: "equal_weight" | "buy_hold";
  from: string;
  to: string;
  returnPct: number;
  /** Basket: số coin đóng góp / bị loại vì thiếu nến / trọng số lớn nhất. */
  constituents?: number;
  excluded?: number;
  maxWeightPct?: number | null;
  bestPerformer?: { symbol: string; returnPct: number } | null;
  /** BTC buy & hold: giá đầu/cuối cửa sổ. */
  startClose?: number;
  endClose?: number;
}

export interface RecentItem {
  dataDate: string;
  symbol: string;
  direction: string;
  outcome: string | null;
  exitRNet: number | null;
  entryFilled: boolean | null;
}

export interface HorizonStat {
  days: number;
  picks: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgRGross: number | null;
}

/**
 * FORWARD-01 — phần forward kể từ mốc live, tách khỏi lịch sử nạp lại.
 * `summary` chỉ tính pick có picked_at trùng ngày dữ liệu; `benchmark`/`btc`
 * đo trên đúng cửa sổ các lệnh forward.
 */
export interface ForwardSplit {
  liveSince: string | null;
  /** `env` = mốc LIVE_SINCE cấu hình; `derived` = suy từ pick forward sớm nhất. */
  liveSinceSource?: "env" | "derived" | null;
  forwardPicks: number;
  backfilledPicks: number;
  unknownPicks: number;
  lagGraceDays: number;
  summary: TrackRecordSummary | null;
  benchmark: Benchmark | null;
  btc: Benchmark | null;
}

export interface TrackRecordData {
  /** horizonDays = longest horizon the record covers (7 / 14 / 30 / 60). */
  params: { feeBps: number; slippageBps: number; roundTripBps: number; horizonDays?: number };
  /** Toàn bộ lịch sử đã chốt, gồm cả pick backfill. */
  summary: TrackRecordSummary;
  /** FORWARD-01: bằng chứng forward tách riêng khỏi backfill. */
  split?: ForwardSplit;
  /** Benchmark chính: basket equal-weight universe (null khi < 2 coin đủ nến). */
  benchmark: Benchmark | null;
  /** BTC buy & hold — cột tham chiếu riêng. */
  btc?: Benchmark | null;
  recent: RecentItem[];
  /** BT-10: kết quả append-only theo từng horizon (7/14/30/60). */
  horizons?: HorizonStat[];
  /** BT-11: NET R dưới kịch bản chi phí thực tế. */
  realistic?: {
    trades: number;
    avgRNet: number | null;
    totalRNet: number;
    deltaVsBase: number;
    fundingCovered: number;
  } | null;
  /** TRACK-01: dữ liệu công khai — dataAsOf, commit, changelog, bản tải. */
  meta?: {
    dataAsOf: string | null;
    generatedAt: string;
    metricsVersion: string;
    commit: string | null;
    changelog: readonly { version: string; note: string }[];
    /** WINDOW-01: đã cắt ở MAX_ROWS chưa. */
    window?: {
      capped: boolean;
      rowsRead: number;
      limit: number;
      oldestIncluded: string | null;
    };
  };
}

// ─── Formatting helpers ────────────────────────────────

/** 1% of capital risked per trade → total R maps 1:1 to % of capital. */
export const RISK_PCT_PER_TRADE = 1;

export const fmtR = (v: number | null): string =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`;

export const fmtPct = (v: number | null): string => (v == null ? "—" : `${v.toFixed(1)}%`);

export const toneOf = (v: number | null): string =>
  v == null ? "text-slate-400" : v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-slate-300";

export function directionLabel(direction: string): { label: string; className: string } {
  return direction === "BEARISH"
    ? { label: "SHORT", className: "bg-red-900/40 text-red-300 border-red-900/60" }
    : { label: "LONG", className: "bg-emerald-900/40 text-emerald-300 border-emerald-900/60" };
}

const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#1e293b",
  border: "1px solid #334155",
  borderRadius: "8px",
  fontSize: 12,
};

// ─── Small building blocks ─────────────────────────────

function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  valueClass = "text-white",
  color = "text-cyan-400",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof TrendingUp;
  valueClass?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-slate-400 text-sm font-medium">{label}</span>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div className={`text-2xl font-bold ${valueClass}`}>{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ForwardStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-slate-800/40 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub ? <div className="text-xs text-slate-500 mt-1">{sub}</div> : null}
    </div>
  );
}

function SectionCard({
  title,
  children,
  className = "",
}: {
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

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  const cls =
    outcome === "TP1_WIN" || outcome === "TP2_WIN"
      ? "bg-green-900/50 text-green-400"
      : outcome === "SL_LOSS"
        ? "bg-red-900/50 text-red-400"
        : "bg-slate-800 text-slate-400";
  const label =
    outcome === "TP1_WIN" ? "TP1" : outcome === "TP2_WIN" ? "TP2" : outcome === "SL_LOSS" ? "SL" : outcome ?? "—";
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

// ─── View ──────────────────────────────────────────────

export function TrackRecordView({ data }: { data: TrackRecordData }) {
  const { summary: s, benchmark, btc, recent, params } = data;
  const noTrades = s.totals.trades === 0;
  // FORWARD-01: phần forward (nếu API đã trả) — headline của trang là bằng
  // chứng forward, còn số toàn bộ lịch sử ở dưới chỉ để tham chiếu.
  const split = data.split;
  const forward = split?.summary ?? null;

  const strategyPct = +(s.totalRNet * RISK_PCT_PER_TRADE).toFixed(2);
  const beatsBasket = benchmark != null && strategyPct > benchmark.returnPct;
  // SAMPLE-01: số liệu vẫn hiện đủ, nhưng câu kết luận cần mẫu tối thiểu.
  const verdictReady = s.sample.sufficient;

  const ci = s.uncertainty;
  const avgRSub =
    [
      s.avgRGross != null ? `gross ${fmtR(s.avgRGross)}` : null,
      ci.avgRNetCI ? `bootstrap 95%: ${ci.avgRNetCI.lo.toFixed(2)}R … ${ci.avgRNetCI.hi.toFixed(2)}R` : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;
  const pfSub = ci.profitFactorCI
    ? `95% CI ${ci.profitFactorCI.lo.toFixed(2)}–${ci.profitFactorCI.hi.toFixed(2)} · ${ci.episodes} episode độc lập`
    : "tổng R thắng / |tổng R thua|";

  // FRESH-01: cùng pattern với cảnh báo snapshot cũ ở /radar — đồng hồ nằm
  // trong state để render không gọi Date.now() trực tiếp. Ngưỡng tính theo
  // ngày nên tick mỗi giờ là đủ.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const todayIso = clock > 0 ? new Date(clock).toISOString().slice(0, 10) : null;
  const freshness = todayIso ? trackRecordFreshness(s, todayIso, params.horizonDays) : null;
  const stale = freshness?.stale === true;
  const lastUpdateLabel = s.lastEvaluatedAt
    ? new Date(s.lastEvaluatedAt).toLocaleDateString("vi-VN")
    : null;

  let staleMessage = "";
  if (freshness?.reason === "no-settlement-stamp") {
    staleMessage = `Đã chốt ${s.totals.picks} pick nhưng chưa từng ghi nhận lần chốt nào — settlement có thể không chạy. Số bên dưới chỉ là lịch sử đã lưu.`;
  } else if (freshness?.reason === "settlement-old") {
    staleMessage = `Lần chốt gần nhất ${lastUpdateLabel ?? "—"}, ${freshness.settlementAgeDays} ngày trước — settlement đã ngừng chốt pick mới.`;
  } else if (freshness?.reason === "pick-pipeline-old") {
    staleMessage = `Pick mới nhất đã ${freshness.pickAgeDays} ngày, vượt mức hợp lệ ${freshness.pickLimitDays} ngày (horizon + ân hạn) — pipeline sinh pick có thể đã dừng.`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-cyan-400" />
            <h1 className="text-2xl font-bold text-white">Track Record</h1>
          </div>
          <p className="text-slate-400 mt-1 max-w-2xl">
            Every settled pick, measured <span className="text-slate-300">after</span> fees and
            slippage. No cherry-picking — win rate comes with a confidence interval so a thin
            sample cannot masquerade as an edge.
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {s.firstDate && s.lastDate ? `${s.firstDate} → ${s.lastDate}` : "No settled picks yet"}
            {s.lastEvaluatedAt ? ` · last update ${new Date(s.lastEvaluatedAt).toLocaleDateString()}` : ""}
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3">
          <div className="text-xs text-slate-500">Settled picks</div>
          <div className="text-2xl font-bold text-white">{s.totals.picks}</div>
          <div className="text-xs text-slate-500 mt-1">
            {s.totals.trades} resolved trades
            {s.totals.skipped > 0 ? ` · ${s.totals.skipped} skipped` : ""}
          </div>
        </div>
      </div>

      {/* Transparency bar — dữ liệu tới đâu, bản nào, tải bản gốc. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          Dữ liệu tới <span className="text-slate-300">{data.meta?.dataAsOf ?? s.lastDate ?? "—"}</span>
        </span>
        <span className="font-mono">{s.metricsVersion}</span>
        {data.meta?.commit ? <span className="font-mono">{data.meta.commit}</span> : null}
        <a className="text-cyan-400 hover:underline" href="/api/track-record/export">
          Tải CSV
        </a>
        <a className="text-cyan-400 hover:underline" href="/api/track-record/export?format=json">
          JSON
        </a>
        {data.meta?.window?.capped ? (
          <span className="text-amber-300/80">
            chỉ tính {data.meta.window.rowsRead} pick gần nhất (giới hạn {data.meta.window.limit}, cũ nhất{" "}
            {data.meta.window.oldestIncluded ?? "—"})
          </span>
        ) : null}
      </div>

      {stale ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <strong>Dữ liệu cũ.</strong> {staleMessage}
        </div>
      ) : null}

      {split ? (
        <SectionCard title="Forward record — kể từ mốc live">
          {forward == null ? (
            <p className="text-sm text-slate-400">
              <strong className="text-slate-200">Chưa có pick nào được tạo live.</strong>{" "}
              {split.backfilledPicks} pick hiện có đều được ghi sau ngày dữ liệu (backfill)
              {split.unknownPicks > 0 ? `, ${split.unknownPicks} pick thiếu picked_at` : ""} — số
              liệu bên dưới là lịch sử nạp lại, chưa phải bằng chứng forward.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Mốc live <span className="text-slate-300">{split.liveSince ?? "—"}</span>{" "}
                {split.liveSinceSource === "env"
                  ? "(cấu hình LIVE_SINCE)"
                  : split.liveSinceSource === "derived"
                    ? "(suy từ picked_at)"
                    : ""}{" "}
                · {split.forwardPicks} pick được ghi trong {split.lagGraceDays} ngày kể từ ngày dữ
                liệu · {split.backfilledPicks} pick backfill
                {split.unknownPicks > 0 ? ` + ${split.unknownPicks} pick thiếu picked_at` : ""} bị
                loại khỏi phần này.
              </p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <ForwardStat
                  label="Win rate kể từ live"
                  value={fmtPct(forward.winRate)}
                  sub={
                    forward.winRateCI
                      ? `95% CI ${forward.winRateCI.lo.toFixed(1)}–${forward.winRateCI.hi.toFixed(1)}% · ${forward.totals.wins}W / ${forward.totals.losses}L`
                      : `${forward.totals.wins}W / ${forward.totals.losses}L`
                  }
                />
                <ForwardStat
                  label="Net R kể từ live"
                  value={fmtR(forward.totalRNet)}
                  sub={`≈ ${forward.totalRNet >= 0 ? "+" : ""}${(
                    forward.totalRNet * RISK_PCT_PER_TRADE
                  ).toFixed(2)}% vốn @ rủi ro ${RISK_PCT_PER_TRADE}%/lệnh`}
                />
                <ForwardStat
                  label="Lệnh kể từ live"
                  value={String(forward.totals.trades)}
                  sub={`${forward.uncertainty.episodes} episode độc lập · avg ${fmtR(forward.avgRNet)}/lệnh`}
                />
                <ForwardStat
                  label="Max drawdown kể từ live"
                  value={`${forward.maxDrawdownR.toFixed(2)}R`}
                  sub={
                    forward.drawdown.maxDays != null
                      ? `underwater dài nhất ${forward.drawdown.maxDays} ngày`
                      : "chưa từng drawdown"
                  }
                />
              </div>
              {!forward.sample.sufficient ? (
                <p className="rounded-lg border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-300">
                  <strong>Đang tích lũy, chưa đủ mẫu.</strong> Kể từ live mới có{" "}
                  {forward.sample.trades} lệnh / {forward.sample.episodes} episode; cần{" "}
                  {forward.sample.minTrades} lệnh và {forward.sample.minEpisodes} episode mới được
                  kết luận.
                </p>
              ) : null}
              {forward.alpha ? (
                <p className="text-xs text-slate-400">
                  Alpha kể từ live so basket:{" "}
                  <span className={toneOf(forward.alpha.deltaPct)}>
                    {forward.alpha.deltaPct >= 0 ? "+" : ""}
                    {forward.alpha.deltaPct.toFixed(2)} điểm %
                  </span>
                  {forward.alpha.deltaCI
                    ? ` · bootstrap 95% ${forward.alpha.deltaCI.lo.toFixed(2)}…${forward.alpha.deltaCI.hi.toFixed(2)}`
                    : ""}{" "}
                  · xác suất vượt basket{" "}
                  {forward.alpha.probOutperform == null ? "—" : `${forward.alpha.probOutperform}%`}
                </p>
              ) : null}
              <p className="text-xs text-slate-500">
                {split.benchmark
                  ? `Basket forward ${split.benchmark.from} → ${split.benchmark.to}: ${
                      split.benchmark.returnPct >= 0 ? "+" : ""
                    }${split.benchmark.returnPct}% (${split.benchmark.constituents ?? 0} coin).`
                  : "Basket forward chưa sẵn sàng (cửa sổ forward quá ngắn hoặc thiếu nến)."}{" "}
                Pick backfill không được tính vào bất kỳ số nào ở đây.
              </p>
            </div>
          )}
        </SectionCard>
      ) : null}

      <div className="flex items-baseline justify-between pt-2">
        <h2 className="text-lg font-semibold text-white">Toàn bộ lịch sử (gồm pick backfill)</h2>
        <span className="text-xs text-slate-500">
          {s.totals.picks} pick · {s.totals.trades} lệnh
        </span>
      </div>

      {!noTrades && !s.sample.sufficient ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
          <strong>Chưa đủ mẫu để kết luận.</strong> Toàn bộ lịch sử hiện có{" "}
          {s.sample.trades} lệnh /{" "}
          {s.sample.episodes} episode độc lập; ngưỡng công bố kết luận là{" "}
          {s.sample.minTrades} lệnh và {s.sample.minEpisodes} episode. Các số bên dưới là thật,
          nhưng chưa đủ để nói hệ thống có edge hay không.
        </div>
      ) : null}

      {noTrades ? (
        <Card>
          <CardContent className="text-center py-16">
            <Info className="h-8 w-8 text-slate-600 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-white mb-2">Track record đang tích lũy</h2>
            <p className="text-slate-400 max-w-md mx-auto text-sm">
              Hệ thống đã lưu {s.totals.picks} pick nhưng chưa có lệnh nào chốt xong (cần đủ horizon
              trước khi kết quả là bất biến). Số liệu sẽ xuất hiện ở đây ngay khi những pick đầu tiên
              đóng cửa sổ — không có số liệu nào được suy diễn trước.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile
              label="Win rate"
              value={fmtPct(s.winRate)}
              sub={
                s.winRateCI
                  ? `95% CI ${s.winRateCI.lo.toFixed(1)}–${s.winRateCI.hi.toFixed(1)}% · ${s.totals.wins}W / ${s.totals.losses}L`
                  : `${s.totals.wins}W / ${s.totals.losses}L`
              }
              icon={Percent}
              color="text-cyan-400"
            />
            <KpiTile
              label="Win rate (đã khớp entry)"
              value={fmtPct(s.fill.filledWinRate)}
              sub={
                s.fill.filledTrades > 0
                  ? `${s.fill.filledWins}W / ${s.fill.filledLosses}L trên ${s.fill.filledTrades} lệnh đã khớp vùng entry`
                  : "chưa có lệnh nào ghi nhận trạng thái khớp entry"
              }
              icon={Target}
              color="text-emerald-400"
            />
            <KpiTile
              label="Entry fill rate"
              value={fmtPct(s.fill.rate)}
              sub={
                s.fill.known > 0
                  ? `${s.fill.filled}/${s.fill.known} pick chạm vùng entry` +
                    (s.fill.unfilledTrades > 0
                      ? ` · ${s.fill.unfilledTrades} lệnh TP/SL chưa khớp entry (win ${fmtPct(s.fill.unfilledWinRate)})`
                      : "")
                  : "chưa lưu được trạng thái khớp entry"
              }
              icon={Target}
              color="text-purple-400"
            />
            <KpiTile
              label="Avg net R / trade"
              value={fmtR(s.avgRNet)}
              sub={avgRSub}
              icon={TrendingUp}
              valueClass={toneOf(s.avgRNet)}
              color="text-green-400"
            />
            <KpiTile
              label="Total net R"
              value={fmtR(s.totalRNet)}
              sub={`≈ ${strategyPct >= 0 ? "+" : ""}${strategyPct}% vốn @ rủi ro ${RISK_PCT_PER_TRADE}%/lệnh`}
              icon={Scale}
              valueClass={toneOf(s.totalRNet)}
              color="text-emerald-400"
            />
            <KpiTile
              label="Max drawdown"
              value={`${s.maxDrawdownR.toFixed(2)}R`}
              sub={[
                "đáy sâu nhất so với đỉnh equity",
                s.drawdown.maxDays != null
                  ? `underwater dài nhất ${s.drawdown.maxDays} ngày`
                  : null,
                s.drawdown.currentR < 0
                  ? `hiện ${s.drawdown.currentR.toFixed(2)}R dưới đỉnh`
                  : "đang ở đỉnh equity",
              ]
                .filter(Boolean)
                .join(" · ")}
              icon={TrendingDown}
              valueClass={s.maxDrawdownR < 0 ? "text-red-400" : "text-slate-300"}
              color="text-red-400"
            />
            <KpiTile
              label="Profit factor"
              value={s.profitFactor == null ? "—" : s.profitFactor.toFixed(2)}
              sub={pfSub}
              icon={BarChart3}
              color="text-blue-400"
            />
            <KpiTile
              label="Sharpe / trade"
              value={s.sharpePerTrade == null ? "—" : s.sharpePerTrade.toFixed(2)}
              sub="avg net R / độ lệch chuẩn R mỗi lệnh · chưa annualize"
              icon={Activity}
              valueClass={toneOf(s.sharpePerTrade)}
              color="text-cyan-400"
            />
            <KpiTile
              label="MAR (net R / drawdown)"
              value={s.marRatio == null ? "—" : s.marRatio.toFixed(2)}
              sub={
                s.marRatio == null
                  ? "chưa có drawdown để so"
                  : s.marRatio < 1
                    ? "dưới 1: drawdown sâu hơn lợi nhuận kiếm được"
                    : "tổng net R / |max drawdown|"
              }
              icon={Shield}
              valueClass={toneOf(s.marRatio)}
              color="text-fuchsia-400"
            />
            <KpiTile
              label="Longest losing streak"
              value={String(s.longestLosingStreak)}
              sub="chuỗi SL liên tiếp dài nhất"
              icon={Shield}
              color="text-amber-400"
            />
          </div>

          {/* Kịch bản chi phí thực tế — con số thận trọng, không thay track record chính */}
          {data.realistic && data.realistic.trades > 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-400">
              <span className="font-medium text-slate-200">Kịch bản chi phí thực tế</span> (slippage
              theo ATR, funding, chốt 50% ở TP1):{" "}
              <span className={toneOf(data.realistic.avgRNet)}>
                {fmtR(data.realistic.avgRNet)}
              </span>
              /lệnh · tổng{" "}
              <span className={toneOf(data.realistic.totalRNet)}>
                {fmtR(data.realistic.totalRNet)}
              </span>{" "}
              · {data.realistic.fundingCovered}/{data.realistic.trades} lệnh có dữ liệu funding ·
              chênh {fmtR(data.realistic.deltaVsBase)} so với track record chính.
            </div>
          ) : null}

          {/* Equity curve */}
          <SectionCard title="Equity curve (cumulative net R)">
            {s.equityCurve.length === 0 ? (
              <p className="text-slate-500 text-sm py-6 text-center">No trades to plot yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={s.equityCurve} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickFormatter={(v) => String(v).slice(5)} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <RechartsTooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(v) => [`${v}R`, "Cumulative"]}
                    labelFormatter={(l) => `Closed ${l}`}
                  />
                  <ReferenceLine y={0} stroke="#475569" />
                  <Area
                    type="monotone"
                    dataKey="cumR"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    fill="url(#trEquity)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          {/* Benchmark — basket equal-weight là mốc chính, BTC chỉ là cột tham chiếu */}
          <SectionCard title="Strategy vs basket equal-weight (universe)">
            {benchmark == null ? (
              <p className="text-slate-500 text-sm py-4">
                Basket benchmark chưa sẵn sàng (cần ít nhất 2 coin trong universe có nến gần cả hai
                đầu cửa sổ giao dịch).
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-lg bg-slate-800/40 p-4">
                    <div className="text-xs text-slate-500">Strategy (net, rủi ro 1%/lệnh)</div>
                    <div className={`text-2xl font-bold ${toneOf(strategyPct)}`}>
                      {strategyPct >= 0 ? "+" : ""}
                      {strategyPct}%
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{fmtR(s.totalRNet)} tổng</div>
                  </div>
                  <div className="rounded-lg bg-slate-800/40 p-4">
                    <div className="text-xs text-slate-500">
                      Basket equal-weight ({benchmark.from} → {benchmark.to})
                    </div>
                    <div className={`text-2xl font-bold ${toneOf(benchmark.returnPct)}`}>
                      {benchmark.returnPct >= 0 ? "+" : ""}
                      {benchmark.returnPct}%
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {benchmark.constituents ?? 0} coin · tối đa {benchmark.maxWeightPct ?? "—"}%/coin
                      {benchmark.excluded ? ` · loại ${benchmark.excluded} coin thiếu nến` : ""}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-800/40 p-4">
                    <div className="text-xs text-slate-500">BTC buy &amp; hold (tham chiếu)</div>
                    <div className={`text-2xl font-bold ${toneOf(btc?.returnPct ?? null)}`}>
                      {btc == null
                        ? "—"
                        : `${btc.returnPct >= 0 ? "+" : ""}${btc.returnPct}%`}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {btc?.startClose != null && btc?.endClose != null
                        ? `$${btc.startClose.toLocaleString()} → $${btc.endClose.toLocaleString()}`
                        : "chưa đủ nến BTC trong cửa sổ"}
                    </div>
                  </div>
                  <div
                    className={`rounded-lg p-4 border ${
                      beatsBasket
                        ? "border-green-900/60 bg-green-950/20"
                        : "border-amber-900/60 bg-amber-950/20"
                    }`}
                  >
                    <div className="text-xs text-slate-500">Kết luận (so với basket)</div>
                    <div
                      className={`text-lg font-semibold ${
                        !verdictReady
                          ? "text-slate-400"
                          : beatsBasket
                            ? "text-green-400"
                            : "text-amber-400"
                      }`}
                    >
                      {!verdictReady
                        ? "Chưa đủ mẫu để kết luận"
                        : beatsBasket
                          ? "Strategy đang thắng basket"
                          : "Basket đang thắng strategy"}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      chênh {strategyPct - benchmark.returnPct >= 0 ? "+" : ""}
                      {(strategyPct - benchmark.returnPct).toFixed(2)} điểm %
                      {btc != null
                        ? ` · so BTC: ${strategyPct - btc.returnPct >= 0 ? "+" : ""}${(
                            strategyPct - btc.returnPct
                          ).toFixed(2)} điểm %`
                        : ""}
                    </div>
                  </div>
                </div>
                {s.alpha ? (
                  <p className="text-xs text-slate-400">
                    Alpha so basket:{" "}
                    <span className={toneOf(s.alpha.deltaPct)}>
                      {s.alpha.deltaPct >= 0 ? "+" : ""}
                      {s.alpha.deltaPct.toFixed(2)} điểm %
                    </span>
                    {s.alpha.deltaCI
                      ? ` · bootstrap 95% ${s.alpha.deltaCI.lo.toFixed(2)}…${s.alpha.deltaCI.hi.toFixed(2)}`
                      : ""}{" "}
                    · xác suất vượt basket{" "}
                    {s.alpha.probOutperform == null ? "—" : `${s.alpha.probOutperform}%`}{" "}
                    ({s.alpha.resamples.toLocaleString("vi-VN")} lần lấy lại mẫu, seed cố định{" "}
                    {s.alpha.seed})
                  </p>
                ) : null}
                {benchmark.bestPerformer ? (
                  <p className="text-xs text-slate-500">
                    Coin tăng mạnh nhất trong basket: {benchmark.bestPerformer.symbol}{" "}
                    {fmtPct(benchmark.bestPerformer.returnPct)} — equal weight nên một coin không thể
                    quyết định kết luận.
                  </p>
                ) : null}
              </div>
            )}
          </SectionCard>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SectionCard title="Theo hướng">
              {s.byDirection.length === 0 ? (
                <p className="text-slate-500 text-sm py-4">No data.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                      <th className="pb-2 pr-3">Direction</th>
                      <th className="pb-2 pr-3 text-right">Trades</th>
                      <th className="pb-2 pr-3 text-right">Win rate</th>
                      <th className="pb-2 pr-3 text-right">Fill</th>
                      <th className="pb-2 text-right">Avg net R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.byDirection.map((d) => {
                      const dir = directionLabel(d.direction);
                      return (
                        <tr key={d.direction} className="border-b border-slate-800/50">
                          <td className="py-2 pr-3">
                            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${dir.className}`}>
                              {dir.label}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-slate-300">{d.trades}</td>
                          <td className="py-2 pr-3 text-right font-mono text-white">{fmtPct(d.winRate)}</td>
                          <td className="py-2 pr-3 text-right font-mono text-slate-400">{fmtPct(d.entryFillRate)}</td>
                          <td className={`py-2 text-right font-mono ${toneOf(d.avgRNet)}`}>{fmtR(d.avgRNet)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </SectionCard>

            <SectionCard title="Theo tháng">
              {s.monthly.length === 0 ? (
                <p className="text-slate-500 text-sm py-4">No data.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                      <th className="pb-2 pr-3">Month</th>
                      <th className="pb-2 pr-3 text-right">Trades</th>
                      <th className="pb-2 pr-3 text-right">W / L</th>
                      <th className="pb-2 pr-3 text-right">Win rate</th>
                      <th className="pb-2 text-right">Avg net R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.monthly.map((m) => (
                      <tr key={m.month} className="border-b border-slate-800/50">
                        <td className="py-2 pr-3 text-slate-300">{m.month}</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-300">{m.trades}</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-400">
                          {m.wins}/{m.losses}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-white">{fmtPct(m.winRate)}</td>
                        <td className={`py-2 text-right font-mono ${toneOf(m.avgRNet)}`}>{fmtR(m.avgRNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </SectionCard>
          </div>

          {/* Horizon breakdown — append-only, cùng setup qua nhiều thời hạn */}
          {(data.horizons?.length ?? 0) > 0 ? (
            <SectionCard title="Theo horizon (append-only)">
              <p className="mb-3 text-xs text-slate-500">
                Mỗi lần chốt ghi thêm kết quả cho mọi horizon đã đóng window — cùng một setup có
                thể thắng ở 7 ngày nhưng thua ở 60 ngày. R trong bảng này là gross (chưa trừ phí).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                      <th className="pb-2 pr-3">Horizon</th>
                      <th className="pb-2 pr-3 text-right">Picks</th>
                      <th className="pb-2 pr-3 text-right">Trades</th>
                      <th className="pb-2 pr-3 text-right">W / L</th>
                      <th className="pb-2 pr-3 text-right">Win rate</th>
                      <th className="pb-2 text-right">Avg gross R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.horizons!.map((h) => (
                      <tr key={h.days} className="border-b border-slate-800/50">
                        <td className="py-2 pr-3 text-slate-300">{h.days}d</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-300">{h.picks}</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-300">{h.trades}</td>
                        <td className="py-2 pr-3 text-right font-mono text-slate-400">
                          {h.wins}/{h.losses}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-white">{fmtPct(h.winRate)}</td>
                        <td className={`py-2 text-right font-mono ${toneOf(h.avgRGross)}`}>
                          {h.avgRGross == null ? "—" : `${h.avgRGross.toFixed(2)}R`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ) : null}

          {/* Recent results */}
          <SectionCard title={`Kết quả gần đây (${recent.length})`}>
            {recent.length === 0 ? (
              <p className="text-slate-500 text-sm py-4">No settled trades yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                      <th className="pb-2 pr-4">Pick date</th>
                      <th className="pb-2 pr-4">Coin</th>
                      <th className="pb-2 pr-4">Direction</th>
                      <th className="pb-2 pr-4">Outcome</th>
                      <th className="pb-2 pr-4">Entry</th>
                      <th className="pb-2 text-right">Net R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r, i) => {
                      const dir = directionLabel(r.direction);
                      return (
                        <tr key={`${r.symbol}-${r.dataDate}-${i}`} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                          <td className="py-2 pr-4 text-slate-400 font-mono text-xs">{r.dataDate}</td>
                          <td className="py-2 pr-4 text-white font-medium">{r.symbol}</td>
                          <td className="py-2 pr-4">
                            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${dir.className}`}>
                              {dir.label}
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            <OutcomeBadge outcome={r.outcome} />
                          </td>
                          <td className="py-2 pr-4 text-xs">
                            {r.entryFilled === true ? (
                              <span className="text-emerald-400">đã khớp</span>
                            ) : r.entryFilled === false ? (
                              <span className="text-amber-400">chưa khớp</span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className={`py-2 text-right font-mono ${toneOf(r.exitRNet)}`}>{fmtR(r.exitRNet)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {/* Methodology — the "how do I trust these numbers" section */}
      <SectionCard title="Phương pháp & tính trung thực">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm text-slate-400">
          <p>
            <span className="text-slate-200 font-medium">Nguồn:</span> 6 pick/ngày từ khuyến nghị
            dashboard, chỉ tính pick GENUINE có setup (Entry/TP/SL) thật — không tính những coin
            được lấp chỗ để đủ 3 LONG / 3 SHORT.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Chốt một lần:</span> outcome được tính khi
            cửa sổ horizon đóng rồi lưu bất biến; trang này chỉ đọc lại, không tính lại — con số
            không đổi về sau.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Win rate:</span> TP1/TP2 / (TP1/TP2 + SL).
            NO_HIT (hết horizon mà không chạm TP/SL) <span className="text-slate-200">không</span>{" "}
            được tính là thắng.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Khớp entry:</span> outcome tính từ entryMid,
            nên một pick chạm TP trước khi giá quay lại vùng entry vẫn được tính thắng dù không ai
            vào được lệnh. Fill rate và win rate riêng trên các lệnh <em>đã khớp entry</em> được công
            bố để thấy rõ phần lạc quan đó thay vì để nó thổi phồng win rate chung.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Net R:</span> 1R = khoảng cách entry↔SL. Đã
            trừ phí taker {params.feeBps}bps + slippage {params.slippageBps}bps mỗi bên (round-trip{" "}
            {params.roundTripBps}bps). Gross R hiển thị để tham chiếu.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Confidence interval:</span> khoảng tin cậy
            Wilson 95% — mẫu càng mỏng thì khoảng càng rộng, không có chuyện “70% win rate” từ 10
            lệnh mà không kèm cảnh báo.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Bootstrap &amp; episode:</span> avg net R và
            profit factor có khoảng bootstrap 95% ({ci.resamples.toLocaleString("vi-VN")} lần lấy lại
            mẫu, seed cố định {ci.seed}) vì R có đuôi dày, không giả định phân phối chuẩn. Pick lặp
            cùng symbol + hướng trong 14 ngày là <em>một</em> cược: {s.totals.trades} lệnh thực ra
            chỉ còn {ci.episodes} episode độc lập (episode lớn nhất {ci.largestEpisode} lệnh) — CI
            hẹp giả tạo do đếm trùng được nêu ra thay vì giấu.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Sharpe &amp; MAR:</span> profit factor chỉ
            so tổng thắng với tổng thua, nên hai hệ thống cùng PF vẫn có thể khác nhau một trời một
            vực về mức gồ ghề đường equity. Sharpe trên mỗi lệnh = avg net R / độ lệch chuẩn net R
            (mẫu, <em>chưa</em> annualize vì số lệnh/tuần không cố định); MAR = tổng net R / |max
            drawdown R| — MAR &lt; 1 nghĩa là cú lỗ sâu nhất lớn hơn toàn bộ lợi nhuận kiếm được.
            Cần tối thiểu 2 lệnh (và độ lệch chuẩn &gt; 0) mới có Sharpe; chưa từng drawdown thì MAR
            là null thay vì &ldquo;vô cực&rdquo;.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Cỡ mẫu &amp; alpha:</span> câu kết luận
            thắng/thua benchmark chỉ được công bố khi có ít nhất {s.sample.minTrades} lệnh và{" "}
            {s.sample.minEpisodes} episode độc lập; dưới ngưỡng, số liệu vẫn hiện đủ nhưng gắn nhãn{" "}
            <em>chưa đủ mẫu</em>. Alpha = strategy % − basket % (1R = {RISK_PCT_PER_TRADE}% vốn),
            kèm bootstrap {s.alpha ? s.alpha.resamples.toLocaleString("vi-VN") : "2.000"} lần lấy lại
            mẫu cho CI và xác suất vượt basket — chênh lệch dương nhỏ mà CI phủ 0 thì chưa phải edge.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Forward record vs lịch sử:</span> &ldquo;sinh
            ra kể từ live&rdquo; nghĩa là `picked_at` (lúc hàng được ghi lần đầu) không sớm hơn mốc
            live — mặc định lấy từ env <code>LIVE_SINCE</code>, không cấu hình thì suy từ pick
            forward sớm nhất; mốc đang dùng{" "}
            {split?.liveSince ? `là ${split.liveSince}` : "chưa có"}. Thêm nữa, pick chỉ được coi là
            forward khi được ghi trong {split ? split.lagGraceDays : 1} ngày kể từ `data_date` của
            nó: nạp lại lịch sử quá khứ (kể cả sau mốc live) bị loại khỏi khối forward và chỉ nằm
            trong &ldquo;Toàn bộ lịch sử&rdquo;, nên một lần backfill không thể làm đẹp con số forward.
            Pick thiếu `picked_at` cũng bị loại vì không chứng minh được là live. Win rate, net R
            và drawdown của khối forward đo trên đúng các lệnh đó, với benchmark riêng cùng cửa sổ.
          </p>
          <p>
            <span className="text-slate-200 font-medium">Benchmark:</span> basket{" "}
            <em>equal-weight</em> của mọi coin trong universe ở đúng cửa sổ các lệnh đã chốt — mỗi
            coin 1/N, không cân vốn hoá, nên kết luận không phụ thuộc việc BTC năm đó tăng hay giảm.
            Coin phải có nến gần cả hai đầu cửa sổ mới được tính, coin thiếu nến bị loại và đếm rõ;
            dưới 2 coin thì không công bố basket. BTC buy &amp; hold vẫn hiện như cột tham chiếu
            riêng. Quy đổi strategy sang % theo giả định rủi ro {RISK_PCT_PER_TRADE}% vốn mỗi lệnh
            (nêu rõ, không ẩn).
          </p>
          <p className="md:col-span-2 text-xs text-slate-500 pt-2 border-t border-slate-800">
            Phiên bản phương pháp: <span className="font-mono">{s.metricsVersion}</span>. Đây là kết
            quả đo lường nội bộ nhằm minh bạch hoá hiệu quả hệ thống,{" "}
            <span className="text-slate-300">không phải lời khuyên đầu tư</span>. Hiệu quả quá khứ
            không đảm bảo cho tương lai.
          </p>
          {data.meta?.changelog.length ? (
            <ul className="md:col-span-2 space-y-1 border-t border-slate-800 pt-2 text-xs text-slate-500">
              {data.meta.changelog.map((entry) => (
                <li key={entry.version}>
                  <span className="font-mono text-slate-400">{entry.version}</span> — {entry.note}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SectionCard>

      <div
        className={`flex items-center gap-2 text-xs ${
          stale ? "font-medium text-amber-300/80" : "text-slate-600"
        }`}
      >
        <Target className="h-3.5 w-3.5" />
        {stale
          ? `Cập nhật hằng ngày đang gián đoạn — lần chốt gần nhất ${lastUpdateLabel ?? "chưa ghi nhận"}.`
          : "Dữ liệu cập nhật mỗi khi refresh hằng ngày và backtest chốt lệnh."}
      </div>
    </div>
  );
}
