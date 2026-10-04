// BT-06 — Settlement core, shared by:
//   * POST /api/admin/backtest/run      (manual, admin session, UI tab Backtest)
//   * GET  /api/admin/backtest/run      (status: ready-to-settle counts, BT-06)
//   * auto-settle hook ở cuối POST /api/refresh (scheduler hằng ngày, BT-06)
//
// Logic evaluator chuyển từ run route (BT-03) giữ nguyên semantics:
//   - CHỈ pick PENDING được đụng tới; EVALUATED/EXPIRED/SKIPPED bất biến.
//   - pick không setup dùng được → SKIPPED ngay; đã đóng window (dataDate +
//     horizon ≤ hôm nay) → tính 1 lần rồi chốt; còn trong window → giữ PENDING.
//   - dryRun: đếm những gì SẼ xảy ra, không ghi gì.

import { db } from "@/db";
import { topRecommendationPicks, marketPriceDaily } from "@/db/schema";
import { eq, inArray, desc, isNotNull } from "drizzle-orm";
import {
  computePickOutcome,
  isHorizonClosed,
  windowCoverage,
  type BacktestPickInput,
  type BacktestPriceRow,
} from "./engine";
import { getBusinessDate } from "@/lib/utils";

export const BACKTEST_HORIZONS = [7, 14, 30, 60] as const;
export const DEFAULT_HORIZON = 14;

/**
 * BT-07 — % nến tối thiểu trong window để một pick ĐÓNG được phép chốt.
 * Mặc định 100 (đủ từng ngày trong (dataDate, dataDate+horizon]); env
 * BT_MIN_CANDLE_COVERAGE cho phép nới lỏng (1–100). Coverage thấp hơn →
 * pick KHÔNG được chốt (kết quả bất biến — chốt trên dữ liệu thiếu là ghi
 * sai vĩnh viễn), đếm riêng qua `noData`/`noDataByHorizon`.
 */
export function minCandleCoveragePct(): number {
  const raw = process.env.BT_MIN_CANDLE_COVERAGE;
  const pct = raw == null || raw.trim() === "" ? 100 : Number(raw);
  return Number.isFinite(pct) ? Math.min(100, Math.max(1, pct)) : 100;
}

export interface SettlementOptions {
  horizon?: number;
  dryRun?: boolean;
}

export interface SettlementOutcome {
  pickId: number;
  symbol: string;
  dataDate: string;
  outcome: string;
  exitR: number | null;
  hitDay: number | null;
}

/** Kết quả chạy thật — shape giữ nguyên để scheduler log (nếu có) không đổi. */
export interface SettlementRunResult {
  runId: string;
  horizon: number;
  dryRun: false;
  pendingBefore: number;
  evaluated: number;
  expired: number;
  skipped: number;
  stillOpen: number;
  /** BT-07: ĐÓNG window nhưng thiếu nến (coverage < ngưỡng) → giữ PENDING, không chốt. */
  noData: number;
  errors: number;
  outcomes: SettlementOutcome[];
}

/** Kết quả dry-run — báo trước số lượng, không ghi DB. */
export interface SettlementDryResult {
  runId: string;
  horizon: number;
  dryRun: true;
  pendingBefore: number;
  willSkip: number;
  willEvaluate: number;
  /** Đã đóng window nhưng sẽ KHÔNG chốt vì thiếu nến. */
  willNoData: number;
  stillOpen: number;
  note: string;
}

export type SettlementResult = SettlementRunResult | SettlementDryResult;

export interface BacktestStatus {
  /** Tổng pick còn PENDING (cả sắp chốt lẫn chờ window + chưa có setup). */
  pending: number;
  /** PENDING có setup + levels và đã đóng cửa sổ, theo từng horizon. */
  readyByHorizon: Record<number, number>;
  /** PENDING có setup + levels nhưng còn trong window, theo từng horizon. */
  stillOpenByHorizon: Record<number, number>;
  /**
   * BT-07: ĐÓNG window nhưng thiếu nến (coverage < BT_MIN_CANDLE_COVERAGE)
   * theo từng horizon — KHÔNG tính vào ready, không auto-settle, chờ backfill.
   */
  noDataByHorizon: Record<number, number>;
  /** PENDING không setup/levels → sẽ bị SKIPPED ở lần chạy kế. */
  skippable: number;
  /** evaluated_at mới nhất giữa mọi pick đã chốt (ISO string) hoặc null. */
  lastEvaluatedAt: string | null;
}

