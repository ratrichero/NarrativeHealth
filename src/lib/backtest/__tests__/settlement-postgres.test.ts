// BT-E2E — settlement chạy trên Postgres THẬT (PGlite) rồi đọc lại qua
// /api/track-record.
//
// Vì sao cần: test cũ mock `@/db` nên UPDATE nào cũng "chạy được", và đúng lỗi
// stamp key (`horizonDays` thay vì `backtestHorizonDays`) đã lọt qua toàn bộ
// suite — Postgres mới là thứ từ chối `column "..." does not exist`. Ở đây
// schema được dựng thật, drizzle dựng SQL thật, PGlite thực thi thật; sai tên
// cột ở bất kỳ UPDATE/SELECT nào đều làm test đỏ.
//
// Không cần DATABASE_URL: `@/db` được thay bằng drizzle trên PGlite in-memory
// (cùng pattern với src/lib/catalyst/__tests__/llm-quota.test.ts).
//
// PHẢI chạy qua `npm test` (script đặt NODE_OPTIONS=--experimental-vm-modules):
// PGlite nạp WASM bằng dynamic import, gọi jest trực tiếp sẽ chết với
// ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { topRecommendationPicks } from "@/db/schema";
import { addDaysIso } from "../engine";
import { getBusinessDate } from "@/lib/utils";

let mockDbInstance: unknown;

jest.mock("@/db", () => ({
  get db() {
    return mockDbInstance;
  },
}));

import { runBacktestSettlement } from "../settlement";
import { GET as trackRecordGET } from "@/app/api/track-record/route";

jest.setTimeout(30_000);

const DDL = `
  CREATE TABLE coins (
    id serial PRIMARY KEY,
    symbol varchar(20) NOT NULL,
    name varchar(100) NOT NULL,
    binance_spot_symbol varchar(30),
    binance_futures_symbol varchar(30),
    coingecko_id varchar(100),
    has_futures boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
  );

  CREATE TABLE narratives (
    id serial PRIMARY KEY,
    name varchar(100) NOT NULL
  );

  CREATE TABLE coin_narratives (
    coin_id integer NOT NULL,
    narrative_id integer NOT NULL,
    is_primary boolean NOT NULL DEFAULT false,
    PRIMARY KEY (coin_id, narrative_id)
  );

  CREATE TABLE market_price_daily (
    id serial PRIMARY KEY,
    coin_id integer NOT NULL,
    date date NOT NULL,
    open numeric(24,8) NOT NULL,
    high numeric(24,8) NOT NULL,
    low numeric(24,8) NOT NULL,
    close numeric(24,8) NOT NULL,
    volume numeric(24,2) NOT NULL,
    quote_volume numeric(24,2),
    volume_24h numeric(24,2),
    source varchar(50) NOT NULL DEFAULT 'binance',
    created_at timestamp NOT NULL DEFAULT now()
  );

  CREATE TABLE top_recommendation_picks (
    id serial PRIMARY KEY,
    data_date date NOT NULL,
    coin_id integer NOT NULL,
    symbol varchar(20) NOT NULL,
    slot integer NOT NULL DEFAULT 0,
    pick_kind varchar(20) NOT NULL DEFAULT 'GENUINE',
    direction varchar(10) NOT NULL,
    signal varchar(30) NOT NULL,
    health_score real,
    score_change real,
    current_price numeric(24,8),
    has_setup boolean NOT NULL DEFAULT false,
    entry_low numeric(24,8),
    entry_high numeric(24,8),
    entry_mid numeric(24,8),
    tp1 numeric(24,8),
    tp2 numeric(24,8),
    stop_loss numeric(24,8),
    risk_reward_ratio real,
    tp1_move_pct real,
    sl_risk_pct real,
    atr14 numeric(24,8),
    atr_source varchar(30),
    narrative_name varchar(100),
    metrics jsonb,
    setup_unavailable_reason text,
    picked_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    backtest_status varchar(20) NOT NULL DEFAULT 'PENDING',
    backtest_outcome varchar(20),
    backtest_exit_r real,
    backtest_hit_day integer,
    backtest_mfe_pct real,
    backtest_mae_pct real,
    backtest_entry_filled boolean,
    backtest_horizon_days integer,
    backtest_run_id varchar(40),
    backtest_evaluated_at timestamp,
    repeat_count integer NOT NULL DEFAULT 1,
    last_repeat_at timestamp,
    CONSTRAINT top_rec_picks_unique UNIQUE (data_date, coin_id)
  );

  CREATE TABLE coin_metrics (
    id serial PRIMARY KEY,
    coin_id integer NOT NULL,
    date date NOT NULL,
    open_interest numeric(24,2),
    funding_rate numeric(18,8),
    market_cap numeric(24,2),
    fully_diluted_valuation numeric(24,2),
    circulating_supply numeric(24,2),
    total_supply numeric(24,2),
    source varchar(50) NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
  );

`;

