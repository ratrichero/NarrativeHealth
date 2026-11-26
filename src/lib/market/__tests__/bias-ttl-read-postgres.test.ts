// TTL-READ E2E — `readBiasHoldRuns`/`readMeasuredBiasTtl` chạy trên Postgres
// THẬT (PGlite) với bảng `radar_bias_log` thật (migration 0037).
//
// Đây là phần I/O duy nhất của thay đổi TTL: phần tính trung vị/ kẹp 4–72h đã
// có test thuần, nhưng "đọc đúng cửa sổ, đúng trần dòng, đúng khoá symbol+side"
// chỉ Postgres trả lời được. Test cũ mock `@/db` nên LIMIT hay điều kiện
// `logged_at >= since` sai vẫn xanh.
//
// PHẢI chạy qua `npm test` (NODE_OPTIONS=--experimental-vm-modules): PGlite nạp
// WASM bằng dynamic import.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

let mockDbInstance: unknown;

jest.mock("@/db", () => ({
  get db() {
    return mockDbInstance;
  },
}));

import {
  TTL_MAX_ROWS,
  TTL_WINDOW_DAYS,
  readBiasHoldRuns,
  readMeasuredBiasTtl,
  resetMeasuredBiasTtlCache,
  toTtlPayload,
} from "../bias-ttl-read";
import { BIAS_TTL_HOURS, MIN_TTL_RUNS } from "../bias-ttl";

jest.setTimeout(120_000);

const MIGRATION_0037 = readFileSync(
  join(process.cwd(), "drizzle/migrations/0037_radar_bias_log.sql"),
  "utf8"
);

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-21T00:00:00Z");
const DAY = 86_400_000;

let client: PGlite;
let pg: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(MIGRATION_0037);
  pg = drizzle(client, { schema });
  mockDbInstance = pg;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.query("DELETE FROM radar_bias_outcome");
  await client.query("DELETE FROM radar_bias_log");
  resetMeasuredBiasTtlCache();
});

