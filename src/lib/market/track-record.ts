// RADAR-TRACK: lưu cohort tín hiệu radar (kể cả neutral) và đo nhiều horizon.
// Không thêm bảng: app_settings key "radar.signals". Giữ 8 ngày để đủ horizon 7d.

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { fetchBinanceFuturesKlines } from "@/lib/collectors/binance";
import {
  LEDGER_NOTE,
  biasTrackKey,
  compareCatalystOutcomesByBucket,
  evaluateSignal,
  lastBiasBySymbolSide,
  planCohorts,
  selectSignalsForEvaluation,
  shouldRecordSignal,
  summarizeByBias,
  summarizeByCluster,
  type RadarSignalRecord,
  type TrackRecordResult,
} from "@/lib/market/ledger";
import { buildSetup, type SetupLevels } from "@/lib/market/setup";
import { dispatchClusterAlerts, dispatchRadarAlerts } from "@/lib/market/alerts";
import {
  FAST_LANE_INTERVAL_MINUTES,
  fastCohortIntervalMinutes,
  normalizeCohortMode,
  type CohortMode,
} from "@/lib/market/fast-lane";
import { recordClusterSnapshots } from "@/lib/market/cluster-history";
import { recordBiasSnapshot } from "@/lib/market/bias-log";
import { isBearishBias, isBullishBias } from "@/lib/market/ledger";
import { getRadarSnapshot, type RadarMarketContext, type RadarRow } from "@/lib/market/radar";
import { matchCatalystsForSymbol } from "@/lib/catalyst/matching";
import { readRecentCatalystFacts } from "@/lib/catalyst/store";
import type { CatalystFact } from "@/lib/catalyst/types";

export type { RadarSignalRecord, TrackRecordResult } from "@/lib/market/ledger";

const KEY = "radar.signals";
const MAX_SIGNALS = 500;
const KEEP_DAYS = 8;
const MAX_RECENT = 20;

/**
 * RADAR-COHORT: cohort/ledger/alert không còn chạy trong `after()` của request
 * radar. FastAPI gọi `POST /api/market/radar/cohort` theo nhịp cấu hình, nên
 * tải không phụ thuộc số người mở /radar và không nhân lên theo số instance.
 *
 * Khoá mềm nằm ở `app_settings[COHORT_LOCK_KEY]`: mỗi lượt phải giành khoá
 * bằng một câu INSERT ... ON CONFLICT ... WHERE hết hạn, nên nhiều instance
 * cùng nhận một tick chỉ có đúng một instance chạy. `expiresAt` = thời điểm
 * sớm nhất được chạy lượt kế tiếp (nhịp tối thiểu), đồng thời chặn chạy chồng.
 */
export const COHORT_LOCK_KEY = "radar.cohort.lock";
/** Fast lane 3 phút có khoá riêng: không chặn và không bị chặn bởi cohort đầy đủ. */
export const FAST_COHORT_LOCK_KEY = "radar.cohort.fast.lock";
export const DEFAULT_COHORT_INTERVAL_MINUTES = 30;
export const MAX_COHORT_INTERVAL_MINUTES = 1440;
/** Sàn khoá: một lượt build nguội + alert có thể tới ~1 phút. */
export const MIN_COHORT_LEASE_MINUTES = 10;
/** Tick đến sớm hơn hạn khoá chưa tới 1 phút vẫn coi là tới hạn (tránh lệch nhịp). */
export const COHORT_DUE_TOLERANCE_MS = 60_000;

export type CohortSkipReason = "test" | "demo" | "disabled" | "locked" | "error";

export interface CohortRunResult {
  ran: boolean;
  skipped: CohortSkipReason | null;
  /** `fast` = làn 3 phút (universe ~30 symbol, chỉ alert URGENT). */
  mode: CohortMode;
  intervalMinutes: number;
  /** Số tín hiệu mới thực sự ghi vào ledger. */
  signals: number;
  /** Số cụm snapshot đã ghi (kèm event mới phát hiện). */
  clusterEvents: number;
  /** Số row ghi vào `radar_bias_log` (mọi row của 3 snapshot). */
  biasRows: number;
  /** Số alert đã gửi thành công (row + cluster). */
  alerts: number;
  at: string;
}

/** Nhịp job cohort (phút); 0 = tắt, giá trị hỏng/lớn quá bị kẹp. */
export function cohortIntervalMinutes(
  raw: unknown,
  fallback = DEFAULT_COHORT_INTERVAL_MINUTES
): number {
  // Thiếu tham số (undefined/null/"") = dùng nhịp mặc định; chỉ số 0 mới là “tắt”.
  if (raw === null || raw === undefined || raw === "") return fallback;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(MAX_COHORT_INTERVAL_MINUTES, Math.floor(value));
}

