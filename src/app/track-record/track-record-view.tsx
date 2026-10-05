"use client";

import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
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
  longestLosingStreak: number;
  firstDate: string | null;
  lastDate: string | null;
  lastEvaluatedAt: string | null;
  equityCurve: { date: string; cumR: number }[];
  byDirection: DirectionStats[];
  monthly: MonthStats[];
  metricsVersion: string;
}

export interface Benchmark {
  from: string;
  to: string;
  startClose: number;
  endClose: number;
  returnPct: number;
}

export interface RecentItem {
  dataDate: string;
  symbol: string;
  direction: string;
  outcome: string | null;
  exitRNet: number | null;
}

export interface TrackRecordData {
  params: { feeBps: number; slippageBps: number; roundTripBps: number };
  summary: TrackRecordSummary;
  benchmark: Benchmark | null;
  recent: RecentItem[];
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
  const { summary: s, benchmark, recent, params } = data;
  const noTrades = s.totals.trades === 0;

  const strategyPct = +(s.totalRNet * RISK_PCT_PER_TRADE).toFixed(2);
  const beatsBtc = benchmark != null && strategyPct > benchmark.returnPct;

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
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
              label="Avg net R / trade"
              value={fmtR(s.avgRNet)}
              sub={s.avgRGross != null ? `gross ${fmtR(s.avgRGross)}` : undefined}
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
              sub="đáy sâu nhất so với đỉnh equity"
              icon={TrendingDown}
              valueClass={s.maxDrawdownR < 0 ? "text-red-400" : "text-slate-300"}
              color="text-red-400"
            />
            <KpiTile
              label="Profit factor"
              value={s.profitFactor == null ? "—" : s.profitFactor.toFixed(2)}
              sub="tổng R thắng / |tổng R thua|"
              icon={BarChart3}
              color="text-blue-400"
            />
            <KpiTile
              label="Longest losing streak"
              value={String(s.longestLosingStreak)}
              sub="chuỗi SL liên tiếp dài nhất"
              icon={Shield}
              color="text-amber-400"
            />
          </div>

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

          {/* Benchmark */}
          <SectionCard title="Strategy vs BTC buy & hold">
            {benchmark == null ? (
              <p className="text-slate-500 text-sm py-4">
                Benchmark chưa sẵn sàng (cần đủ nến BTC trong cùng cửa sổ giao dịch).
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                    BTC buy &amp; hold ({benchmark.from} → {benchmark.to})
                  </div>
                  <div className={`text-2xl font-bold ${toneOf(benchmark.returnPct)}`}>
                    {benchmark.returnPct >= 0 ? "+" : ""}
                    {benchmark.returnPct}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    ${benchmark.startClose.toLocaleString()} → ${benchmark.endClose.toLocaleString()}
                  </div>
                </div>
                <div
                  className={`rounded-lg p-4 border ${
                    beatsBtc ? "border-green-900/60 bg-green-950/20" : "border-amber-900/60 bg-amber-950/20"
                  }`}
                >
                  <div className="text-xs text-slate-500">Kết luận</div>
                  <div className={`text-lg font-semibold ${beatsBtc ? "text-green-400" : "text-amber-400"}`}>
                    {beatsBtc ? "Strategy đang thắng BTC" : "BTC đang thắng strategy"}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    chênh {strategyPct - benchmark.returnPct >= 0 ? "+" : ""}
                    {(strategyPct - benchmark.returnPct).toFixed(2)} điểm %
                  </div>
                </div>
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
            <span className="text-slate-200 font-medium">Benchmark:</span> BTC buy &amp; hold cùng
            đúng cửa sổ thời gian các lệnh đã chốt; quy đổi strategy sang % theo giả định rủi ro{" "}
            {RISK_PCT_PER_TRADE}% vốn mỗi lệnh (nêu rõ, không ẩn).
          </p>
          <p className="md:col-span-2 text-xs text-slate-500 pt-2 border-t border-slate-800">
            Phiên bản phương pháp: <span className="font-mono">{s.metricsVersion}</span>. Đây là kết
            quả đo lường nội bộ nhằm minh bạch hoá hiệu quả hệ thống,{" "}
            <span className="text-slate-300">không phải lời khuyên đầu tư</span>. Hiệu quả quá khứ
            không đảm bảo cho tương lai.
          </p>
        </div>
      </SectionCard>

      <div className="flex items-center gap-2 text-xs text-slate-600">
        <Target className="h-3.5 w-3.5" />
        Dữ liệu cập nhật mỗi khi refresh hằng ngày và backtest chốt lệnh.
      </div>
    </div>
  );
}