/** Một lần chấm bias (các cột NOT NULL tối thiểu của radar_bias_log). */
async function insertLog(input: {
  symbol: string;
  bias: string;
  at: string;
  side?: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO radar_bias_log
       (logged_at, symbol, side, price, bias, score, entry_quality)
     VALUES ($1, $2, $3, 100, $4, 60, 55)`,
    [input.at, input.symbol, input.side ?? "gainer", input.bias]
  );
}

/**
 * `runs` run ĐÃ ĐÓNG giữ nhãn cho một bias: mỗi run là một symbol riêng (khoá
 * run là symbol+side), bắt đầu bằng `bias` và kết thúc bằng một nhãn KHÁC sau
 * `hours`. TTL đo khoảng từ lần chấm cuối của nhãn cũ tới lần chấm đầu của nhãn
 * mới, nên mỗi run đo đúng `hours`.
 */
async function seedRuns(
  bias: string,
  runs: number,
  hours: number,
  startedAt: number
): Promise<void> {
  const nextBias = bias === "neutral" ? "continuation" : "neutral";
  for (let index = 0; index < runs; index += 1) {
    const symbol = `${bias.slice(0, 4).toUpperCase()}${index}`;
    await insertLog({ symbol, bias, at: new Date(startedAt).toISOString() });
    await insertLog({
      symbol,
      bias: nextBias,
      at: new Date(startedAt + hours * HOUR).toISOString(),
    });
  }
}

describe("bias TTL — đọc radar_bias_log trên Postgres thật", () => {
  test("≥10 run đo được → TTL lấy trung vị thay bảng tĩnh", async () => {
    // 12 run, mỗi run giữ nhãn 6h — trong khi bảng tĩnh cho "kiệt sức" 8h.
    await seedRuns("exhaustion", 12, 6, NOW - 20 * DAY);

    const ttl = await readMeasuredBiasTtl({ now: NOW });

    expect(ttl.days).toBe(TTL_WINDOW_DAYS);
    expect(ttl.since).toBe(new Date(NOW - TTL_WINDOW_DAYS * DAY).toISOString());
    expect(ttl.estimates.exhaustion).toMatchObject({
      source: "measured",
      measuredHours: 6,
      samples: 12,
      staticHours: BIAS_TTL_HOURS.exhaustion,
    });
    // Badge dùng map này: 6h, không phải 8h.
    expect(ttl.hours.exhaustion).toBe(6);
    expect(ttl.anyMeasured).toBe(true);

    // Payload gửi ra UI phải mang theo NGUỒN, để badge không hiển thị một con
    // số đo được y như số viết tay.
    expect(toTtlPayload(ttl).exhaustion).toEqual({
      hours: 6,
      source: "measured",
      samples: 12,
    });

    // Run đọc thô cũng đúng: 12 run, mỗi run đúng 6h.
    const runs = await readBiasHoldRuns(new Date(NOW - TTL_WINDOW_DAYS * DAY));
    expect(runs).toHaveLength(12);
    expect(runs.every((run) => run.hours === 6)).toBe(true);
  });

  test("3 run < ngưỡng mẫu → rơi về bảng tĩnh, không lấy trung vị", async () => {
    await seedRuns("breakout", 3, 3, NOW - 5 * DAY);

    const ttl = await readMeasuredBiasTtl({ now: NOW });

    expect(ttl.estimates.breakout).toMatchObject({
      source: "static",
      measuredHours: null,
      samples: 3,
    });
    expect(ttl.hours.breakout).toBe(BIAS_TTL_HOURS.breakout);
    expect(ttl.anyMeasured).toBe(false);
    // Nguồn `static` đi kèm số run thật (3) để tooltip nói được vì sao chưa đo.
    expect(toTtlPayload(ttl).breakout).toEqual({
      hours: BIAS_TTL_HOURS.breakout,
      source: "static",
      samples: 3,
    });
  });

  test("đo từ lần chấm cuối tới lần lật, bỏ run chưa đóng", async () => {
    // BTCX: hai lần chấm "kiệt sức" (0h, 5h) rồi lật sang "neutral" ở 6h.
    // Cách cũ (0h → 5h) báo 5h; cách đúng (5h → 6h) là 1h.
    await insertLog({ symbol: "BTCX", bias: "exhaustion", at: new Date(NOW - 10 * HOUR).toISOString() });
    await insertLog({ symbol: "BTCX", bias: "exhaustion", at: new Date(NOW - 5 * HOUR).toISOString() });
    await insertLog({ symbol: "BTCX", bias: "neutral", at: new Date(NOW - 4 * HOUR).toISOString() });
    // ETHX: vẫn giữ "kiệt sức" tới hết log → run mở, không được đếm.
    await insertLog({ symbol: "ETHX", bias: "exhaustion", at: new Date(NOW - 6 * HOUR).toISOString() });
    await insertLog({ symbol: "ETHX", bias: "exhaustion", at: new Date(NOW - 1 * HOUR).toISOString() });

    const runs = await readBiasHoldRuns(new Date(NOW - TTL_WINDOW_DAYS * DAY));
    expect(runs).toEqual([{ bias: "exhaustion", hours: 1 }]);

    // 1 run < ngưỡng mẫu → badge/ bảng vẫn dùng bảng tĩnh, nhưng `samples` nói
    // đúng số run đã đóng (không tính run mở của ETHX).
    const ttl = await readMeasuredBiasTtl({ now: NOW });
    expect(ttl.estimates.exhaustion).toMatchObject({ samples: 1, source: "static" });
    expect(ttl.hours.exhaustion).toBe(BIAS_TTL_HOURS.exhaustion);
  });

  test("cửa sổ `since`: run cũ hơn 30 ngày không được tính, dù đủ mẫu", async () => {
    // 12 run "kiệt sức" nhưng ở 40 ngày trước → ngoài cửa sổ 30 ngày.
    await seedRuns("exhaustion", 12, 6, NOW - 40 * DAY);
    // Một run "breakout" mới, nằm trong cửa sổ.
    await seedRuns("breakout", 1, 6, NOW - 1 * DAY);

    const since = new Date(NOW - TTL_WINDOW_DAYS * DAY);
    const runs = await readBiasHoldRuns(since);
    expect(runs).toEqual([{ bias: "breakout", hours: 6 }]);

    const ttl = await readMeasuredBiasTtl({ now: NOW });
    expect(ttl.estimates.exhaustion).toMatchObject({ samples: 0, source: "static" });
    expect(ttl.hours.exhaustion).toBe(BIAS_TTL_HOURS.exhaustion);
    expect(ttl.estimates.breakout).toMatchObject({ samples: 1, source: "static" });
    expect(ttl.anyMeasured).toBe(false);
  });

  test("trần dòng: run nằm sau TTL_MAX_ROWS không được đọc", async () => {
    // Một run đóng được dựng từ đúng 2 row (lần chấm nhãn cũ + lần chấm nhãn kế
    // tiếp lúc lật), nên số run đọc được = số row lọt trần / 2.
    const ROWS_PER_CLOSED_RUN = 2;
    // Số run "đuôi" cố ý đẩy ra sau trần; chỉ một nửa trong số đó lọt vào.
    const TAIL_RUNS = 10;
    const VISIBLE_TAIL_RUNS = 5;
    expect(VISIBLE_TAIL_RUNS).toBeLessThan(TAIL_RUNS);
    expect(VISIBLE_TAIL_RUNS).toBeLessThan(MIN_TTL_RUNS);
    // Mọi con số row suy từ TTL_MAX_ROWS: row lấp chiếm phần trần còn lại sau
    // khi chừa chỗ cho VISIBLE_TAIL_RUNS run đuôi. Đổi trần → test tự theo.
    const fillerRows = TTL_MAX_ROWS - VISIBLE_TAIL_RUNS * ROWS_PER_CLOSED_RUN;

    // Bước thời gian giữa hai row lấp. Bước phải đủ nhỏ để TOÀN BỘ row lấp nằm
    // trong `since`: nếu `logged_at >= since` cắt mất phần lớn row thì trần
    // dòng không bao giờ được chạm và test xanh giả. 40 giây là bước lớn nhất
    // còn dư nhiều: 40s × 49 990 ≈ 23,1 ngày < cửa sổ 30 ngày (~23% dư), đủ
    // chỗ cho row cuối đặt ở NOW-1h. Giãn 1 giờ/bước thì cửa sổ chỉ chứa ~720
    // row — thừa chỗ, không chạm trần. `Math.min` giữ bất biến "vừa cửa sổ" khi
    // TTL_MAX_ROWS đổi: trần lớn hơn → bước tự nhỏ lại theo.
    const windowSeconds = (TTL_WINDOW_DAYS * DAY) / 1000;
    const fillerStepSeconds = Math.max(
      1,
      Math.min(40, Math.floor(windowSeconds / Math.max(1, fillerRows)))
    );

    await client.query(
      `INSERT INTO radar_bias_log
         (logged_at, symbol, side, price, bias, score, entry_quality)
       SELECT $1::timestamptz - (g * $2 || ' seconds')::interval, 'AAA', 'gainer', 100, 'exhaustion', 60, 55
       FROM generate_series(1, $3::int) AS g`,
      [new Date(NOW - HOUR).toISOString(), fillerStepSeconds, fillerRows]
    );
    // Run đuôi mang symbol "BREA…" — xếp SAU "AAA" trong ORDER BY symbol, nên
    // nằm sau trần nếu trần không được áp.
    await seedRuns("breakout", TAIL_RUNS, 6, NOW - 2 * DAY);

    // fillerRows + 2 × TAIL_RUNS row > trần: chỉ 10 row đầu của nhóm BREA… lọt.
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM radar_bias_log`
    );
    expect(rows[0].n).toBe(fillerRows + TAIL_RUNS * ROWS_PER_CLOSED_RUN);
    expect(rows[0].n).toBeGreaterThan(TTL_MAX_ROWS);

    const ttl = await readMeasuredBiasTtl({ now: NOW });

    // Chỉ đọc được VISIBLE_TAIL_RUNS run trọn trong TAIL_RUNS run có thật → vẫn
    // dưới ngưỡng mẫu, nên TTL "breakout" phải là bảng tĩnh. Nếu LIMIT bị bỏ,
    // samples sẽ là TAIL_RUNS và TTL thành số đo.
    expect(ttl.estimates.breakout).toMatchObject({ samples: VISIBLE_TAIL_RUNS, source: "static" });
    expect(ttl.hours.breakout).toBe(BIAS_TTL_HOURS.breakout);

    // Và đúng VISIBLE_TAIL_RUNS run được dựng từ số lần lật nhãn đọc được; run
    // AAA (toàn "exhaustion", chưa lật) là run mở nên bị bỏ, không đoán 0h.
    const runs = await readBiasHoldRuns(new Date(NOW - TTL_WINDOW_DAYS * DAY));
    expect(runs).toHaveLength(VISIBLE_TAIL_RUNS);
    expect(runs.every((run) => run.bias === "breakout" && run.hours === 6)).toBe(true);
  });
});
