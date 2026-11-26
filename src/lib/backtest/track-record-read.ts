// TRACK-01 — Đọc + dựng payload track record công khai (server-only).
//
// Tách khỏi route để cả trang (/api/track-record) và bản tải về
// (/api/track-record/export) đọc CÙNG một nguồn: nếu CSV/JSON lệch số với
// trang thì tính minh bạch coi như mất. Không recompute outcome — chỉ đọc kết
// quả đã chốt một lần rồi aggregate.

import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  backtestHorizonResults,
  coinMetrics,
  coins,
  marketPriceDaily,
  topRecommendationPicks,
} from "@/db/schema";
import { nonCryptoCoinExistsSql } from "@/lib/market/universe";
import { getBusinessDate } from "@/lib/utils";
import { addDaysIso } from "./engine";
import { equalWeightBasket, type BasketBenchmark } from "./benchmark";
import { computeCostR, computeNetR, readFeeConfig, type FeeConfig } from "./metrics";
import {
  computeRealisticCost,
  summarizeRealistic,
  type RealisticScenarioStat,
} from "./realistic-costs";
import {
  buildTrackRecord,
  originNeverLiveSignal,
  parseLiveSince,
  pickProvenance,
  summarizeHorizons,
  trackRecordFreshness,
  DEFAULT_FRESHNESS_HORIZON_DAYS,
  FORWARD_PICK_LAG_DAYS,
  MIN_EPISODES_FOR_VERDICT,
  MIN_TRADES_FOR_VERDICT,
  TRACK_RECORD_CHANGELOG,
  TRACK_RECORD_METRICS_VERSION,
  type TrackRecordFreshness,
  type TrackRecordHorizonStat,
  type TrackRecordOriginSignal,
  type TrackRecordPickRow,
  type TrackRecordProvenance,
  type TrackRecordSummary,
} from "./track-record";

/**
 * WINDOW-02 (rút gọn) — MỘT query, trần 20 000 dòng mới nhất.
 *
 * Bản trước đọc forward bằng query thứ hai (trần riêng, gộp theo id) để không
 * bị trần 4 000 của lịch sử cắt. Hai query + merge là quá nhiều máy móc cho
 * một con số, nên giờ chỉ còn một cửa sổ rộng hơn: nếu lịch sử vượt trần thì
 * payload nói rõ (`window.capped`), và đánh đổi có ý thức là pick forward cũ
 * nhất có thể rơi khỏi cửa sổ.
 */
const MAX_ROWS = 20000;
const RECENT_LIMIT = 25;

/** Ngưỡng cỡ mẫu có thể chỉnh qua env (1..100000); sai/thiếu → mặc định. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 1
    ? Math.min(100000, Math.floor(value))
    : fallback;
}

/** BTC buy & hold — cột tham chiếu riêng, không còn là benchmark duy nhất. */
export interface BtcBenchmark {
  method: "buy_hold";
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
  entryFilled: boolean | null;
}

export interface TrackRecordMeta {
  /** Ngày dữ liệu mới nhất mà số liệu bao phủ (YYYY-MM-DD). */
  dataAsOf: string | null;
  /** Thời điểm API dựng payload (ISO). */
  generatedAt: string;
  metricsVersion: string;
  /** Commit đang chạy (12 ký tự) nếu môi trường cung cấp, ngược lại null. */
  commit: string | null;
  changelog: readonly { version: string; note: string }[];
  /** WINDOW-01/02: cửa sổ đọc duy nhất (lịch sử + forward dùng chung). */
  window: {
    capped: boolean;
    rowsRead: number;
    limit: number;
    oldestIncluded: string | null;
  };
}

/**
 * FORWARD-01 — bằng chứng forward tách khỏi lịch sử nạp lại.
 *
 * Trước đây một lần backfill quá khứ trộn thẳng vào track record công khai:
 * pick cũ được ghi hôm nay trông y hệt pick hệ thống đã tạo đúng ngày, nên
 * "win rate từng báo trước" có thể đến từ dữ liệu được nhìn thấy sau khi giá
 * đã chạy. `summary` bên dưới chỉ tính pick có `picked_at` trùng ngày dữ liệu
 * (lag ≤ FORWARD_PICK_LAG_DAYS), nên con số forward không thể được cứu bởi
 * backfill; toàn bộ lịch sử vẫn hiện riêng để tham chiếu.
 */