/** Thời gian giữ khoá = nhịp chạy, sàn 10 phút. */
export function cohortLeaseMs(intervalMinutes: number): number {
  const minutes = Number.isFinite(intervalMinutes) ? Math.max(0, intervalMinutes) : 0;
  return Math.max(MIN_COHORT_LEASE_MINUTES, minutes) * 60_000;
}

const COHORT_OWNER = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

function returnedRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** true = giành được khoá; false = instance khác đang giữ; null = DB lỗi. */
async function acquireCohortLock(
  now: number,
  leaseMs: number,
  key = COHORT_LOCK_KEY
): Promise<boolean | null> {
  try {
    const value = JSON.stringify({
      owner: COHORT_OWNER,
      at: new Date(now).toISOString(),
      expiresAt: now + leaseMs,
    });
    const result = await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${key}, ${value}::jsonb, now())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
        WHERE COALESCE((app_settings.value ->> 'expiresAt')::bigint, 0) - ${COHORT_DUE_TOLERANCE_MS} <= ${now}
      RETURNING key
    `);
    return returnedRows(result).length > 0;
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không giành được khoá cohort:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/** Nhả khoá khi lượt chạy lỗi để tick sau còn thử lại; chỉ nhả khoá của mình. */
async function releaseCohortLock(key = COHORT_LOCK_KEY): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE app_settings
      SET value = jsonb_build_object('owner', ${COHORT_OWNER}, 'releasedAt', now()),
          updated_at = now()
      WHERE key = ${key}
        AND value ->> 'owner' = ${COHORT_OWNER}
    `);
  } catch {
    // Best effort: khoá vẫn tự hết hạn theo `expiresAt`.
  }
}

interface CatalystLedgerLabels {
  hasCatalyst: boolean;
  catalystTypes: string[];
  catalystSources: string[];
}

async function loadCatalystFacts(now: number): Promise<CatalystFact[] | null> {
  try {
    const facts = await readRecentCatalystFacts({ sinceDays: 14, now });
    // Rỗng = chưa sync nguồn nào → không thể kết luận “không có catalyst”, để trống nhãn.
    return facts.length > 0 ? facts : null;
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không đọc được catalyst facts — tín hiệu sẽ chưa gắn nhãn:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  }
}

/** Nhãn catalyst cho ledger: chỉ loại/nguồn, không lưu toàn văn fact. */
function catalystLabelsFor(
  symbol: string,
  facts: CatalystFact[],
  now: number
): CatalystLedgerLabels | null {
  if (facts.length === 0) return null;
  const matched = matchCatalystsForSymbol(symbol, facts, now);
  return {
    hasCatalyst: matched.length > 0,
    catalystTypes: [...new Set(matched.map((fact) => fact.type))],
    catalystSources: [...new Set(matched.map((fact) => fact.source))],
  };
}

function setupFor(row: RadarRow): SetupLevels | null {
  if (!row.atrPct || row.atrPct <= 0) return null;
  if (isBullishBias(row.bias)) return buildSetup("BULLISH", row.price, (row.price * row.atrPct) / 100);
  if (isBearishBias(row.bias)) return buildSetup("BEARISH", row.price, (row.price * row.atrPct) / 100);
  return null;
}

export interface SignalBatchOutcome {
  /** Số tín hiệu bias mới thực sự ghi vào ledger. */
  signals: number;
  /** Số alert row gửi thành công. */
  rowAlerts: number;
}

/**
 * RADAR-TG: ghi bias mới + gửi alert row.
 *
 * Alert KHÔNG còn nằm trong `if (fresh.length > 0)`: một setup đẹp trên coin
 * đã bullish từ trước vẫn phải được báo, nên cohort nào cũng gọi dispatch.
 * Chống trùng do dedupe `symbol|bias|ngày` + cooldown/symbol trong alerts.ts
 * lo, nên gọi mỗi lượt không sinh tin lặp.
 */