// BT-10: bảng horizon KHÔNG được chép tay ở đây nữa — dùng chính file migration
// sẽ chạy trên production. Nếu migration sai (thiếu cột, sai kiểu, thiếu unique
// index) thì test đỏ ngay, thay vì DDL mirror luôn "đúng" trong khi file thật hỏng.
const MIGRATION_0038 = readFileSync(
  join(process.cwd(), "drizzle/migrations/0038_backtest_horizon_results.sql"),
  "utf8"
);

let client: PGlite;
let pg: ReturnType<typeof drizzle>;
let coinId: number;
const today = getBusinessDate();

// ── BT-13: chạy hai settlement "song song" trên PGlite ────────────────────
// PGlite chỉ có MỘT kết nối, nên hai transaction thật không thể chạy xen kẽ
// như hai connection trên Postgres. Ở đây transaction được xếp hàng (mô phỏng
// việc `pg_advisory_xact_lock` buộc run thứ hai đợi run đầu commit), còn mọi
// câu SQL trong transaction được ghi lại để assert rằng khoá advisory là lệnh
// ĐẦU TIÊN — tức việc đọc PENDING xảy ra sau khoá, không phải trước.
let statementLog: string[] = [];
let txQueue: Promise<unknown> = Promise.resolve();

const sqlText = (query: unknown): string => {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  return chunks
    .map((c) =>
      typeof c === "string" ? c : String((c as { value?: unknown })?.value ?? "")
    )
    .join("");
};

const proxiedTx = (tx: unknown) => {
  const target = tx as Record<string, (...a: unknown[]) => unknown>;
  return {
    select: (...args: unknown[]) => target.select(...args),
    update: (...args: unknown[]) => target.update(...args),
    insert: (...args: unknown[]) => target.insert(...args),
    execute: (query: unknown) => {
      statementLog.push(sqlText(query));
      return target.execute(query);
    },
  };
};

const callPg = (method: string, args: unknown[]): unknown => {
  const target = pg as unknown as Record<string, (...a: unknown[]) => unknown>;
  return target[method](...args);
};

const dbForTest = {
  select: (...args: unknown[]) => callPg("select", args),
  update: (...args: unknown[]) => callPg("update", args),
  insert: (...args: unknown[]) => callPg("insert", args),
  execute: (...args: unknown[]) => callPg("execute", args),
  transaction: (fn: (tx: unknown) => unknown) => {
    const run = txQueue.then(() =>
      (
        pg as unknown as {
          transaction: (f: (tx: unknown) => unknown) => unknown;
        }
      ).transaction((tx) => fn(proxiedTx(tx)))
    );
    txQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  },
};

beforeAll(async () => {
  client = new PGlite();
  await client.exec(DDL);
  // Chạy đúng migration 0038 trên Postgres thật (PGlite), sau bảng picks mà nó
  // tham chiếu — đây là lần duy nhất migration này được kiểm trước khi deploy.
  await client.exec(MIGRATION_0038);
  pg = drizzle(client, { schema });
  mockDbInstance = dbForTest;

  const [coin] = await pg
    .insert(schema.coins)
    .values({ symbol: "BTC", name: "Bitcoin", binanceSpotSymbol: "BTCUSDT" })
    .returning({ id: schema.coins.id });
  coinId = coin.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  statementLog = [];
  txQueue = Promise.resolve();
  await client.query("DELETE FROM top_recommendation_picks");
  await client.query("DELETE FROM market_price_daily");
  await client.query("DELETE FROM coin_metrics");
});