export interface TrackRecordForwardSplit {
  /** Mốc bắt đầu bằng chứng forward: env LIVE_SINCE nếu có, không thì suy ra. */
  liveSince: string | null;
  /**
   * `env` = LIVE_SINCE hợp lệ đang được dùng; `invalid-env` = env có nhưng sai
   * định dạng nên đã bị bỏ qua (để lộ lỗi cấu hình thay vì im lặng); `derived`
   * = suy từ pick forward sớm nhất; null = chưa có mốc nào.
   */
  liveSinceSource: "env" | "derived" | "invalid-env" | null;
  /** Số pick được ghi đúng ngày dữ liệu (nguồn forward). */
  forwardPicks: number;
  /** Số pick bị ghi trễ hơn ngày dữ liệu — lịch sử nạp lại. */
  backfilledPicks: number;
  /** Số pick thiếu picked_at nên không thể chứng minh là forward. */
  unknownPicks: number;
  /** picked_at được phép trễ hơn data_date bao nhiêu ngày mà vẫn coi là live. */
  lagGraceDays: number;
  /**
   * ORIGIN-02 — null = không có dấu hiệu bất thường; khác null = mọi pick đã
   * chốt đều mang origin backfill trong ngưỡng lag, dấu hiệu pipeline luôn
   * chậm một ngày nên forward record sẽ rỗng mãi. Chỉ mô tả, không đổi nhãn.
   */
  originSignal: TrackRecordOriginSignal | null;
  /** Summary CHỈ trên pick forward; null khi chưa có pick forward nào. */
  summary: TrackRecordSummary | null;
  /** Benchmark cùng cửa sổ các lệnh forward (không dùng cửa sổ lịch sử). */
  benchmark: BasketBenchmark | null;
  btc: BtcBenchmark | null;
}

/**
 * W1: trạng thái chờ chốt của pick CÔNG KHAI. Trước đây "chưa có stamp" bị báo
 * là settlement chết, dù thực tế mọi pick vẫn đang trong cửa sổ horizon.
 */
export interface TrackRecordSettlement {
  /** Số pick công khai còn PENDING (chưa đáo hạn horizon). */
  pendingPicks: number;
  /** Ngày pick chờ cũ nhất đáo hạn horizon (YYYY-MM-DD), null khi không còn pick chờ. */
  nextSettlementAt: string | null;
}

export interface TrackRecordPayload {
  params: { feeBps: number; slippageBps: number; roundTripBps: number; horizonDays: number };
  /** Toàn bộ lịch sử đã chốt (gồm cả pick backfill). */
  summary: TrackRecordSummary;
  /** FORWARD-01: phần forward kể từ mốc live, tách khỏi backfill. */
  split: TrackRecordForwardSplit;
  freshness: TrackRecordFreshness & { today: string };
  /** Benchmark chính: basket equal-weight các coin trong universe. */
  benchmark: BasketBenchmark | null;
  /** BTC buy & hold cùng cửa sổ — cột so sánh riêng. */
  btc: BtcBenchmark | null;
  recent: RecentItem[];
  /** W1: pick công khai còn chờ chốt + ngày đáo hạn kế tiếp. */
  settlement: TrackRecordSettlement;
  /** BT-10: so sánh win rate / avg gross R theo từng horizon đã chốt. */
  horizons: TrackRecordHorizonStat[];
  /** BT-11: NET R dưới kịch bản chi phí thực tế (ATR slippage, funding, partial TP1). */
  realistic: RealisticScenarioStat | null;
  meta: TrackRecordMeta;
}

interface FundingRow {
  coinId: unknown;
  date: unknown;
  rate: unknown;
}

/**
 * Funding rate theo ngày cho các coin liên quan (coin_metrics). Nhiều nguồn
 * cùng ngày → lấy trung bình. Lỗi/không có dữ liệu → map rỗng (funding bị bỏ
 * qua, kịch bản vẫn tính phí + slippage).
 */
