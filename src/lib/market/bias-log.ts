// RADAR-BIAS-LOG: nhật ký append-only mọi row radar mỗi lượt cohort, kèm job
// tính outcome 1h/4h/24h/3d/7d.
//
// Khác ledger (`app_settings.radar.signals`): ghi **mọi** row của 3 snapshot
// (không chỉ cohort 12/side), không dedupe theo ngày, không cap 500 dòng, và giữ
// toàn bộ feature đầu vào của scoring. Nhờ vậy backtest/ML trả lời được "điều
// kiện nào dẫn tới nhãn sai", thay vì chỉ đếm hit-rate trên nhãn.
//
// Outcome tách bảng riêng để bảng log thật sự append-only: chỉ INSERT, không
// UPDATE/DELETE bản ghi log.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { radarBiasLog, radarBiasOutcome } from "@/db/schema";
import { fetchBinanceFuturesKlines } from "@/lib/collectors/binance";
import {
  HORIZONS,
  evaluateSignal,
  type HorizonId,
  type RadarSignalRecord,
} from "@/lib/market/ledger";
import type { Bias, MoverSide } from "@/lib/market/scoring";
import type { RadarSnapshot } from "@/lib/market/radar";

/**
 * Phiên bản bộ trọng số sinh ra nhãn. Đổi scoring (hoặc chạy song song engine
 * mới) thì tăng số này để mọi thống kê/backtest tách được hai phiên bản.
 */
export const BIAS_ENGINE_VERSION = "v2";

/** 3 side × tối đa 30 row/side; chặn payload insert nếu snapshot phình bất thường. */
const MAX_ROWS_PER_RUN = 120;
/** Số row log xét mỗi lượt job outcome (mỗi row chỉ được xét khi có horizon tới hạn). */
const MAX_LOG_ROWS_PER_RUN = 400;

export type BiasLogInsert = typeof radarBiasLog.$inferInsert;
export type BiasOutcomeInsert = typeof radarBiasOutcome.$inferInsert;

export interface BiasSnapshotInput {
  side: MoverSide;
  snapshot: RadarSnapshot;
}

/** Khoá prev-bias: cặp symbol+side (bias được chấm theo từng side). */
export function biasLogKey(symbol: string, side: string): string {
  return `${symbol}|${side}`;
}

/**
 * Dựng các row log từ snapshot. Hàm thuần để test được không cần DB.
 *
 * `prevBiasBySymbolSide` là bias lần chấm trước của từng `symbol|side`; thiếu
 * khoá = lần đầu thấy (`prevBias: null`, `biasChanged: false`).
 */
export function buildBiasLogRows(
  inputs: BiasSnapshotInput[],
  at: Date,
  prevBiasBySymbolSide: Map<string, string> = new Map()
): BiasLogInsert[] {
  const rows: BiasLogInsert[] = [];
  for (const { side, snapshot } of inputs) {
    for (const row of snapshot.rows) {
      if (!Number.isFinite(row.price) || row.price <= 0) continue;
      const prevBias = prevBiasBySymbolSide.get(biasLogKey(row.symbol, side)) ?? null;
      rows.push({
        loggedAt: at,
        symbol: row.symbol,
        side,
        price: row.price,
        bias: row.bias,
        prevBias,
        biasChanged: prevBias !== null && prevBias !== row.bias,
        score: row.score,
        entryQuality: row.entryQuality,
        composite: row.composite,
        clusterId: row.clusterId ?? null,
        clusterLabel: row.clusterLabel ?? null,
        clusterSize: row.clusterSize ?? null,
        clusterLeader: row.clusterLeader ?? null,
        clusterLaggard: row.clusterLaggard ?? null,
        btcPrice: snapshot.market.btcPrice ?? null,
        regime: snapshot.market.regime,
        changePct: row.changePct,
        changeAtrMultiple: row.changeAtrMultiple ?? null,
        fundingRate: row.fundingRate ?? null,
        oiChangePct: row.oiChangePct ?? null,
        rsi14: row.rsi14 ?? null,
        ema20: row.ema20 ?? null,
        ema50: row.ema50 ?? null,
        volumeZ: row.volumeZ ?? null,
        volumeRatio7d: row.volumeRatio7d ?? null,
        rangePosition: row.rangePosition,
        rangePct7d: row.rangePct7d ?? null,
        distanceFromHighPct: row.distanceFromHighPct,
        distanceFrom7dHighPct: row.distanceFrom7dHighPct ?? null,
        impulseAgeHours: row.impulseAgeHours ?? null,
        atrPct: row.atrPct ?? null,
        listingAgeDays: row.listingAgeDays ?? null,
        isBreakout7d: row.isBreakout7d,
        spotLed: row.spotLed ?? null,
        relativeStrengthPct: row.relativeStrengthPct ?? null,
        catalystTriggered: row.catalystTriggered ?? false,
        invalidationPrice: row.invalidationPrice ?? null,
        engineVersion: BIAS_ENGINE_VERSION,
      });
    }
  }
  return rows;
}