function normalizeHorizon(h: number | undefined): number {
  return BACKTEST_HORIZONS.includes(h as (typeof BACKTEST_HORIZONS)[number])
    ? (h as (typeof BACKTEST_HORIZONS)[number])
    : DEFAULT_HORIZON;
}

const hasLevels = (p: {
  hasSetup: number | boolean | null;
  entryMid: unknown;
  tp1: unknown;
  stopLoss: unknown;
}): boolean =>
  !!p.hasSetup &&
  p.entryMid != null && p.tp1 != null && p.stopLoss != null &&
  Number(p.entryMid) > 0 && Number(p.tp1) > 0 && Number(p.stopLoss) > 0;

/**
 * Chốt kết quả cho các pick PENDING đã đóng cửa sổ horizon.
 * Không bao giờ throw lỗi evaluator ra ngoài từng pick — lỗi lũy vào `errors`.
 */
export async function runBacktestSettlement(
  options: SettlementOptions = {}
): Promise<SettlementResult> {
  const horizon = normalizeHorizon(options.horizon);
  const dryRun = options.dryRun === true;
  const today = getBusinessDate();
  const runId = `bt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  // ── 1. PENDING picks only — evaluated/expired/skipped are immutable ──
  const pendingRows = await db
    .select({
      pickId: topRecommendationPicks.id,
      dataDate: topRecommendationPicks.dataDate,
      coinId: topRecommendationPicks.coinId,
      symbol: topRecommendationPicks.symbol,
      direction: topRecommendationPicks.direction,
      signal: topRecommendationPicks.signal,
      healthScore: topRecommendationPicks.healthScore,
      pickKind: topRecommendationPicks.pickKind,
      hasSetup: topRecommendationPicks.hasSetup,
      entryLow: topRecommendationPicks.entryLow,
      entryHigh: topRecommendationPicks.entryHigh,
      entryMid: topRecommendationPicks.entryMid,
      tp1: topRecommendationPicks.tp1,
      tp2: topRecommendationPicks.tp2,
      stopLoss: topRecommendationPicks.stopLoss,
    })
    .from(topRecommendationPicks)
    .where(eq(topRecommendationPicks.backtestStatus, "PENDING"))
    .limit(5000);

  // Population split: no-setup picks are SKIPPed immediately; the rest are
  // candidates for evaluation.
  const skippable = pendingRows.filter((p) => !hasLevels(p));
  const candidates = pendingRows.filter((p) => hasLevels(p));

  // Window closed = dataDate + horizon calendar days <= today.
  const closed = candidates.filter((p) => isHorizonClosed(p.dataDate, horizon, today));
  const stillOpen = candidates.length - closed.length;

  // ── 2. Load candles only for the coins being evaluated now ──
  // (Cần cả trong dry-run để đếm noData — BT-07.)
  const coinIds = [...new Set(closed.map((p) => p.coinId))];
  const priceByCoin = new Map<number, BacktestPriceRow[]>();
  if (coinIds.length > 0) {
    const minDate = closed.reduce(
      (m, p) => (p.dataDate < m ? p.dataDate : m),
      closed[0].dataDate
    );
    const priceRows = await db
      .select({
        coinId: marketPriceDaily.coinId,
        date: marketPriceDaily.date,
        high: marketPriceDaily.high,
        low: marketPriceDaily.low,
      })
      .from(marketPriceDaily)
      .where(inArray(marketPriceDaily.coinId, coinIds))
      .limit(200000);
    for (const r of priceRows) {
      if (r.date < minDate) continue;
      const list = priceByCoin.get(r.coinId) ?? [];
      list.push({ date: r.date, high: Number(r.high), low: Number(r.low) });
      priceByCoin.set(r.coinId, list);
    }
    for (const list of priceByCoin.values()) {
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }
  }

  // ── 2b. BT-07: phân loại theo coverage nến — pick ĐÓNG window nhưng thiếu
  // nến (data-gap) KHÔNG được chốt: giữ nguyên PENDING, đếm riêng qua noData
  // để UI báo "N thiếu nến" thay vì auto-settle quay vô ích.
  const minCovPct = minCandleCoveragePct();
  const evaluable: typeof closed = [];
  const noDataRows: typeof closed = [];
  for (const p of closed) {
    const covPct =
      windowCoverage(priceByCoin.get(p.coinId) ?? [], p.dataDate, horizon) * 100;
    if (covPct >= minCovPct) evaluable.push(p);
    else noDataRows.push(p);
  }

  if (dryRun) {
    return {
      runId,
      horizon,
      dryRun: true,
      pendingBefore: pendingRows.length,
      willSkip: skippable.length,
      willEvaluate: evaluable.length,
      willNoData: noDataRows.length,
      stillOpen,
      note:
        "Dry run — không ghi gì. Picks đã EVALUATED/EXPIRED/SKIPPED không bao giờ chạy lại." +
        (noDataRows.length > 0
          ? ` ${noDataRows.length} pick thiếu nến trong window → giữ PENDING (chờ backfill).`
          : ""),
    };
  }

  // ── 3. Evaluate + persist (update each pick once) ──
  let evaluated = 0;
  let expired = 0;
  let skipped = 0;
  let errors = 0;
  const outcomes: SettlementOutcome[] = [];

  const stamp = {
    horizonDays: horizon,
    runId,
    evaluatedAt: new Date(),
  };

  // SKIPPED — no usable setup, mark once, never touched again.
  for (const p of skippable) {
    try {
      await db
        .update(topRecommendationPicks)
        .set({
          backtestStatus: "SKIPPED",
          backtestOutcome: "NO_SETUP",
          ...stamp,
        })
        .where(eq(topRecommendationPicks.id, p.pickId));
      skipped++;
    } catch (e) {
      errors++;
      console.error(`[BT-03] skip ${p.pickId} failed:`, e);
    }
  }

  // EVALUATED / EXPIRED — outcome stored on the pick row itself.
  // (Chỉ `evaluable` — noDataRows ở lại PENDING, không đụng tới.)
  for (const p of evaluable) {
    const input: BacktestPickInput = {
      pickId: p.pickId,
      dataDate: p.dataDate,
      coinId: p.coinId,
      symbol: p.symbol,
      direction: p.direction,
      signal: p.signal,
      healthScore: p.healthScore,
      entryLow: p.entryLow != null ? Number(p.entryLow) : null,
      entryHigh: p.entryHigh != null ? Number(p.entryHigh) : null,
      entryMid: p.entryMid != null ? Number(p.entryMid) : null,
      tp1: p.tp1 != null ? Number(p.tp1) : null,
      tp2: p.tp2 != null ? Number(p.tp2) : null,
      stopLoss: p.stopLoss != null ? Number(p.stopLoss) : null,
      riskRewardRatio: null,
      pickKind: p.pickKind,
    };
    try {
      const o = computePickOutcome(input, priceByCoin.get(p.coinId) ?? [], horizon, {
        horizonClosed: true,
      });

      if (o.outcome === "OPEN" || o.outcome === "INVALID") {
        // Defensive: should not happen for closed windows — leave PENDING.
        continue;
      }

      await db
        .update(topRecommendationPicks)
        .set({
          backtestStatus: o.outcome === "NO_HIT" ? "EXPIRED" : "EVALUATED",
          backtestOutcome: o.outcome,
          backtestExitR: o.exitR,
          backtestHitDay: o.hitDay,
          backtestMfePct: o.mfePct,
          backtestMaePct: o.maePct,
          backtestEntryFilled: o.entryFilled,
          ...stamp,
        })
        .where(eq(topRecommendationPicks.id, p.pickId));

      if (o.outcome === "NO_HIT") {
        expired++;
      } else {
        evaluated++;
      }
      outcomes.push({
        pickId: p.pickId,
        symbol: p.symbol,
        dataDate: p.dataDate,
        outcome: o.outcome,
        exitR: o.exitR,
        hitDay: o.hitDay,
      });
    } catch (e) {
      errors++;
      console.error(`[BT-03] evaluate ${p.pickId} failed:`, e);
    }
  }

  if (noDataRows.length > 0) {
    console.log(
      `[BT-07] ${noDataRows.length} pick đóng window nhưng thiếu nến (coverage < ${minCovPct}%) — giữ PENDING: ${noDataRows
        .map((p) => `${p.symbol}@${p.dataDate}`)
        .join(", ")}`
    );
  }

  return {
    runId,
    horizon,
    dryRun: false,
    pendingBefore: pendingRows.length,
    evaluated,
    expired,
    skipped,
    stillOpen,
    noData: noDataRows.length,
    errors,
    outcomes,
  };
}

/**
 * Trạng thái cho UI (BT-06): bao nhiêu pick SẴN SÀNG chốt theo từng horizon,
 * bao nhiêu còn chờ window, và lần chốt cuối cùng — để tab Backtest hiện chip
 * "N pick sẵn sàng chốt" + auto-settle trước khi bấm nút.
 */
export async function getBacktestStatus(): Promise<BacktestStatus> {
  const today = getBusinessDate();

  const pendingRows = await db
    .select({
      dataDate: topRecommendationPicks.dataDate,
      coinId: topRecommendationPicks.coinId,
      hasSetup: topRecommendationPicks.hasSetup,
      entryMid: topRecommendationPicks.entryMid,
      tp1: topRecommendationPicks.tp1,
      stopLoss: topRecommendationPicks.stopLoss,
    })
    .from(topRecommendationPicks)
    .where(eq(topRecommendationPicks.backtestStatus, "PENDING"))
    .limit(5000);

  const candidates = pendingRows.filter((p) => hasLevels(p));

  // BT-07: nến của các candidate (chỉ cần date) để tính coverage theo từng
  // horizon — pick thiếu nến KHÔNG tính là "sẵn sàng chốt" nữa.
  const coinIds = [...new Set(candidates.map((p) => p.coinId))];
  const datesByCoin = new Map<number, { date: string }[]>();
  if (coinIds.length > 0) {
    const minDataDate = candidates.reduce(
      (m, p) => (p.dataDate < m ? p.dataDate : m),
      candidates[0].dataDate
    );
    const candleRows = await db
      .select({ coinId: marketPriceDaily.coinId, date: marketPriceDaily.date })
      .from(marketPriceDaily)
      .where(inArray(marketPriceDaily.coinId, coinIds))
      .limit(200000);
    for (const r of candleRows) {
      if (r.date < minDataDate) continue;
      const list = datesByCoin.get(r.coinId) ?? [];
      list.push({ date: r.date });
      datesByCoin.set(r.coinId, list);
    }
  }

  const minCovPct = minCandleCoveragePct();
  const readyByHorizon: Record<number, number> = {};
  const stillOpenByHorizon: Record<number, number> = {};
  const noDataByHorizon: Record<number, number> = {};
  for (const h of BACKTEST_HORIZONS) {
    const closedHere = candidates.filter((p) => isHorizonClosed(p.dataDate, h, today));
    let ready = 0;
    let noData = 0;
    for (const p of closedHere) {
      const covPct =
        windowCoverage(datesByCoin.get(p.coinId) ?? [], p.dataDate, h) * 100;
      if (covPct >= minCovPct) ready++;
      else noData++;
    }
    readyByHorizon[h] = ready;
    noDataByHorizon[h] = noData;
    stillOpenByHorizon[h] = candidates.length - closedHere.length;
  }

  // Chốt cuối = evaluated_at mới nhất (EVALUATED lẫn EXPIRED đều có stamp).
  const [lastRow] = await db
    .select({ at: topRecommendationPicks.backtestEvaluatedAt })
    .from(topRecommendationPicks)
    .where(isNotNull(topRecommendationPicks.backtestEvaluatedAt))
    .orderBy(desc(topRecommendationPicks.backtestEvaluatedAt))
    .limit(1);

  return {
    pending: pendingRows.length,
    readyByHorizon,
    stillOpenByHorizon,
    noDataByHorizon,
    skippable: pendingRows.length - candidates.length,
    lastEvaluatedAt:
      lastRow?.at instanceof Date
        ? lastRow.at.toISOString()
        : typeof lastRow?.at === "string"
        ? lastRow.at
        : null,
  };
}