async function readFundingRates(
  coinIds: number[],
  from: string,
  to: string
): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  if (coinIds.length === 0) return out;
  try {
    const rows: FundingRow[] = await db
      .select({
        coinId: coinMetrics.coinId,
        date: coinMetrics.date,
        rate: coinMetrics.fundingRate,
      })
      .from(coinMetrics)
      .where(
        and(
          inArray(coinMetrics.coinId, coinIds),
          gte(coinMetrics.date, from),
          lte(coinMetrics.date, to)
        )
      )
      .limit(200000);

    const agg = new Map<string, { coinId: number; date: string; sum: number; n: number }>();
    for (const row of rows) {
      if (row.rate == null) continue;
      const rate = Number(row.rate);
      if (!Number.isFinite(rate)) continue;
      const coinId = Number(row.coinId);
      const date = String(row.date);
      const key = `${coinId}|${date}`;
      const cur = agg.get(key) ?? { coinId, date, sum: 0, n: 0 };
      cur.sum += rate;
      cur.n += 1;
      agg.set(key, cur);
    }
    for (const { coinId, date, sum, n } of agg.values()) {
      const series = out.get(coinId) ?? new Map<string, number>();
      series.set(date, sum / n);
      out.set(coinId, series);
    }
  } catch (error) {
    console.warn(
      "[BT-11] không đọc được funding (coin_metrics) — kịch bản thực tế chỉ tính phí + slippage:",
      error instanceof Error ? error.message : String(error)
    );
  }
  return out;
}

/**
 * Kịch bản chi phí thực tế trên đúng các trade của track record. Funding chỉ
 * được cộng khi coin_metrics có dữ liệu cho những ngày giữ lệnh — nếu không,
 * trade vẫn được định giá với phí + slippage ATR và số `fundingCovered` nói
 * rõ bao nhiêu trade có funding.
 */
async function buildRealisticScenario(
  rows: readonly {
    dataDate: string;
    coinId: number;
    direction: string;
    entryMid: string | null;
    stopLoss: string | null;
    tp1: string | null;
    atr14: string | null;
    backtestExitR: number | null;
    backtestHitDay: number | null;
    backtestHorizonDays: number | null;
  }[],
  picks: readonly TrackRecordPickRow[],
  fee: FeeConfig
): Promise<RealisticScenarioStat | null> {
  const evaluated = rows
    .map((row, index) => ({ row, pick: picks[index] }))
    .filter(
      ({ pick }) =>
        pick.outcome === "TP1_WIN" || pick.outcome === "TP2_WIN" || pick.outcome === "SL_LOSS"
    );
  if (evaluated.length === 0) return null;

  const from = evaluated.reduce(
    (min, { row }) => (row.dataDate < min ? row.dataDate : min),
    evaluated[0].row.dataDate
  );
  const to = evaluated.reduce((max, { row }) => {
    const end = addDaysIso(row.dataDate, row.backtestHitDay ?? row.backtestHorizonDays ?? 0);
    return end > max ? end : max;
  }, from);

  const funding = await readFundingRates(
    [...new Set(evaluated.map(({ row }) => row.coinId))],
    from,
    to
  );

  const netRs: number[] = [];
  const baseNetRs: number[] = [];
  let fundingCovered = 0;

  for (const { row, pick } of evaluated) {
    const holdingDays = row.backtestHitDay ?? row.backtestHorizonDays ?? 0;
    let fundingRateSum: number | null = null;
    const series = funding.get(row.coinId);
    if (series && holdingDays > 0) {
      let sum = 0;
      let seen = 0;
      for (let day = 1; day <= holdingDays; day += 1) {
        const rate = series.get(addDaysIso(row.dataDate, day));
        if (rate != null) {
          sum += rate;
          seen += 1;
        }
      }
      if (seen > 0) fundingRateSum = sum;
    }

    const breakdown = computeRealisticCost({
      direction: row.direction,
      entryMid: row.entryMid,
      stopLoss: row.stopLoss,
      tp1: row.tp1,
      atr14: row.atr14,
      outcome: pick.outcome,
      exitRGross: row.backtestExitR,
      fundingRateSum,
      feeBps: fee.feeBps,
      slippageBps: fee.slippageBps,
    });
    if (breakdown.netR == null) continue;

    netRs.push(breakdown.netR);
    baseNetRs.push(pick.exitRNet ?? 0);
    if (fundingRateSum != null) fundingCovered += 1;
  }

  if (netRs.length === 0) return null;
  return summarizeRealistic(netRs, baseNetRs, fundingCovered);
}

/** Pick đã chốt kèm nhãn provenance mà trang dùng — export chỉ việc in ra. */
export type TrackRecordExportPick = TrackRecordPickRow & { provenance: TrackRecordProvenance };

export interface TrackRecordRead {
  payload: TrackRecordPayload;
  /** Mọi pick đã chốt (đã lọc universe) — dùng cho export. */
  picks: TrackRecordExportPick[];
}

