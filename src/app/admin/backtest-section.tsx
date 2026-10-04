"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Search, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** BT-02 local view types (mirror of engine types, UI-shaped). */
interface GroupStatsT {
  group: string;
  picks: number;
  tp1Wins: number;
  tp2Wins: number;
  slLosses: number;
  noHit: number;
  open: number;
  winRate: number | null;
  avgR: number | null;
  avgDaysToExit: number | null;
  entryFillRate: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
}

interface PickOutcomeT {
  pickId: number;
  dataDate: string;
  coinId: number;
  symbol: string;
  direction: string;
  signal: string;
  healthScore: number | null;
  pickKind: string;
  status: string; // PENDING | EVALUATED | EXPIRED | SKIPPED
  outcome: string | null; // TP1_WIN | TP2_WIN | SL_LOSS | NO_HIT | NO_SETUP
  exitR: number | null;
  hitDay: number | null;
  mfePct: number | null;
  maePct: number | null;
  entryFilled: boolean | null;
  horizonDays: number | null;
  evaluatedAt: string | null;
  repeatCount: number;
}

/**
 * BT-02 — Backtest tab: measure whether the system's picks work.
 *  1. Setup Performance: persisted top-6 picks (BT-01) joined with daily OHLC
 *     → win-rate, realized R, MFE/MAE, entry-fill, by direction/signal/band.
 *  2. Health Power: does the health score predict forward returns?
 *     Median forward return per band + Pearson correlations per horizon.
 * Read-only; horizon/daysBack adjustable; no mutations.
 */