/** Horizon đã đủ tuổi tại `now` (ms). Rỗng = row chưa đo được horizon nào. */
export function dueHorizons(loggedAtMs: number, now = Date.now()): HorizonId[] {
  if (!Number.isFinite(loggedAtMs)) return [];
  const age = now - loggedAtMs;
  if (age <= 0) return [];
  return HORIZONS.filter((horizon) => age >= horizon.hours * 3_600_000).map(
    (horizon) => horizon.id
  );
}

function returnedRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

function timeOf(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value));
}

let latestBiasCache: { expires: number; value: Map<string, string> } | null = null;
const LATEST_BIAS_TTL_MS = 60_000;
/**
 * Bias gần nhất (trong 6 giờ) của từng `symbol|side` — nguồn cho hysteresis
 * trong scoring. Cache 60 giây để build snapshot (cache nguội) không query lại DB
 * cho từng side; 6 giờ để nhãn cũ không “neo” bias quá lâu.
 *
 * Lỗi DB trả map rỗng: scoring chạy thuần, không có hysteresis.
 */
export async function readLatestBiasBySymbolSide(now = Date.now()): Promise<Map<string, string>> {
  if (latestBiasCache && latestBiasCache.expires > now) return latestBiasCache.value;
  try {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (symbol, side) symbol, side, bias
      FROM radar_bias_log
      WHERE logged_at >= now() - interval '6 hours'
      ORDER BY symbol, side, logged_at DESC, id DESC
    `);
    const value = new Map<string, string>();
    for (const row of returnedRows(result) as Array<{ symbol: string; side: string; bias: string }>) {
      if (!row?.symbol || !row?.side || !row?.bias) continue;
      value.set(biasLogKey(row.symbol, row.side), row.bias);
    }
    latestBiasCache = { expires: now + LATEST_BIAS_TTL_MS, value };
    return value;
  } catch (error) {
    console.warn(
      "[RADAR-BIAS-LOG] Không đọc được bias gần nhất (bỏ hysteresis lượt này):",
      error instanceof Error ? error.message : String(error)
    );
    const value = new Map<string, string>();
    latestBiasCache = { expires: now + LATEST_BIAS_TTL_MS, value };
    return value;
  }
}

async function readPrevBias(at: Date): Promise<Map<string, string>> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (symbol, side) symbol, side, bias
    FROM radar_bias_log
    WHERE logged_at < ${at}
    ORDER BY symbol, side, logged_at DESC, id DESC
  `);
  const map = new Map<string, string>();
  for (const row of returnedRows(result) as Array<{ symbol: string; side: string; bias: string }>) {
    if (!row?.symbol || !row?.side || !row?.bias) continue;
    map.set(biasLogKey(row.symbol, row.side), row.bias);
  }
  return map;
}

export interface BiasLogResult {
  /** Số row thực sự ghi được. */
  inserted: number;
  /** Số row dựng ra từ snapshot (trước khi insert). */
  rows: number;
  /** Số row có bias khác lần chấm trước. */
  changed: number;
}

