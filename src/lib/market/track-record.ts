// RADAR-TRACK: lưu cohort tín hiệu radar (kể cả neutral) và đo nhiều horizon.
// Không thêm bảng: app_settings key "radar.signals". Giữ 8 ngày để đủ horizon 7d.

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { fetchBinanceFuturesKlines } from "@/lib/collectors/binance";
import {
  LEDGER_NOTE,
  compareCatalystOutcomesByBucket,
  evaluateSignal,
  planCohorts,
  selectSignalsForEvaluation,
  summarizeByBias,
  summarizeByCluster,
  type RadarSignalRecord,
  type TrackRecordResult,
} from "@/lib/market/ledger";
import { buildSetup, type SetupLevels } from "@/lib/market/setup";
import { dispatchClusterAlerts, dispatchRadarAlerts } from "@/lib/market/alerts";
import { recordClusterSnapshots } from "@/lib/market/cluster-history";
import { isBearishBias, isBullishBias } from "@/lib/market/ledger";
import { getRadarSnapshot, type RadarRow } from "@/lib/market/radar";
import { matchCatalystsForSymbol } from "@/lib/catalyst/matching";
import { readRecentCatalystFacts } from "@/lib/catalyst/store";
import type { CatalystFact } from "@/lib/catalyst/types";

export type { RadarSignalRecord, TrackRecordResult } from "@/lib/market/ledger";

const KEY = "radar.signals";
const MAX_SIGNALS = 500;
const KEEP_DAYS = 8;
const MAX_RECENT = 20;

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

let lastRecordAt = 0;

/**
 * Ghi đủ cohort 3 side + cohort neutral mỗi ngày, dùng snapshot chuẩn chứ không
 * phải rows đã filter/sort theo tab người xem. Dedupe symbol+side+ngày.
 */
export async function recordAllRadarCohorts(): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") return;

  const now = Date.now();
  if (now - lastRecordAt < 30 * 60_000) return;
  lastRecordAt = now;

  let snapshots;
  try {
    snapshots = await Promise.all([
      getRadarSnapshot({ side: "gainer", limit: 30, sort: "composite" }),
      getRadarSnapshot({ side: "loser", limit: 30, sort: "composite" }),
      getRadarSnapshot({ side: "unusual", limit: 30, sort: "composite" }),
    ]);
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không lấy được snapshot chuẩn cho cohort:",
      error instanceof Error ? error.message : String(error)
    );
    return;
  }

  const [gainer, loser, unusual] = snapshots;

  // Cluster history + cảnh báo cấp cụm độc lập với việc có signal mới hay không.
  const clusterEvents = await recordClusterSnapshots(snapshots).catch(() => []);
  if (clusterEvents.length > 0) {
    await dispatchClusterAlerts(clusterEvents, gainer.market).catch(() => 0);
  }

  const plan = planCohorts({ gainer: gainer.rows, loser: loser.rows, unusual: unusual.rows });
  const btcPrice = gainer.market.btcPrice;
  // Cả 3 snapshot dùng cùng filter mặc định, nhưng ghi bucket hiệu lực của
  // snapshot thay vì env thô: env lẻ/bị kẹp sẽ được làm tròn đúng bucket mà
  // rows thực sự đã lọc, để track-record không so lệch filter về sau.
  const minVolume = gainer.minVolume;
  const day = new Date(now).toISOString().slice(0, 10);

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

  const candidates = plan.map<RadarSignalRecord>(({ side, row }) => {
    const setup = setupFor(row);
    const labels = labelsBySymbol.get(row.symbol) ?? null;
    return {
      symbol: row.symbol,
      side,
      bias: row.bias,
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
  if (candidates.length === 0) return;

  try {
    const existing = await readSignals();
    const seen = new Set(existing.map((s) => `${s.symbol}|${s.side}|${s.at.slice(0, 10)}`));
    const fresh = candidates.filter((s) => !seen.has(`${s.symbol}|${s.side}|${day}`));
    if (fresh.length === 0) return;

    const cutoff = now - KEEP_DAYS * 86_400_000;
    const kept = existing
      .filter((s) => {
        const at = new Date(s.at).getTime();
        return Number.isFinite(at) && at >= cutoff;
      })
      .concat(fresh)
      .slice(-MAX_SIGNALS);
    await writeSignals(kept);
    await dispatchRadarAlerts(plan.map((entry) => entry.row), gainer.market).catch(() => 0);
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không ghi được signals:",
      error instanceof Error ? error.message : String(error)
    );
  }
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