/**
 * Bảng horizon append-only (BT-10). Bảng có thể chưa tồn tại trên deployment
 * chưa chạy migration 0038 — khi đó trả [] thay vì làm sập track record.
 */
async function readHorizonStats(): Promise<TrackRecordHorizonStat[]> {
  try {
    const rows = await db
      .select({
        horizonDays: backtestHorizonResults.horizonDays,
        outcome: backtestHorizonResults.outcome,
        exitRGross: backtestHorizonResults.exitR,
      })
      .from(backtestHorizonResults)
      .innerJoin(
        topRecommendationPicks,
        eq(topRecommendationPicks.id, backtestHorizonResults.pickId)
      )
      .innerJoin(coins, eq(coins.id, topRecommendationPicks.coinId))
      .where(
        and(
          eq(topRecommendationPicks.pickKind, "GENUINE"),
          eq(topRecommendationPicks.hasSetup, true),
          sql`NOT (${nonCryptoCoinExistsSql(coins.id)})`
        )
      )
      .limit(20000);
    return summarizeHorizons(rows);
  } catch (error) {
    console.warn(
      "[BT-10] chưa đọc được backtest_horizon_results (đã chạy migration 0038?):",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/** Commit hash từ env phổ biến (Vercel/CI/self-host), null khi không có. */
export function releaseCommit(): string | null {
  const raw =
    process.env.GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.NEXT_PUBLIC_COMMIT_SHA ??
    process.env.SOURCE_COMMIT;
  const value = raw?.trim();
  return value && /^[0-9a-f]{7,40}$/i.test(value) ? value.slice(0, 12) : null;
}

/**
 * Basket equal-weight của universe crypto trong đúng cửa sổ các lệnh đã chốt.
 * Lọc stock (tokenized equity) bằng cùng điều kiện với track record để basket
 * không lẫn NVDA/AMZN vào. Lỗi DB → null, không làm sập trang.
 */
async function readBasketBenchmark(
  from: string,
  to: string
): Promise<BasketBenchmark | null> {
  try {
    const rows = await db
      .select({
        coinId: marketPriceDaily.coinId,
        symbol: coins.symbol,
        date: marketPriceDaily.date,
        close: marketPriceDaily.close,
      })
      .from(marketPriceDaily)
      .innerJoin(coins, eq(coins.id, marketPriceDaily.coinId))
      .where(
        and(
          gte(marketPriceDaily.date, from),
          lte(marketPriceDaily.date, to),
          sql`NOT (${nonCryptoCoinExistsSql(coins.id)})`
        )
      )
      .orderBy(asc(marketPriceDaily.date))
      .limit(200000);

    return equalWeightBasket(
      rows.map((r) => ({
        coinId: r.coinId,
        symbol: r.symbol,
        date: r.date,
        close: Number(r.close),
      })),
      from,
      to
    );
  } catch (error) {
    console.error("[TRACK-01] basket benchmark failed (non-blocking):", error);
    return null;
  }
}

/** BTC buy-and-hold over the window the settled trades spanned. */
async function btcBenchmark(from: string, to: string): Promise<BtcBenchmark | null> {
  try {
    const [btc] = await db
      .select({ id: coins.id })
      .from(coins)
      .where(eq(coins.symbol, "BTC"))
      .limit(1);
    if (!btc) return null;

    const closes = await db
      .select({ date: marketPriceDaily.date, close: marketPriceDaily.close })
      .from(marketPriceDaily)
      .where(
        and(
          eq(marketPriceDaily.coinId, btc.id),
          gte(marketPriceDaily.date, from),
          lte(marketPriceDaily.date, to)
        )
      )
      .orderBy(asc(marketPriceDaily.date))
      .limit(500);

    if (closes.length < 2) return null;
    const start = Number(closes[0].close);
    const end = Number(closes[closes.length - 1].close);
    if (!(start > 0) || !(end > 0)) return null;
    return {
      method: "buy_hold",
      from: closes[0].date,
      to: closes[closes.length - 1].date,
      startClose: +start.toFixed(2),
      endClose: +end.toFixed(2),
      returnPct: +(((end - start) / start) * 100).toFixed(2),
    };
  } catch (error) {
    console.error("[TRACK-01] BTC benchmark failed (non-blocking):", error);
    return null;
  }
}

interface BenchmarkInputRow {
  dataDate: string;
  backtestStatus: string;
  backtestHorizonDays: number | null;
}

/**
 * Basket + BTC benchmark cho một tập lệnh: cửa sổ = pick sớm nhất → lần đóng
 * horizon muộn nhất, chặn ở hôm nay (basket cần nến tới cuối cửa sổ, cửa sổ
 * vượt hôm nay sẽ loại sạch coin). Cùng cửa sổ với tập lệnh được truyền vào,
 * nên phần forward không so với benchmark của cả lịch sử.
 */
async function benchmarksFor<T extends BenchmarkInputRow>(
  rows: readonly T[],
  today: string
): Promise<{ basket: BasketBenchmark | null; btc: BtcBenchmark | null }> {
  const traded = rows.filter((r) => r.backtestStatus !== "SKIPPED");
  if (traded.length === 0) return { basket: null, btc: null };
  const from = traded.reduce((m, r) => (r.dataDate < m ? r.dataDate : m), traded[0].dataDate);
  const horizonEnd = traded.reduce((m, r) => {
    const end = addDaysIso(r.dataDate, r.backtestHorizonDays ?? 0);
    return end > m ? end : m;
  }, "0000-01-01");
  const to = horizonEnd > today ? today : horizonEnd;
  if (!(from < to)) return { basket: null, btc: null };
  const [basket, btc] = await Promise.all([readBasketBenchmark(from, to), btcBenchmark(from, to)]);
  return { basket, btc };
}

/** Chỉ hai giá trị đã biết mới có nghĩa; giá trị lạ → null → dùng heuristic. */
function originOf(value: string | null): "live" | "backfill" | null {
  return value === "live" || value === "backfill" ? value : null;
}

interface PickSourceRow {
  dataDate: string;
  pickedAt: Date | null;
  pickedOrigin: string | null;
  symbol: string;
  direction: string;
  entryMid: string | null;
  stopLoss: string | null;
  backtestStatus: string;
  backtestOutcome: string | null;
  backtestExitR: number | null;
  backtestEntryFilled: boolean | null;
  backtestEvaluatedAt: Date | null;
}

/** Hàng DB → pick của track record (net R tính tại thời điểm đọc). */
function pickRow(r: PickSourceRow, fee: FeeConfig): TrackRecordPickRow {
  const costR = computeCostR(r.entryMid, r.stopLoss, fee.roundTripBps);
  return {
    dataDate: r.dataDate,
    pickedAt: r.pickedAt ? r.pickedAt.toISOString() : null,
    pickedOrigin: originOf(r.pickedOrigin),
    symbol: r.symbol,
    direction: r.direction,
    outcome: r.backtestOutcome,
    status: r.backtestStatus,
    exitRGross: r.backtestExitR,
    exitRNet: computeNetR(r.backtestExitR, costR),
    entryFilled: r.backtestEntryFilled,
    evaluatedAt: r.backtestEvaluatedAt ? r.backtestEvaluatedAt.toISOString() : null,
  };
}

export async function readTrackRecord(): Promise<TrackRecordRead> {
  const fee = readFeeConfig();

  // Public record = real setups only (GENUINE + hasSetup). Fill-in picks
  // (FILL_LONG/FILL_SHORT) exist to keep the daily list at 3/3 and were never
  // meant to be traded, so they must not inflate a public win rate. Một định
  // nghĩa dùng chung cho cả lịch sử đã chốt lẫn pick đang chờ, để `settlement`
  // không đếm một tập khác với số liệu công bố.
  const publicPickFilter = and(
    eq(topRecommendationPicks.pickKind, "GENUINE"),
    eq(topRecommendationPicks.hasSetup, true),
    // UNIVERSE-01: hidden in the DB are tokenized equity picks (NVDA, AMZN, ...)
    // from before the universe filter existed. A public crypto record must not
    // count them, so read-time filtering keeps already-settled stock picks out
    // of the numbers.
    sql`NOT (${nonCryptoCoinExistsSql(coins.id)})`
  );

  // FORWARD-01: mốc live tường minh cần biết TRƯỚC khi đọc, để cửa sổ forward
  // lọc được ở SQL thay vì kéo cả bảng về Node.
  const liveSinceRaw = process.env.LIVE_SINCE;
  const liveSinceMarker = parseLiveSince(liveSinceRaw);

  const pickSelection = {
    id: topRecommendationPicks.id,
    dataDate: topRecommendationPicks.dataDate,
    pickedAt: topRecommendationPicks.pickedAt,
    pickedOrigin: topRecommendationPicks.pickedOrigin,
    coinId: topRecommendationPicks.coinId,
    symbol: topRecommendationPicks.symbol,
    direction: topRecommendationPicks.direction,
    entryMid: topRecommendationPicks.entryMid,
    stopLoss: topRecommendationPicks.stopLoss,
    tp1: topRecommendationPicks.tp1,
    atr14: topRecommendationPicks.atr14,
    backtestHitDay: topRecommendationPicks.backtestHitDay,
    backtestStatus: topRecommendationPicks.backtestStatus,
    backtestOutcome: topRecommendationPicks.backtestOutcome,
    backtestExitR: topRecommendationPicks.backtestExitR,
    backtestEntryFilled: topRecommendationPicks.backtestEntryFilled,
    backtestHorizonDays: topRecommendationPicks.backtestHorizonDays,
    backtestEvaluatedAt: topRecommendationPicks.backtestEvaluatedAt,
  };

  // Một cửa sổ duy nhất, mới nhất trước: bản bị cắt vẫn chứa pick mới và stamp
  // settlement mới (freshness đọc max của chúng), và phần forward được tính từ
  // chính cửa sổ này.
  const rows = await db
    .select(pickSelection)
    .from(topRecommendationPicks)
    .innerJoin(coins, eq(coins.id, topRecommendationPicks.coinId))
    .where(and(publicPickFilter, ne(topRecommendationPicks.backtestStatus, "PENDING")))
    .orderBy(desc(topRecommendationPicks.dataDate), desc(topRecommendationPicks.id))
    .limit(MAX_ROWS);

  // FORWARD-01: phân loại MỘT lần cho cả trang lẫn export. Pick ghi trước mốc
  // LIVE_SINCE là lịch sử seed dù lag nhỏ, và pick ghi trễ hơn data_date vẫn là
  // backfill dù sau mốc live. Không có env thì mốc live suy từ pick forward đầu.
  const provenanceOf = rows.map((row) =>
    pickProvenance(
      {
        dataDate: row.dataDate,
        pickedAt: row.pickedAt ? row.pickedAt.toISOString() : null,
        pickedOrigin: originOf(row.pickedOrigin),
      },
      { liveSince: liveSinceMarker }
    )
  );

  const picks: TrackRecordExportPick[] = rows.map((row, index) => ({
    ...pickRow(row, fee),
    provenance: provenanceOf[index],
  }));
  const forwardRows = rows.filter((_, index) => provenanceOf[index] === "forward");
  const forwardPicks = picks.filter((pick) => pick.provenance === "forward");
  const liveSince =
    liveSinceMarker ??
    (forwardPicks.length > 0
      ? forwardPicks.reduce(
          (min, pick) => (pick.dataDate < min ? pick.dataDate : min),
          forwardPicks[0].dataDate
        )
      : null);

  const today = getBusinessDate();
  const [historyBench, forwardBench] = await Promise.all([
    benchmarksFor(rows, today),
    forwardRows.length > 0
      ? benchmarksFor(forwardRows, today)
      : Promise.resolve({ basket: null, btc: null }),
  ]);
  const benchmark = historyBench.basket;
  const btc = historyBench.btc;

  // ALPHA-01: summary cần return của benchmark để tính alpha + CI, nên tính
  // benchmark trước summary. SAMPLE-01: ngưỡng có thể chỉnh bằng env.
  const minTrades = envInt("BT_MIN_TRADES_VERDICT", MIN_TRADES_FOR_VERDICT);
  const minEpisodes = envInt("BT_MIN_EPISODES_VERDICT", MIN_EPISODES_FOR_VERDICT);
  const summary = buildTrackRecord(picks, {
    benchmarkReturnPct: benchmark?.returnPct ?? null,
    minTrades,
    minEpisodes,
  });

  // Bằng chứng forward: cùng phép tính, chỉ trên pick được tạo live, với
  // benchmark đo trên đúng cửa sổ của các lệnh đó.
  const split: TrackRecordForwardSplit = {
    liveSince,
    // Env sai định dạng được báo ra thay vì im lặng rơi về mốc suy ra.
    liveSinceSource: liveSinceMarker
      ? "env"
      : liveSinceRaw?.trim()
        ? "invalid-env"
        : liveSince
          ? "derived"
          : null,
    forwardPicks: forwardPicks.length,
    backfilledPicks: provenanceOf.filter((p) => p === "backfill").length,
    unknownPicks: provenanceOf.filter((p) => p === "unknown").length,
    lagGraceDays: FORWARD_PICK_LAG_DAYS,
    // ORIGIN-02: lộ trường hợp origin không bao giờ live (pipeline chậm ngày)
    // thay vì để forward record rỗng mà không ai biết vì sao.
    originSignal: originNeverLiveSignal(picks),
    summary:
      forwardRows.length > 0
        ? buildTrackRecord(forwardPicks, {
            benchmarkReturnPct: forwardBench.basket?.returnPct ?? null,
            minTrades,
            minEpisodes,
          })
        : null,
    benchmark: forwardBench.basket,
    btc: forwardBench.btc,
  };

  const recent: RecentItem[] = [...picks]
    .filter((p) => p.outcome === "TP1_WIN" || p.outcome === "TP2_WIN" || p.outcome === "SL_LOSS")
    .sort((a, b) => {
      const da = (a.evaluatedAt ?? a.dataDate).slice(0, 10);
      const dbTs = (b.evaluatedAt ?? b.dataDate).slice(0, 10);
      return da < dbTs ? 1 : da > dbTs ? -1 : 0;
    })
    .slice(0, RECENT_LIMIT)
    .map((p) => ({
      dataDate: p.dataDate,
      symbol: p.symbol,
      direction: p.direction,
      outcome: p.outcome,
      exitRNet: p.exitRNet,
      entryFilled: p.entryFilled,
    }));

  // Longest horizon the record covers: the public page compares the newest
  // pick's age against it, so a 30/60-day deployment is not called stale just
  // because its newest closed pick is legitimately that old.
  const horizonValues = rows.map((r) => r.backtestHorizonDays ?? 0).filter((h) => h > 0);
  const horizonDays =
    horizonValues.length > 0 ? Math.max(...horizonValues) : DEFAULT_FRESHNESS_HORIZON_DAYS;

  // W1: "chưa có stamp" KHÔNG luôn nghĩa là settlement chết — mọi pick công
  // khai có thể vẫn đang trong cửa sổ horizon. Trả mốc đáo hạn kế tiếp để
  // banner nói đúng sự thật thay vì đoán, và để người đọc biết khi nào có kết quả.
  let settlement: TrackRecordSettlement = { pendingPicks: 0, nextSettlementAt: null };
  try {
    const [pending] = await db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${topRecommendationPicks.dataDate})`,
      })
      .from(topRecommendationPicks)
      .innerJoin(coins, eq(coins.id, topRecommendationPicks.coinId))
      .where(and(publicPickFilter, eq(topRecommendationPicks.backtestStatus, "PENDING")));
    settlement = {
      pendingPicks: Number(pending?.count ?? 0),
      nextSettlementAt: pending?.oldest ? addDaysIso(pending.oldest, horizonDays) : null,
    };
  } catch (error) {
    console.error("[TRACK-01] Pending settlement lookup failed (non-blocking):", error);
  }

  // FRESH-01 (máy đọc): cùng ngưỡng với banner trên trang — uptime-check gọi
  // endpoint này và bắt `freshness.stale`, không phải parse HTML.
  const freshness = { ...trackRecordFreshness(summary, today, horizonDays), today };
  const horizonStats = await readHorizonStats();
  const realistic = await buildRealisticScenario(rows, picks, fee);

  return {
    picks,
    payload: {
      params: {
        feeBps: fee.feeBps,
        slippageBps: fee.slippageBps,
        roundTripBps: fee.roundTripBps,
        horizonDays,
      },
      summary,
      split,
      freshness,
      benchmark,
      btc,
      recent,
      settlement,
      horizons: horizonStats,
      realistic,
      meta: {
        dataAsOf: summary.lastDate,
        // WINDOW-01: cửa sổ đọc bị cắt ở MAX_ROWS — công bố thay vì để người
        // đọc tưởng đang xem toàn bộ lịch sử.
        window: {
          capped: rows.length >= MAX_ROWS,
          rowsRead: rows.length,
          limit: MAX_ROWS,
          oldestIncluded: picks.length > 0 ? picks[picks.length - 1].dataDate : null,
        },
        generatedAt: new Date().toISOString(),
        metricsVersion: TRACK_RECORD_METRICS_VERSION,
        commit: releaseCommit(),
        changelog: TRACK_RECORD_CHANGELOG,
      },
    },
  };
}