/**
 * Ghi mọi row của 3 snapshot vào `radar_bias_log`.
 *
 * Không throw: job cohort vẫn phải chạy tiếp (ledger/alert) nếu bảng log lỗi —
 * chỉ log warning. Gọi lại cùng `at` là idempotent nhờ unique
 * (symbol, side, logged_at).
 */
export async function recordBiasSnapshot(
  inputs: BiasSnapshotInput[],
  at = new Date()
): Promise<BiasLogResult> {
  if (process.env.RADAR_DEMO === "1") return { inserted: 0, rows: 0, changed: 0 };

  let prev = new Map<string, string>();
  try {
    prev = await readPrevBias(at);
  } catch (error) {
    // Lần chấm đầu tiên sau khi deploy cũng có thể lỗi bảng chưa migrate; vẫn ghi được.
    console.warn(
      "[RADAR-BIAS-LOG] Không đọc được prev bias (bỏ trống cột prev_bias):",
      error instanceof Error ? error.message : String(error)
    );
  }

  const rows = buildBiasLogRows(inputs, at, prev).slice(0, MAX_ROWS_PER_RUN);
  if (rows.length === 0) return { inserted: 0, rows: 0, changed: 0 };

  try {
    const inserted = await db.insert(radarBiasLog).values(rows).onConflictDoNothing().returning({
      id: radarBiasLog.id,
    });
    return {
      inserted: inserted.length,
      rows: rows.length,
      changed: rows.filter((row) => row.biasChanged === true).length,
    };
  } catch (error) {
    console.warn(
      "[RADAR-BIAS-LOG] Không ghi được radar_bias_log:",
      error instanceof Error ? error.message : String(error)
    );
    return { inserted: 0, rows: rows.length, changed: 0 };
  }
}

interface DueLogRow {
  id: number;
  symbol: string;
  side: string;
  bias: string;
  price: number;
  logged_at: unknown;
  btc_price: number | null;
  horizons: string[] | null;
}

export interface BiasOutcomeResult {
  /** Row log có ít nhất một horizon tới hạn nhưng chưa có outcome. */
  candidates: number;
  /** Số symbol phải fetch klines. */
  symbols: number;
  /** Số outcome dựng ra. */
  computed: number;
  /** Số outcome ghi được (sau onConflictDoNothing). */
  inserted: number;
  at: string;
}

/**
 * Tính outcome cho các row log đã đủ tuổi horizon: mỗi row được xét khi có
 * horizon tới hạn mà `radar_bias_outcome` chưa có dòng — nên job chạy 10 phút/lần
 * không fetch lại klines cho các row đã xong.
 *
 * Giá dùng đúng logic của ledger (`evaluateSignal`): close nến 1h gần mốc, return
 * so giá lúc ghi, relative với BTC, MFE/MAE theo chiều bias, win = đúng chiều bias.
 */