/** Một pick PENDING có setup, đóng window horizon 14 và chạm TP1 ở nến đầu. */
async function seedPendingPick(): Promise<number> {
  const dataDate = addDaysIso(today, -20);
  const [pick] = await pg
    .insert(topRecommendationPicks)
    .values({
      dataDate,
      coinId,
      symbol: "BTC",
      direction: "BULLISH",
      signal: "STRONG_WATCH",
      hasSetup: true,
      entryLow: "99",
      entryHigh: "101",
      entryMid: "100",
      tp1: "110",
      tp2: "120",
      stopLoss: "90",
    })
    .returning({ id: topRecommendationPicks.id });

  // Đủ nến cho 100% coverage (BT_MIN_CANDLE_COVERAGE mặc định): ngày 1 chạm TP1.
  for (let day = 1; day <= 14; day += 1) {
    const high = day === 1 ? "111" : "106";
    const low = day === 1 ? "100.5" : "101";
    const date = addDaysIso(dataDate, day);
    await client.query(
      `INSERT INTO market_price_daily (coin_id, date, open, high, low, close, volume)
       VALUES ($1, $2, '101', $3, $4, '105', '1000')`,
      [coinId, date, high, low]
    );
    // BT-11: funding hằng ngày để kịch bản chi phí thực tế có dữ liệu.
    await client.query(
      `INSERT INTO coin_metrics (coin_id, date, source, funding_rate) VALUES ($1, $2, 'binance', '0.0001')`,
      [coinId, date]
    );
  }
  return pick.id;
}