function BacktestSection() {
  const queryClientBC = useQueryClient();
  const [horizon, setHorizon] = useState(14);
  const [daysBack, setDaysBack] = useState(90);

  const perfQuery = useQuery({
    queryKey: ["admin", "backtest", "perf"],
    queryFn: async () => {
      const res = await fetch("/api/admin/backtest/setup-performance");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as {
        params: { includeAll: boolean; cutoff: string };
        totalPicks: number;
        evaluatedCount: number;
        pendingCount: number;
        statusCounts: { PENDING: number; EVALUATED: number; EXPIRED: number; SKIPPED: number };
        byDirection: GroupStatsT[];
        bySignal: GroupStatsT[];
        byHealthBand: GroupStatsT[];
        byPickKind: GroupStatsT[];
        picks: PickOutcomeT[];
      };
    },
  });

  // BT-03: evaluate PENDING picks once, store results — re-runs only process
  // picks still PENDING (window newly closed).
  const [runResult, setRunResult] = useState<null | {
    runId: string;
    horizon: number;
    pendingBefore: number;
    evaluated: number;
    expired: number;
    skipped: number;
    stillOpen: number;
    errors: number;
  }>(null);
  const runMutation = useMutation({
    mutationFn: async (opts: { dryRun?: boolean } = {}) => {
      const res = await fetch("/api/admin/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizon, dryRun: opts.dryRun ?? false }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data as NonNullable<typeof runResult>;
    },
    onSuccess: (data) => {
      setRunResult(data);
      queryClientBC.invalidateQueries({ queryKey: ["admin", "backtest", "perf"] });
    },
  });

  const powerQuery = useQuery({
    queryKey: ["admin", "backtest", "power", daysBack],
    queryFn: async () => {
      const res = await fetch(`//api/admin/backtest/health-power?daysBack=${daysBack}`.replace("//", "/"));
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

  const fmt = (v: number | null | undefined, suffix = "") =>
    v == null ? "—" : `${v > 0 && suffix === "%" ? "+" : ""}${v}${suffix}`;

  const bandColor = (b: string) =>
    b === "80+" ? "text-green-400" : b === "60-80" ? "text-cyan-400" : b === "40-60" ? "text-yellow-400" : "text-red-400";

  const statsTable = (title: string, rows: GroupStatsT[]) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-white mb-3">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">Chưa có picks nào đủ điều kiện.</p>
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
                <th className="py-2 pr-3">Avg R</th>
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
                  {g.avgR == null ? "—" : g.avgR}
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

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BarChart3 className="h-5 w-5 text-cyan-400" />
        <h3 className="text-lg font-semibold text-white">Backtest</h3>
        <span className="text-xs text-slate-500">
          đo hiệu quả picks + sức mạnh health score · pickKind GENUINE có setup, lookback {daysBack} ngày
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-slate-400">Horizon</label>
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
          >
            {[7, 14, 30, 60].map((h) => (
              <option key={h} value={h}>{h} ngày</option>
            ))}
          </select>
          <label className="text-xs text-slate-400 ml-2">Lookback</label>
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

      {/* ── Health Power ── */}
      {powerQuery.isLoading ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-slate-400">Đang tính health power…</div>
      ) : powerQuery.error || !powerQuery.data ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-red-400">
          Lỗi health-power: {(powerQuery.error as Error)?.message ?? "không có dữ liệu"}
        </div>
      ) : (
        <>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">
              Sức mạnh dự báo của health score (forward return %, median theo band)
            </h4>
            {powerQuery.data.totalSamples === 0 ? (
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

                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-white mb-3">Tương quan Pearson (score ↔ forward return %)</h4>
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
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Signal Quality (BT-04) ── */}
      {signalQuery.isLoading ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-slate-400">Đang tính chất lượng tín hiệu…</div>
      ) : signalQuery.error || !signalQuery.data ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-red-400">
          Lỗi signal-quality: {(signalQuery.error as Error)?.message ?? "không có dữ liệu"}
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-white mb-1">Chất lượng tín hiệu rule engine (toàn hệ thống, không chỉ 6 picks)</h4>
          <p className="text-xs text-slate-500 mb-3">
            Engine tốt: STRONG_WATCH có median return cao nhất, giảm dần về OBSERVE; WEAK/CAUTION âm. Nguồn: bảng recommendations + health_scores hiện có, so return 1/3/7/14 ngày.
          </p>
          {signalQuery.data.totalSamples === 0 ? (
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

              <div className="mt-6">
                <h4 className="text-sm font-semibold text-white mb-3">Score change có dự báo được không? (median 7d theo bucket)</h4>
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
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Setup Performance ── */}
      {perfQuery.isLoading ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-slate-400">Đang tính setup performance…</div>
      ) : perfQuery.error || !perfQuery.data ? (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 text-sm text-red-400">
          Lỗi setup-performance: {(perfQuery.error as Error)?.message ?? "không có dữ liệu"}
          <span className="block mt-2 text-xs text-slate-500 text-slate-500">
            Chưa có picks trong DB? Picks được lưu từ BT-01 (mỗi lần dashboard gọi top-recommendations) — cần dữ liệu tích lũy.
          </span>
        </div>
      ) : (
        <>
          {/* ── BT-03: run controls + lifecycle status ── */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-white">Chạy backtest</span>
              <select
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
              >
                {[7, 14, 30, 60].map((h) => (
                  <option key={h} value={h}>Horizon {h} ngày</option>
                ))}
              </select>
              <Button
                variant="secondary"
                loading={runMutation.isPending}
                onClick={() => runMutation.mutate({ dryRun: true })}
                title="Xem sẽ đánh giá bao nhiêu pick, không ghi gì"
              >
                <Search className="h-4 w-4 mr-2" />
                Dry run
              </Button>
              <Button
                loading={runMutation.isPending}
                onClick={() => runMutation.mutate({})}
                title="Chốt kết quả cho picks PENDING đã đóng cửa sổ horizon — mỗi pick chỉ chạy 1 lần"
              >
                <Play className="h-4 w-4 mr-2" />
                Chạy backtest
              </Button>
              <span className="text-xs text-slate-500 ml-auto">
                Picks đã có kết quả <span className="text-slate-300">không bao giờ chạy lại</span> — lần sau chỉ xử lý pick còn PENDING.
              </span>
            </div>

            {runResult && (
              <div className="mt-3 text-xs bg-slate-900/60 border border-slate-700 rounded p-3 text-slate-300">
                <span className="font-mono text-cyan-400">{runResult.runId}</span> · horizon {runResult.horizon}d ·{" "}
                <span className="text-green-400">{runResult.evaluated} chốt kết quả</span> ·{" "}
                <span className="text-yellow-400">{runResult.expired} hết hạn (no-hit)</span> ·{" "}
                <span className="text-slate-400">{runResult.skipped} bỏ qua (không setup)</span> ·{" "}
                <span className="text-cyan-300">{runResult.stillOpen} còn trong window (PENDING)</span>
                {runResult.errors > 0 && <span className="text-red-400"> · {runResult.errors} lỗi</span>}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {([
                ["PENDING", "chưa chạy / trong window", "bg-slate-700 text-slate-300"],
                ["EVALUATED", "đã có kết quả TP/SL", "bg-green-900/50 text-green-400"],
                ["EXPIRED", "hết horizon không chạm TP/SL", "bg-yellow-900/50 text-yellow-400"],
                ["SKIPPED", "không có setup", "bg-slate-800 text-slate-500"],
              ] as const).map(([st, label, cls]) => (
                <span key={st} className={`px-2 py-1 rounded ${cls}`}>
                  {st}: {perfQuery.data.statusCounts[st as keyof typeof perfQuery.data.statusCounts] ?? 0}
                  <span className="ml-1 opacity-70">— {label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* ── Stored per-pick results (reviewable) ── */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">
              Kết quả đã lưu ({perfQuery.data.evaluatedCount} picks đã chốt · {perfQuery.data.pendingCount} PENDING)
            </h4>
            {perfQuery.data.picks.length === 0 ? (
              <p className="text-xs text-slate-500">
                Chưa có pick nào được chốt kết quả — bấm “Chạy backtest” khi đã tích lũy đủ window.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-700">
                      <th className="py-2 pr-3">Ngày</th>
                      <th className="py-2 pr-3">Coin</th>
                      <th className="py-2 pr-3">Dir</th>
                      <th className="py-2 pr-3">Signal</th>
                      <th className="py-2 pr-3">Health</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Outcome</th>
                      <th className="py-2 pr-3">R</th>
                      <th className="py-2 pr-3">Ngày hit</th>
                      <th className="py-2 pr-3">MFE/MAE %</th>
                      <th className="py-2 pr-3">Fill</th>
                      <th className="py-2 pr-3">Lặp</th>
                      <th className="py-2">Horizon</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfQuery.data.picks.map((p) => (
                      <tr key={p.pickId} className="border-b border-slate-800 last:border-0">
                        <td className="py-2 pr-3 font-mono text-slate-400">{p.dataDate}</td>
                        <td className="py-2 pr-3 font-medium text-slate-200">{p.symbol}</td>
                        <td className={`py-2 pr-3 ${p.direction === "BULLISH" ? "text-green-400" : "text-red-400"}`}>{p.direction === "BULLISH" ? "LONG" : "SHORT"}</td>
                        <td className="py-2 pr-3 text-slate-400">{p.signal}</td>
                        <td className="py-2 pr-3 text-slate-300">{p.healthScore?.toFixed(0) ?? "—"}</td>
                        <td className="py-2 pr-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                            p.status === "EVALUATED" ? "bg-green-900/50 text-green-400"
                            : p.status === "EXPIRED" ? "bg-yellow-900/50 text-yellow-400"
                            : p.status === "SKIPPED" ? "bg-slate-800 text-slate-500"
                            : "bg-slate-700 text-slate-300"
                          }`}>{p.status}</span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {p.outcome === "TP1_WIN" ? <span className="text-green-400">TP1_WIN</span>
                            : p.outcome === "TP2_WIN" ? <span className="text-cyan-400">TP2_WIN</span>
                            : p.outcome === "SL_LOSS" ? <span className="text-red-400">SL_LOSS</span>
                            : p.outcome === "NO_HIT" ? <span className="text-yellow-400">NO_HIT</span>
                            : p.outcome === "NO_SETUP" ? <span className="text-slate-500">NO_SETUP</span>
                            : "—"}
                        </td>
                        <td className={`py-2 pr-3 ${p.exitR == null ? "text-slate-500" : p.exitR >= 0 ? "text-green-400" : "text-red-400"}`}>{p.exitR ?? "—"}</td>
                        <td className="py-2 pr-3 text-slate-400">{p.hitDay ?? "—"}</td>
                        <td className="py-2 pr-3 text-xs text-slate-400">{fmt(p.mfePct)} / {fmt(p.maePct)}</td>
                        <td className="py-2 pr-3 text-xs">{p.entryFilled == null ? "—" : p.entryFilled ? <span className="text-green-400">yes</span> : <span className="text-slate-500">no</span>}</td>
                        <td className="py-2 pr-3 text-slate-400">{p.repeatCount > 1 ? <span className="text-cyan-400" title="Số lần setup lặp lại liên tiếp — refresh gần nhau không tạo pick mới">×{p.repeatCount}</span> : "×1"}</td>
                        <td className="py-2 text-slate-500">{p.horizonDays ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {statsTable("Theo direction", perfQuery.data.byDirection)}
          {statsTable("Theo signal", perfQuery.data.bySignal)}
          {statsTable("Theo health band", perfQuery.data.byHealthBand)}
          {statsTable("Genuine vs fill (tham khảo)", perfQuery.data.byPickKind)}
          <p className="text-xs text-slate-500">
            Quy tắc bảo thủ: một ngày giá chạm cả TP và SL → tính THUA (SL). Win rate = (TP1+TP2) / (TP1+TP2+SL) — NO_HIT không tính thua. Kết quả chốt 1 lần và lưu DB, xem lại bất cứ lúc nào.
          </p>
        </>
      )}
    </div>
  );
}

export default BacktestSection;