export async function recordBiasOutcomes(now = Date.now()): Promise<BiasOutcomeResult> {
  const empty: BiasOutcomeResult = {
    candidates: 0,
    symbols: 0,
    computed: 0,
    inserted: 0,
    at: new Date(now).toISOString(),
  };
  if (process.env.RADAR_DEMO === "1") return empty;

  // Lọc "còn thiếu horizon tới hạn" NGAY trong SQL, không phải ở TS: nếu lấy 400
  // row cũ nhất rồi mới lọc thì sau vài giờ cả 400 slot là row đã xong và job
  // không bao giờ chạm tới row mới. Số outcome hiện có luôn nhỏ hơn số horizon đã
  // tới hạn khi còn horizon thiếu (mỗi horizon được ghi đúng một lần).
  const result = await db.execute(sql`
    SELECT l.id, l.symbol, l.side, l.bias, l.price, l.logged_at, l.btc_price,
           COALESCE(o.horizons, '{}') AS horizons
    FROM radar_bias_log l
    LEFT JOIN LATERAL (
      SELECT array_agg(horizon) AS horizons
      FROM radar_bias_outcome
      WHERE log_id = l.id
    ) o ON true
    WHERE l.logged_at <= now() - interval '1 hour'
      AND cardinality(COALESCE(o.horizons, '{}')) < CASE
            WHEN l.logged_at <= now() - interval '7 days' THEN 5
            WHEN l.logged_at <= now() - interval '3 days' THEN 4
            WHEN l.logged_at <= now() - interval '24 hours' THEN 3
            WHEN l.logged_at <= now() - interval '4 hours' THEN 2
            ELSE 1
          END
    ORDER BY l.logged_at ASC
    LIMIT ${MAX_LOG_ROWS_PER_RUN}
  `);

  const candidates: Array<{ row: DueLogRow; loggedAtMs: number; missing: HorizonId[] }> = [];
  for (const raw of returnedRows(result) as DueLogRow[]) {
    if (!raw?.id || !raw?.symbol || !Number.isFinite(Number(raw.price))) continue;
    const loggedAtMs = timeOf(raw.logged_at);
    if (!Number.isFinite(loggedAtMs)) continue;
    const have = new Set(Array.isArray(raw.horizons) ? raw.horizons : []);
    const missing = dueHorizons(loggedAtMs, now).filter((horizon) => !have.has(horizon));
    if (missing.length === 0) continue;
    candidates.push({ row: raw, loggedAtMs, missing });
  }

  if (candidates.length === 0) return empty;

  // Fetch klines từ mốc log sớm nhất của từng symbol, một lần cho mọi row của symbol đó.
  const startBySymbol = new Map<string, number>();
  for (const { row, loggedAtMs } of candidates) {
    const current = startBySymbol.get(row.symbol);
    startBySymbol.set(
      row.symbol,
      current === undefined ? loggedAtMs : Math.min(current, loggedAtMs)
    );
  }
  const globalStart = Math.min(...startBySymbol.values());

  const btcCandles = await fetchBinanceFuturesKlines("BTCUSDT", 500, "1h", globalStart).catch(
    () => []
  );

  const symbols = [...startBySymbol.keys()];
  const entries = await mapLimit(symbols, 6, async (symbol) => {
    const candles = await fetchBinanceFuturesKlines(
      `${symbol}USDT`,
      200,
      "1h",
      startBySymbol.get(symbol)
    ).catch(() => []);
    return [symbol, candles] as const;
  });
  const candlesBySymbol = new Map(entries);

  const outcomes: BiasOutcomeInsert[] = [];
  const computedAt = new Date(now);
  for (const { row, missing } of candidates) {
    const record: RadarSignalRecord = {
      symbol: row.symbol,
      side: row.side as MoverSide,
      bias: row.bias as Bias,
      score: 0,
      entryQuality: 0,
      price: Number(row.price),
      at: new Date(timeOf(row.logged_at)).toISOString(),
      btcPrice: row.btc_price === null ? null : Number(row.btc_price),
      setup: null,
      actionable: false,
    };
    const tracked = evaluateSignal(
      record,
      candlesBySymbol.get(row.symbol) ?? [],
      btcCandles,
      now
    );
    for (const horizon of missing) {
      const measured = tracked.horizons[horizon];
      if (!measured || measured.pending) continue;
      outcomes.push({
        logId: Number(row.id),
        horizon,
        computedAt,
        closePct: measured.returnPct,
        btcReturnPct: measured.btcReturnPct,
        relativePct: measured.relativePct,
        mfePct: measured.mfePct,
        maePct: measured.maePct,
        win: measured.win,
      });
    }
  }

  if (outcomes.length === 0) {
    return { ...empty, candidates: candidates.length, symbols: symbols.length };
  }

  const inserted = await db
    .insert(radarBiasOutcome)
    .values(outcomes)
    .onConflictDoNothing()
    .returning({ id: radarBiasOutcome.id });

  return {
    candidates: candidates.length,
    symbols: symbols.length,
    computed: outcomes.length,
    inserted: inserted.length,
    at: new Date(now).toISOString(),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