export async function recordSignalBatch(params: {
  candidates: RadarSignalRecord[];
  existing: RadarSignalRecord[];
  now: number;
  rows: RadarRow[];
  market: RadarMarketContext;
  /** `radar_bias_log.id` theo symbol — gắn vào alert để đo outcome sau này. */
  biasLogIds?: Map<string, number>;
  /** Cho phép inject khi test; production dùng impl mặc định. */
  deps?: {
    write?: typeof writeSignals;
    dispatch?: typeof dispatchRadarAlerts;
  };
}): Promise<SignalBatchOutcome> {
  const write = params.deps?.write ?? writeSignals;
  const dispatch = params.deps?.dispatch ?? dispatchRadarAlerts;
  const fresh = params.candidates.filter((signal) =>
    shouldRecordSignal(signal.prevBias, signal.bias)
  );

  if (fresh.length > 0) {
    const cutoff = params.now - KEEP_DAYS * 86_400_000;
    const kept = params.existing
      .filter((signal) => {
        const at = new Date(signal.at).getTime();
        return Number.isFinite(at) && at >= cutoff;
      })
      .concat(fresh)
      .slice(-MAX_SIGNALS);
    await write(kept);
  }

  const rowAlerts = await (params.biasLogIds
    ? dispatch(params.rows, params.market, { biasLogIds: params.biasLogIds })
    : dispatch(params.rows, params.market)
  ).catch(() => 0);
  return { signals: fresh.length, rowAlerts };
}

async function readSignals(): Promise<RadarSignalRecord[]> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    const value = row?.value;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (s): s is RadarSignalRecord =>
          Boolean(s) &&
          typeof s === "object" &&
          typeof (s as RadarSignalRecord).symbol === "string" &&
          typeof (s as RadarSignalRecord).at === "string" &&
          Number.isFinite((s as RadarSignalRecord).price) &&
          (s as RadarSignalRecord).price > 0
      )
      .map((s) => ({
        ...s,
        entryQuality: Number.isFinite(s.entryQuality) ? s.entryQuality : 0,
        actionable:
          typeof s.actionable === "boolean"
            ? s.actionable
            : s.bias !== "neutral" && Number(s.score) >= 55 && Number(s.entryQuality ?? 0) >= 40,
      }));
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không đọc được signals:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

async function writeSignals(signals: RadarSignalRecord[]): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: signals, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: signals, updatedAt: new Date() },
    });
}

/**
 * Ghi đủ cohort 3 side + cohort neutral mỗi ngày, dùng snapshot chuẩn chứ không
 * phải rows đã filter/sort theo tab người xem. Dedupe symbol+side+ngày.
 *
 * Chỉ chạy từ endpoint scheduler (cron FastAPI) hoặc gọi tay có token; không
 * chạy trong request radar. Khoá DB quyết định instance nào chạy và nhịp tối
 * thiểu, thay cho throttle RAM trước đây (mỗi process một biến → N instance =
 * N lượt chạy).
 */
