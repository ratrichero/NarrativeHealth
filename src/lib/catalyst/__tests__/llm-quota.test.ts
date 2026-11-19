// RADAR-06 — quota LLM/ngày: cấp lượt bằng MỘT câu UPSERT atomic (không đọc-rồi-ghi)
// và hoàn lượt khi output bị validator loại.
//
// Test chạy câu SQL thật trên PGlite (Postgres in-memory), thay `db` module-level
// bằng executor của PGlite để không cần DATABASE_URL.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  catalystLlmDailyLimit,
  consumeCatalystLlmQuota,
  releaseCatalystLlmQuota,
} from "@/lib/catalyst/llm-quota";

let executeOnDb: (query: unknown) => Promise<{ rows: unknown[] }>;

jest.mock("@/db", () => ({
  db: { execute: (query: unknown) => executeOnDb(query) },
}));

const DATE = "2026-11-18";
const AT = new Date(`${DATE}T10:00:00Z`);

let client: PGlite;
let pg: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = new PGlite();
  pg = drizzle(client);
  await client.query(`
    CREATE TABLE app_settings (
      key varchar(100) PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  executeOnDb = async (query) => {
    const result = await pg.execute(query as Parameters<typeof pg.execute>[0]);
    return { rows: result.rows as unknown[] };
  };
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.query("DELETE FROM app_settings");
});

async function usage(): Promise<{ date: string; used: number } | null> {
  const result = await client.query<{ value: { date: string; used: number } }>(
    "SELECT value FROM app_settings WHERE key = 'catalyst.llm.usage'"
  );
  return result.rows[0]?.value ?? null;
}

describe("consumeCatalystLlmQuota", () => {
  it("cấp lượt tăng dần và dừng đúng trần, không ghi vượt", async () => {
    for (let i = 1; i <= 3; i += 1) {
      const decision = await consumeCatalystLlmQuota(3, AT);
      expect(decision).toMatchObject({ allowed: true, used: i, remaining: 3 - i });
    }

    const denied = await consumeCatalystLlmQuota(3, AT);
    expect(denied).toMatchObject({ allowed: false, reason: "limit", remaining: 0 });
    expect((await usage())?.used).toBe(3);
  });

  it("request đồng thời chỉ cấp đúng số lượt còn lại", async () => {
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => consumeCatalystLlmQuota(3, AT))
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
    expect((await usage())?.used).toBe(3);
  });

  it("sang ngày UTC mới thì reset về 1 dù hôm qua đã chạm trần", async () => {
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('catalyst.llm.usage', '{"date":"2026-11-17","used":200}'::jsonb)`
    );

    const decision = await consumeCatalystLlmQuota(5, AT);

    expect(decision).toMatchObject({ allowed: true, used: 1, remaining: 4 });
    expect(await usage()).toEqual({ date: DATE, used: 1 });
  });

  it("state lưu hỏng (không phải object/số) không làm hỏng quota", async () => {
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('catalyst.llm.usage', '"junk"'::jsonb)`
    );
    expect(await consumeCatalystLlmQuota(5, AT)).toMatchObject({ allowed: true, used: 1 });

    await client.query("DELETE FROM app_settings");
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('catalyst.llm.usage', '{"date":"${DATE}","used":"x"}'::jsonb)`
    );
    expect(await consumeCatalystLlmQuota(5, AT)).toMatchObject({ allowed: true, used: 1 });
  });

  it("used quá lớn (overflow ::int) không làm sập quota", async () => {
    await client.query(
      `INSERT INTO app_settings (key, value) VALUES ('catalyst.llm.usage', '{"date":"${DATE}","used":99999999999}'::jsonb)`
    );

    // Regex chặn ở 9 chữ số → giá trị rác được coi là 0, không ném lỗi cast.
    const decision = await consumeCatalystLlmQuota(5, AT);

    expect(decision).toMatchObject({ allowed: true, used: 1 });
    expect(await usage()).toEqual({ date: DATE, used: 1 });
  });

  it("limit 0 = không giới hạn và không ghi usage", async () => {
    const decision = await consumeCatalystLlmQuota(0, AT);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(Number.POSITIVE_INFINITY);
    expect(await usage()).toBeNull();
  });

  it("DB lỗi → fail-closed (reason storage)", async () => {
    const original = executeOnDb;
    executeOnDb = async () => {
      throw new Error("db down");
    };
    try {
      const decision = await consumeCatalystLlmQuota(5, AT);
      expect(decision).toMatchObject({ allowed: false, reason: "storage" });
    } finally {
      executeOnDb = original;
    }
  });
});

describe("releaseCatalystLlmQuota", () => {
  it("hoàn đúng 1 lượt của hôm nay", async () => {
    await consumeCatalystLlmQuota(5, AT);
    await consumeCatalystLlmQuota(5, AT);

    expect(await releaseCatalystLlmQuota(DATE)).toBe(true);
    expect((await usage())?.used).toBe(1);
  });

  it("không hoàn xuống dưới 0 và không đụng ngày khác", async () => {
    await consumeCatalystLlmQuota(5, AT);

    expect(await releaseCatalystLlmQuota("2026-11-17")).toBe(false);
    expect((await usage())?.used).toBe(1);

    expect(await releaseCatalystLlmQuota(DATE)).toBe(true);
    expect(await releaseCatalystLlmQuota(DATE)).toBe(false);
    expect((await usage())?.used).toBe(0);
  });
});

describe("catalystLlmDailyLimit", () => {
  const original = process.env.CATALYST_LLM_DAILY_LIMIT;

  afterEach(() => {
    if (original === undefined) delete process.env.CATALYST_LLM_DAILY_LIMIT;
    else process.env.CATALYST_LLM_DAILY_LIMIT = original;
  });

  it("mặc định 200, nhận số hợp lệ, giá trị lạ quay về mặc định", () => {
    delete process.env.CATALYST_LLM_DAILY_LIMIT;
    expect(catalystLlmDailyLimit()).toBe(200);

    process.env.CATALYST_LLM_DAILY_LIMIT = "50";
    expect(catalystLlmDailyLimit()).toBe(50);

    process.env.CATALYST_LLM_DAILY_LIMIT = "0";
    expect(catalystLlmDailyLimit()).toBe(0);

    process.env.CATALYST_LLM_DAILY_LIMIT = "abc";
    expect(catalystLlmDailyLimit()).toBe(200);
  });
});
