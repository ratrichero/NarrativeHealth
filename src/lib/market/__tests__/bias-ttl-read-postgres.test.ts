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
} from "../bias-ttl-read";
import { BIAS_TTL_HOURS } from "../bias-ttl";

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
 * `runs` run giữ nhãn cho một bias: mỗi run là một symbol riêng (khoá run là
 * symbol+side) với hai lần chấm cách nhau `hours`.
 */
async function seedRuns(
  bias: string,
  runs: number,
  hours: number,
  startedAt: number
): Promise<void> {
  for (let index = 0; index < runs; index += 1) {
    const symbol = `${bias.slice(0, 4).toUpperCase()}${index}`;
    await insertLog({ symbol, bias, at: new Date(startedAt).toISOString() });
    await insertLog({ symbol, bias, at: new Date(startedAt + hours * HOUR).toISOString() });
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
    // 49 990 row của một symbol duy nhất (đứng đầu alphabet) → một run dài.
    // Bước 40 giây để cả 49 990 row nằm TRONG cửa sổ 30 ngày (~23 ngày); nếu
    // giãn theo giờ thì phần lớn rơi ra ngoài `since` và trần dòng không bao
    // giờ chạm tới.
    await client.query(
      `INSERT INTO radar_bias_log
         (logged_at, symbol, side, price, bias, score, entry_quality)
       SELECT $1::timestamptz - (g * 40 || ' seconds')::interval, 'AAA', 'gainer', 100, 'exhaustion', 60, 55
       FROM generate_series(1, 49990) AS g`,
      [new Date(NOW - HOUR).toISOString()]
    );
    // 10 run "breakout" 6h, symbol Z… → nằm sau trần nếu trần không được áp.
    await seedRuns("breakout", 10, 6, NOW - 2 * DAY);

    // 49 990 + 20 row > trần 50 000: chỉ 10 row đầu của nhóm Z… lọt vào.
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM radar_bias_log`
    );
    expect(rows[0].n).toBeGreaterThan(TTL_MAX_ROWS);
    expect(TTL_MAX_ROWS).toBe(50_000);

    const ttl = await readMeasuredBiasTtl({ now: NOW });

    // Chỉ đọc được 5 run trọn (10 row) trong 10 run có thật → vẫn dưới ngưỡng
    // 10 mẫu, nên TTL "breakout" phải là bảng tĩnh. Nếu LIMIT bị bỏ, samples
    // sẽ là 10 và TTL thành số đo.
    expect(ttl.estimates.breakout).toMatchObject({ samples: 5, source: "static" });
    expect(ttl.hours.breakout).toBe(BIAS_TTL_HOURS.breakout);

    // Và đúng 6 run được dựng: 1 run AAA + 5 run Z… trọn vẹn.
    const runs = await readBiasHoldRuns(new Date(NOW - TTL_WINDOW_DAYS * DAY));
    expect(runs).toHaveLength(6);
  });
});