export async function recordAllRadarCohorts(
  options: { intervalMinutes?: number; mode?: CohortMode | string } = {}
): Promise<CohortRunResult> {
  const mode = normalizeCohortMode(options.mode);
  const fast = mode === "fast";
  const intervalMinutes = fast
    ? fastCohortIntervalMinutes(options.intervalMinutes ?? FAST_LANE_INTERVAL_MINUTES)
    : cohortIntervalMinutes(options.intervalMinutes);
  const lockKey = fast ? FAST_COHORT_LOCK_KEY : COHORT_LOCK_KEY;
  const empty = (skipped: CohortSkipReason): CohortRunResult => ({
    ran: false,
    skipped,
    mode,
    intervalMinutes,
    signals: 0,
    clusterEvents: 0,
    biasRows: 0,
    alerts: 0,
    at: new Date().toISOString(),
  });

  if (process.env.NODE_ENV === "test") return empty("test");
  if (process.env.RADAR_DEMO === "1") return empty("demo");
  if (intervalMinutes <= 0) return empty("disabled");

  const now = Date.now();
  // Fast lane 3 phút: khoá ngắn đúng bằng nhịp (sàn 1 phút) thay vì sàn 10
  // phút của cohort đầy đủ, và là khoá riêng nên hai làn chạy song song.
  const leaseMs = fast
    ? Math.max(1, intervalMinutes) * 60_000
    : cohortLeaseMs(intervalMinutes);
  const lock = await acquireCohortLock(now, leaseMs, lockKey);
  if (lock === null) return empty("error");
  if (!lock) return empty("locked");

  let snapshots;
  try {
    const query = { limit: 30, sort: "composite" as const, ...(fast ? { fast: true } : {}) };
    snapshots = await Promise.all([
      getRadarSnapshot({ side: "gainer", ...query }),
      getRadarSnapshot({ side: "loser", ...query }),
      getRadarSnapshot({ side: "unusual", ...query }),
    ]);
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không lấy được snapshot chuẩn cho cohort:",
      error instanceof Error ? error.message : String(error)
    );
    await releaseCohortLock(lockKey);
    return empty("error");
  }

  const [gainer, loser, unusual] = snapshots;

  // Fast lane: chỉ alert URGENT, không ghi ledger/cluster/bias log — cohort
  // đầy đủ vẫn là nơi lưu dữ liệu đo và gửi ACTIONABLE/WATCH.
  if (fast) {
    const rowsBySymbol = new Map<string, RadarRow>();
    for (const snapshot of snapshots) {
      for (const row of snapshot.rows) {
        if (!rowsBySymbol.has(row.symbol)) rowsBySymbol.set(row.symbol, row);
      }
    }
    const alerts = await dispatchRadarAlerts([...rowsBySymbol.values()], gainer.market, {
      lane: "fast",
    }).catch(() => 0);
    return {
      ran: true,
      skipped: null,
      mode,
      intervalMinutes,
      signals: 0,
      clusterEvents: 0,
      biasRows: 0,
      alerts,
      at: new Date().toISOString(),
    };
  }

  // Cluster history + cảnh báo cấp cụm độc lập với việc có signal mới hay không.
  const clusterEvents = await recordClusterSnapshots(snapshots).catch(() => []);
  let clusterAlerts = 0;
  if (clusterEvents.length > 0) {
    clusterAlerts = await dispatchClusterAlerts(clusterEvents, gainer.market).catch(() => 0);
  }

  // RADAR-BIAS-LOG: ghi MỌI row của 3 snapshot (không chỉ cohort 12/side) kèm
  // feature đầu vào — dữ liệu thô cho backtest/ML. Không throw: lỗi bảng log
  // không được làm hỏng ledger/alert.
  const biasLog = await recordBiasSnapshot(
    [
      { side: "gainer", snapshot: gainer },
      { side: "loser", snapshot: loser },
      { side: "unusual", snapshot: unusual },
    ],
    new Date(now)
  );

  const plan = planCohorts({ gainer: gainer.rows, loser: loser.rows, unusual: unusual.rows });
  const btcPrice = gainer.market.btcPrice;
  // Cả 3 snapshot dùng cùng filter mặc định, nhưng ghi bucket hiệu lực của
  // snapshot thay vì env thô: env lẻ/bị kẹp sẽ được làm tròn đúng bucket mà
  // rows thực sự đã lọc, để track-record không so lệch filter về sau.
  const minVolume = gainer.minVolume;

  // RADAR-06-LEDGER: chụp nhãn catalyst + clusterId tại đúng thời điểm ghi.
  // Một lần đọc DB cho cả cohort; không có dữ liệu catalyst thì để trống nhãn
  // thay vì ghi false sai. Nhãn chỉ để phân tích, không vào score/bias.
  const catalystFacts = await loadCatalystFacts(now);
  const labelsBySymbol = new Map<string, CatalystLedgerLabels | null>();
  for (const { row } of plan) {
    if (labelsBySymbol.has(row.symbol)) continue;
    labelsBySymbol.set(
      row.symbol,
      catalystFacts ? catalystLabelsFor(row.symbol, catalystFacts, now) : null
    );
  }

  // Đọc ledger một lần: vừa để dedupe, vừa để biết bias lần trước của mỗi
  // symbol+side — cơ sở của `prevBias`/`biasChanged` khi bias lật trong ngày.
  // `readSignals()` không throw: lỗi DB trả [] như trước.
  const existing = await readSignals();
  const prevBiasByKey = lastBiasBySymbolSide(existing);

  const candidates = plan.map<RadarSignalRecord>(({ side, row }) => {
    const setup = setupFor(row);
    const labels = labelsBySymbol.get(row.symbol) ?? null;
    const prevBias = prevBiasByKey.get(biasTrackKey(row.symbol, side)) ?? null;
    return {
      symbol: row.symbol,
      side,
      bias: row.bias,
      prevBias,
      biasChanged: prevBias !== null && prevBias !== row.bias,
      invalidationPrice: row.invalidationPrice ?? null,
      invalidationNote: row.invalidationNote ?? null,
      score: row.score,
      entryQuality: row.entryQuality,
      price: row.price,
      at: new Date(now).toISOString(),
      minVolume,
      btcPrice: btcPrice !== null && Number.isFinite(btcPrice) && btcPrice > 0 ? btcPrice : null,
      setup: setup
        ? {
            direction: setup.direction,
            entryLow: setup.entryLow,
            entryHigh: setup.entryHigh,
            tp1: setup.tp1,
            tp2: setup.tp2,
            stopLoss: setup.stopLoss,
          }
        : null,
      clusterId: row.clusterId ?? null,
      clusterLabel: row.clusterLabel ?? null,
      clusterSize: row.clusterSize ?? 1,
      clusterLeader: row.clusterLeader ?? false,
      clusterLaggard: row.clusterLaggard ?? false,
      actionable: row.bias !== "neutral" && row.score >= 55 && row.entryQuality >= 40,
      ...(labels
        ? {
            hasCatalyst: labels.hasCatalyst,
            catalystTypes: labels.catalystTypes,
            catalystSources: labels.catalystSources,
          }
        : {}),
    };
  });
  let signals = 0;
  let rowAlerts = 0;

  if (candidates.length > 0) {
    try {
      // Ledger: chỉ ghi khi bias đổi so với lần chấm trước (hoặc lần đầu thấy),
      // không khoá theo ngày nên lật đi lật lại trong ngày vẫn đủ dòng. Alert:
      // chạy MỖI lượt cohort — dedupe/cooldown chống trùng (RADAR-TG/W1).
      // Alert → biasLogId: một symbol có thể xuất hiện ở cả gainer/loser; lấy
      // row log đầu tiên của symbol làm mốc đo (đủ để join outcome 1h/4h/24h).
      const biasLogIds = new Map<string, number>();
      for (const [key, id] of biasLog.idsBySymbolSide) {
        const symbol = key.slice(0, Math.max(0, key.indexOf("|")));
        if (symbol && !biasLogIds.has(symbol)) biasLogIds.set(symbol, id);
      }

      const outcome = await recordSignalBatch({
        candidates,
        existing,
        now,
        rows: plan.map((entry) => entry.row),
        market: gainer.market,
        biasLogIds,
      });
      signals = outcome.signals;
      rowAlerts = outcome.rowAlerts;
    } catch (error) {
      console.warn(
        "[RADAR-TRACK] Không ghi được signals:",
        error instanceof Error ? error.message : String(error)
      );
      await releaseCohortLock(lockKey);
      return empty("error");
    }
  }

  return {
    ran: true,
    skipped: null,
    mode,
    intervalMinutes,
    signals,
    clusterEvents: clusterEvents.length,
    biasRows: biasLog.inserted,
    alerts: clusterAlerts + rowAlerts,
    at: new Date().toISOString(),
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

let evalCache: { expires: number; value: TrackRecordResult } | null = null;

export async function evaluateRadarSignals(): Promise<TrackRecordResult> {
  if (evalCache && evalCache.expires > Date.now()) return evalCache.value;

  const now = Date.now();
  // Chọn theo tuổi horizon thay vì lấy hết: số symbol phải fetch bị chặn (~200)
  // nên weight/latency không phình theo cohort 8 ngày; horizon 3d/7d vẫn có mẫu.
  const signals = selectSignalsForEvaluation(await readSignals(), now);

  if (signals.length === 0) {
    return {
      summaries: [],
      clusterSummaries: [],
      catalyst: [],
      recent: [],
      total: 0,
      actionable: 0,
      note: "Chưa có tín hiệu nào. Mỗi cohort ngày sẽ lưu cả tín hiệu actionable và ứng viên neutral để đo forward return.",
      evaluatedAt: new Date().toISOString(),
    };
  }

  const firstAt = Math.min(...signals.map((s) => Date.parse(s.at)));
  const bySymbol = new Map<string, number>();
  for (const signal of signals) {
    const at = Date.parse(signal.at);
    const current = bySymbol.get(signal.symbol);
    bySymbol.set(signal.symbol, current === undefined ? at : Math.min(current, at));
  }

  const [btcCandles, entries] = await Promise.all([
    fetchBinanceFuturesKlines("BTCUSDT", 500, "1h", firstAt).catch(() => []),
    mapLimit([...bySymbol.entries()], 6, async ([symbol, start]) => {
      const candles = await fetchBinanceFuturesKlines(`${symbol}USDT`, 200, "1h", start).catch(() => []);
      return [symbol, candles] as const;
    }),
  ]);
  const candlesBySymbol = new Map(entries);

  const tracked = signals.map((signal) =>
    evaluateSignal(signal, candlesBySymbol.get(signal.symbol) ?? [], btcCandles, now)
  );

  const result: TrackRecordResult = {
    summaries: summarizeByBias(tracked),
    clusterSummaries: summarizeByCluster(tracked),
    catalyst: compareCatalystOutcomesByBucket(tracked),
    recent: tracked.slice(0, MAX_RECENT),
    total: tracked.length,
    actionable: tracked.filter((s) => s.actionable).length,
    note: LEDGER_NOTE,
    evaluatedAt: new Date().toISOString(),
  };

  evalCache = { expires: Date.now() + 5 * 60_000, value: result };
  return result;
}

/** Chỉ dùng trong test/health: xoá cache để đọc state mới. */
export function resetTrackRecordCache(): void {
  evalCache = null;
}