describe("BT-E2E settlement trên Postgres thật", () => {
  test("PENDING pick đóng window → UPDATE ghi đủ cột, không còn PENDING, errors = 0", async () => {
    const pickId = await seedPendingPick();

    const result = await runBacktestSettlement({ horizon: 14 });
    if (result.dryRun) throw new Error("expected a real settlement run");

    // Sai tên cột trong stamp/UPDATE sẽ bị Postgres từ chối → errors > 0 và
    // pick vẫn PENDING (đúng sự cố thật). Test này khoá chính lớp lỗi đó.
    expect(result.errors).toBe(0);
    expect(result.evaluated).toBe(1);
    expect(result.outcomes).toEqual([
      expect.objectContaining({ pickId, symbol: "BTC", outcome: "TP1_WIN" }),
    ]);

    const { rows } = await client.query<{
      backtest_status: string;
      backtest_outcome: string;
      backtest_exit_r: number;
      backtest_horizon_days: number;
      backtest_run_id: string;
      backtest_evaluated_at: string | null;
      backtest_entry_filled: boolean;
    }>(
      `SELECT backtest_status, backtest_outcome, backtest_exit_r, backtest_horizon_days,
              backtest_run_id, backtest_evaluated_at, backtest_entry_filled
         FROM top_recommendation_picks WHERE id = $1`,
      [pickId]
    );
    const updated = rows[0];

    expect(updated.backtest_status).toBe("EVALUATED");
    expect(updated.backtest_outcome).toBe("TP1_WIN");
    expect(updated.backtest_exit_r).toBe(1); // (110-100)/(100-90)
    expect(updated.backtest_horizon_days).toBe(14);
    expect(updated.backtest_run_id).toBe(result.runId);
    expect(updated.backtest_evaluated_at).not.toBeNull();
    expect(updated.backtest_entry_filled).toBe(true);

    // BT-10: append-only cho mọi horizon đã đóng window. dataDate = hôm nay − 20
    // nên chỉ 7d và 14d đóng; 30d/60d còn mở → chưa có dòng nào.
    const horizonRows = await client.query<{ horizon_days: number; outcome: string; exit_r: number }>(
      `SELECT horizon_days, outcome, exit_r FROM backtest_horizon_results
        WHERE pick_id = $1 ORDER BY horizon_days`,
      [pickId]
    );
    expect(horizonRows.rows).toEqual([
      { horizon_days: 7, outcome: "TP1_WIN", exit_r: 1 },
      { horizon_days: 14, outcome: "TP1_WIN", exit_r: 1 },
    ]);
  });

  test("migration 0038 chạy được trên Postgres thật: đủ cột, FK cascade và index", async () => {
    const cols = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'backtest_horizon_results'
        ORDER BY ordinal_position`
    );
    expect(cols.rows).toEqual([
      { column_name: "id", data_type: "integer", is_nullable: "NO" },
      { column_name: "pick_id", data_type: "integer", is_nullable: "NO" },
      { column_name: "horizon_days", data_type: "integer", is_nullable: "NO" },
      { column_name: "outcome", data_type: "character varying", is_nullable: "NO" },
      { column_name: "exit_r", data_type: "real", is_nullable: "YES" },
      { column_name: "hit_day", data_type: "integer", is_nullable: "YES" },
      { column_name: "entry_filled", data_type: "boolean", is_nullable: "YES" },
      { column_name: "run_id", data_type: "character varying", is_nullable: "YES" },
      { column_name: "evaluated_at", data_type: "timestamp without time zone", is_nullable: "NO" },
    ]);

    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'backtest_horizon_results' ORDER BY indexname`
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      "backtest_horizon_results_pkey",
      "bt_horizon_results_horizon_idx",
      "bt_horizon_results_unique",
    ]);

    // FK ON DELETE CASCADE: xoá pick thì kết quả horizon đi theo.
    const fk = await client.query<{ delete_rule: string; table: string }>(
      `SELECT rc.delete_rule, cc.relname AS table
         FROM pg_constraint c
         JOIN pg_class cc ON cc.oid = c.confrelid
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_name = c.conname
        WHERE c.conrelid = 'backtest_horizon_results'::regclass AND c.contype = 'f'`
    );
    expect(fk.rows).toEqual([{ delete_rule: "CASCADE", table: "top_recommendation_picks" }]);
  });

  test("settlement chạy lại lần hai không tạo dòng horizon trùng", async () => {
    await seedPendingPick();
    const first = await runBacktestSettlement({ horizon: 14 });
    if (first.dryRun) throw new Error("expected a real settlement run");
    expect(first.evaluated).toBe(1);

    const countRows = async () => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM backtest_horizon_results`
      );
      return rows[0].n;
    };
    expect(await countRows()).toBe(2); // 7d + 14d, 30d/60d còn mở

    // Lần hai: pick đã EVALUATED nên không còn PENDING → không chốt lại.
    const second = await runBacktestSettlement({ horizon: 14 });
    if (second.dryRun) throw new Error("expected a real settlement run");
    expect(second.pendingBefore).toBe(0);
    expect(second.evaluated).toBe(0);
    expect(await countRows()).toBe(2);

    // Mô phỏng run trước bị rollback sau khi đã ghi horizon (retry): đưa pick
    // về PENDING rồi chốt lại — ON CONFLICT DO NOTHING + unique index phải giữ
    // nguyên 1 dòng cho mỗi (pick, horizon), không nhân đôi số liệu.
    await client.query(
      `UPDATE top_recommendation_picks SET backtest_status = 'PENDING' WHERE id = $1`,
      [first.outcomes[0].pickId]
    );
    const retry = await runBacktestSettlement({ horizon: 14 });
    if (retry.dryRun) throw new Error("expected a real settlement run");
    expect(retry.evaluated).toBe(1);
    expect(await countRows()).toBe(2);

    const { rows } = await client.query<{ horizon_days: number; n: number }>(
      `SELECT horizon_days, count(*)::int AS n FROM backtest_horizon_results
        GROUP BY horizon_days ORDER BY horizon_days`
    );
    expect(rows).toEqual([
      { horizon_days: 7, n: 1 },
      { horizon_days: 14, n: 1 },
    ]);
  });

  test("BT-13: hai run song song không cùng chốt một pick", async () => {
    const pickId = await seedPendingPick();

    // Hai lần refresh chạy đồng thời (scheduler + bấm tay) — cùng đọc PENDING.
    const [a, b] = await Promise.all([
      runBacktestSettlement({ horizon: 14 }),
      runBacktestSettlement({ horizon: 14 }),
    ]);
    if (a.dryRun || b.dryRun) throw new Error("expected two real settlement runs");

    // Không run nào lỗi: khoá advisory + transaction chạy được trên Postgres thật.
    expect(a.errors).toBe(0);
    expect(b.errors).toBe(0);

    // Đúng MỘT run chốt pick; run còn lại thấy 0 PENDING và không ghi gì.
    expect(a.evaluated + b.evaluated).toBe(1);
    expect([a.evaluated, b.evaluated].filter((n) => n === 1)).toHaveLength(1);
    const second = a.evaluated === 0 ? a : b;
    expect(second.pendingBefore).toBe(0);
    expect(second.evaluated + second.expired + second.skipped).toBe(0);
    expect(second.outcomes).toHaveLength(0);

    // Khoá phải được lấy ở đầu MỖI transaction, trước khi đọc PENDING.
    expect(statementLog[0]).toContain("pg_advisory_xact_lock");
    expect(
      statementLog.filter((s) => s.includes("pg_advisory_xact_lock"))
    ).toHaveLength(2);

    // DB: pick chỉ được chốt một lần (một run_id, một dòng horizon 14).
    const { rows } = await client.query<{
      backtest_status: string;
      backtest_run_id: string;
    }>(
      `SELECT backtest_status, backtest_run_id FROM top_recommendation_picks WHERE id = $1`,
      [pickId]
    );
    expect(rows[0].backtest_status).toBe("EVALUATED");
    expect([a.runId, b.runId]).toContain(rows[0].backtest_run_id);

    const horizonRows = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM backtest_horizon_results WHERE pick_id = $1 AND horizon_days = 14`,
      [pickId]
    );
    expect(horizonRows.rows[0].n).toBe(1);
  });

  test("đọc track-record sau settlement: số liệu, fill rate và freshness đúng", async () => {
    await seedPendingPick();
    const settled = await runBacktestSettlement({ horizon: 14 });
    if (settled.dryRun) throw new Error("expected a real settlement run");
    expect(settled.errors).toBe(0);

    // BT-07c: basket equal-weight cần ≥ 2 coin có nến gần cả hai đầu cửa sổ.
    // BTC chỉ có nến trong window 14 ngày của pick cũ nên bổ sung tới hôm nay
    // (nến sau window không đổi outcome đã chốt).
    for (let offset = 5; offset >= 0; offset -= 1) {
      await client.query(
        `INSERT INTO market_price_daily (coin_id, date, open, high, low, close, volume)
         VALUES ($1, $2, '105', '106', '101', '105', '1000')`,
        [coinId, addDaysIso(today, -offset)]
      );
    }
    const [eth] = await pg
      .insert(schema.coins)
      .values({ symbol: "ETH", name: "Ethereum" })
      .returning({ id: schema.coins.id });
    for (let offset = 20; offset >= 0; offset -= 1) {
      await client.query(
        `INSERT INTO market_price_daily (coin_id, date, open, high, low, close, volume)
         VALUES ($1, $2, '2000', '2100', '1950', $3, '500')`,
        [eth.id, addDaysIso(today, -offset), String(2000 + (20 - offset) * 5)]
      );
    }

    // Pick đã chốt hôm nay để lastDate/lastEvaluatedAt tươi — nếu không, pick
    // 20 ngày tuổi một mình sẽ bị freshness báo `pick-pipeline-old`.
    await pg.insert(topRecommendationPicks).values({
      dataDate: today,
      coinId,
      symbol: "ETH",
      direction: "BEARISH",
      signal: "WATCH",
      hasSetup: true,
      entryLow: "2100",
      entryHigh: "2150",
      entryMid: "2125",
      tp1: "2000",
      tp2: "1900",
      stopLoss: "2250",
      backtestStatus: "EVALUATED",
      backtestOutcome: "SL_LOSS",
      backtestExitR: -1,
      backtestHorizonDays: 14,
      backtestEntryFilled: true,
      backtestEvaluatedAt: new Date(),
    });

    const response = await trackRecordGET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        summary: {
          totals: { picks: number; trades: number; wins: number; losses: number };
          winRate: number | null;
          totalRNet: number;
          maxDrawdownR: number;
          sharpePerTrade: number | null;
          marRatio: number | null;
          sample: { trades: number; episodes: number; sufficient: boolean; reason: string | null };
          drawdown: {
            maxR: number;
            maxDays: number | null;
            currentR: number;
            currentFromDate: string | null;
          };
          alpha: {
            strategyPct: number;
            benchmarkPct: number;
            deltaPct: number;
            deltaCI: { lo: number; hi: number } | null;
            probOutperform: number | null;
          } | null;
          fill: { known: number; filled: number; rate: number | null; filledWinRate: number | null };
        };
        split: {
          liveSince: string | null;
          liveSinceSource: "env" | "derived" | null;
          forwardPicks: number;
          backfilledPicks: number;
          unknownPicks: number;
          lagGraceDays: number;
          summary: {
            totals: { picks: number; trades: number };
            totalRNet: number;
            winRate: number | null;
          } | null;
          benchmark: { from: string; returnPct: number } | null;
        };
        freshness: {
          stale: boolean;
          reason: string | null;
          settlementAgeDays: number | null;
          pickAgeDays: number | null;
          today: string;
        };
        benchmark: {
          method: string;
          from: string;
          returnPct: number;
          constituents: number;
          excluded: number;
        } | null;
        btc: { method: string; returnPct: number } | null;
        meta: {
          window: { capped: boolean; rowsRead: number; limit: number; oldestIncluded: string | null };
        };
        horizons: { days: number; picks: number; trades: number; winRate: number | null }[];
        realistic: {
          trades: number;
          avgRNet: number | null;
          totalRNet: number;
          deltaVsBase: number;
          fundingCovered: number;
        } | null;
      };
    };

    expect(body.success).toBe(true);
    // Pick TP1_WIN từ settlement + SL_LOSS insert tay — cả hai đều đọc được qua
    // đúng các cột route select (backtest_entry_filled, backtest_horizon_days...).
    expect(body.data.summary.totals).toMatchObject({ picks: 2, trades: 2, wins: 1, losses: 1 });
    expect(body.data.summary.winRate).toBe(50);
    // BT-07b: đọc được field mới từ route thật. Net R đã trừ phí của cả hai
    // lệnh (+0.99R / −1.02R) nên kỳ vọng xấp xỉ 0 → Sharpe ≈ 0; MAR phải bằng
    // đúng định nghĩa tổng net R / |max drawdown|.
    expect(body.data.summary.sharpePerTrade).toBeCloseTo(0, 1);
    expect(body.data.summary.marRatio).toBeCloseTo(
      body.data.summary.totalRNet / Math.abs(body.data.summary.maxDrawdownR),
      2
    );
    expect(body.data.summary.fill).toMatchObject({
      known: 2,
      filled: 2,
      rate: 100,
      filledWinRate: 50,
    });

    // FORWARD-01: pick BTC có data_date 20 ngày trước nhưng picked_at hôm nay →
    // đó là backfill; pick ETH ghi hôm nay cho ngày hôm nay → forward. Bằng
    // chứng forward chỉ gồm 1 lệnh, dù toàn bộ lịch sử có 2.
    expect(body.data.split).toMatchObject({
      liveSince: today,
      liveSinceSource: "derived",
      forwardPicks: 1,
      backfilledPicks: 1,
      unknownPicks: 0,
      lagGraceDays: 1,
    });
    expect(body.data.split.summary!.totals).toMatchObject({ picks: 1, trades: 1 });
    // Lệnh forward duy nhất là ETH SL → tổng net R âm, win rate 0%.
    expect(body.data.split.summary!.totalRNet).toBeLessThan(0);
    expect(body.data.split.summary!.winRate).toBe(0);
    // Cốt lõi: backfill không được trộn vào headline forward.
    expect(body.data.split.summary!.totals.trades).toBeLessThan(body.data.summary.totals.trades);

    // LIVE_SINCE tường minh: mốc ở tương lai → chưa pick nào sinh ra sau live,
    // khối forward rỗng và mốc lấy từ env chứ không suy ra.
    process.env.LIVE_SINCE = addDaysIso(today, 1);
    try {
      const gated = (await (await trackRecordGET()).json()) as {
        data: {
          split: {
            liveSince: string | null;
            liveSinceSource: string | null;
            forwardPicks: number;
            backfilledPicks: number;
            summary: unknown | null;
          };
        };
      };
      expect(gated.data.split).toMatchObject({
        liveSince: addDaysIso(today, 1),
        liveSinceSource: "env",
        forwardPicks: 0,
        backfilledPicks: 2,
        summary: null,
      });
    } finally {
      delete process.env.LIVE_SINCE;
    }

    // FRESH-01 exposed cho uptime-check: record vừa được chốt hôm nay → không stale.
    expect(body.data.freshness).toMatchObject({
      stale: false,
      reason: null,
      settlementAgeDays: 0,
      pickAgeDays: 0,
      today,
    });

    // BT-10: bảng horizon đọc từ bảng append-only (pick ETH insert tay không có).
    expect(body.data.horizons).toEqual([
      { days: 7, picks: 1, trades: 1, wins: 1, losses: 0, winRate: 100, avgRGross: 1 },
      { days: 14, picks: 1, trades: 1, wins: 1, losses: 0, winRate: 100, avgRGross: 1 },
    ]);

    // BT-07c: benchmark chính là basket equal-weight của universe trong cửa
    // sổ giao dịch (BTC + ETH), không còn phụ thuộc một coin; BTC vẫn riêng.
    expect(body.data.benchmark).toMatchObject({
      method: "equal_weight",
      from: addDaysIso(today, -20),
      constituents: 2,
      excluded: 0,
    });
    expect(body.data.btc).toMatchObject({ method: "buy_hold" });

    // SAMPLE-01: 2 lệnh chưa đủ ngưỡng công bố kết luận (mặc định 30/5).
    expect(body.data.summary.sample).toMatchObject({
      trades: 2,
      sufficient: false,
      reason: "thin-sample",
    });

    // ALPHA-01: alpha đọc từ route thật, benchmark = basket đã công bố.
    expect(body.data.summary.alpha).toMatchObject({
      benchmarkPct: body.data.benchmark!.returnPct,
      strategyPct: body.data.summary.totalRNet,
    });
    expect(body.data.summary.alpha!.deltaPct).toBeCloseTo(
      body.data.summary.totalRNet - body.data.benchmark!.returnPct,
      2
    );

    // DD-01: hai lệnh cùng chốt hôm nay → đang underwater so với đỉnh, 0 ngày.
    expect(body.data.summary.drawdown).toMatchObject({
      maxR: body.data.summary.maxDrawdownR,
      maxDays: 0,
      currentFromDate: today,
    });
    expect(body.data.summary.drawdown.currentR).toBeLessThanOrEqual(0);

    // WINDOW-01: chưa chạm MAX_ROWS → minh bạch "không bị cắt".
    expect(body.data.meta.window).toEqual({
      capped: false,
      rowsRead: 2,
      limit: 4000,
      oldestIncluded: addDaysIso(today, -20),
    });

    // BT-11: kịch bản chi phí thực tế đọc coin_metrics thật (BTC có funding,
    // ETH không) — thêm funding chỉ làm chi phí tăng, không làm đẹp số.
    expect(body.data.realistic).toMatchObject({ trades: 2, fundingCovered: 1 });
    expect(body.data.realistic!.deltaVsBase).toBeLessThanOrEqual(0);
  });
});
