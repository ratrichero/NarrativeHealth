// RADAR-06-STALE — phát hiện feed chết âm thầm (pure, không DB/mạng).
import {
  CATALYST_STALE_ZERO_RUNS,
  buildCatalystStaleMessage,
  catalystScopeIntervalMinutes,
  catalystStaleness,
  catalystSourceScope,
  computeEmptyStreak,
} from "@/lib/catalyst/health";
import { invalidateRadarConfigCache } from "@/lib/settings/radar-config";
import type { CatalystSourceStatus } from "@/lib/catalyst/sync";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const MINUTE = 60_000;

function source(overrides: Partial<CatalystSourceStatus> & Pick<CatalystSourceStatus, "name">): CatalystSourceStatus {
  return {
    scope: catalystSourceScope(overrides.name),
    lastRunAt: new Date(NOW - 2 * MINUTE).toISOString(),
    fetched: 10,
    stored: 10,
    skipped: 0,
    failing: false,
    error: null,
    emptyStreak: 0,
    ...overrides,
  };
}

const THRESHOLDS = { announcements: 10, news: 30, unlocks: 120 };

describe("computeEmptyStreak", () => {
  it("cộng dồn khi fetch thành công mà 0 fact", () => {
    expect(computeEmptyStreak({ fetched: 0 }, undefined)).toBe(1);
    expect(computeEmptyStreak({ fetched: 0 }, 1)).toBe(2);
  });

  it("reset khi có fact hoặc khi lỗi (lỗi đã hiện ở cột LỖI)", () => {
    expect(computeEmptyStreak({ fetched: 12 }, 3)).toBe(0);
    expect(computeEmptyStreak({ fetched: 0, error: "HTTP 503" }, 3)).toBe(0);
  });
});

describe("catalystStaleness", () => {
  it("STALE khi quá hạn nhịp của scope, không báo khi còn trong nhịp", () => {
    const rows = catalystStaleness(
      [
        source({ name: "binance.listing", lastRunAt: new Date(NOW - 20 * MINUTE).toISOString() }),
        source({ name: "rss.RSS_COINDESK", lastRunAt: new Date(NOW - 10 * MINUTE).toISOString() }),
        source({ name: "unlocks.event_risks", lastRunAt: new Date(NOW - 200 * MINUTE).toISOString() }),
      ],
      NOW,
      THRESHOLDS
    );

    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("binance.listing")?.stale).toBe(true);
    expect(byName.get("binance.listing")?.reasons).toEqual(["overdue"]);
    expect(byName.get("binance.listing")?.minutesLate).toBe(10);

    expect(byName.get("rss.RSS_COINDESK")?.stale).toBe(false);

    expect(byName.get("unlocks.event_risks")?.stale).toBe(true);
    expect(byName.get("unlocks.event_risks")?.minutesLate).toBe(80);
  });

  it("STALE khi 2 lượt liền 0 fact dù vừa chạy xong", () => {
    const [row] = catalystStaleness(
      [source({ name: "rss.RSS_DECRYPT", fetched: 0, emptyStreak: CATALYST_STALE_ZERO_RUNS })],
      NOW,
      THRESHOLDS
    );
    expect(row.stale).toBe(true);
    expect(row.reasons).toEqual(["zero_facts"]);
  });

  it("1 lượt 0 fact chưa đủ, và lỗi mạng không bị coi là chết âm thầm", () => {
    const rows = catalystStaleness(
      [
        source({ name: "rss.RSS_THEBLOCK", fetched: 0, emptyStreak: 1 }),
        source({ name: "binance.delisting", fetched: 0, emptyStreak: 5, failing: true, error: "HTTP 503" }),
      ],
      NOW,
      THRESHOLDS
    );
    expect(rows.every((row) => !row.stale)).toBe(true);
  });

  it("báo cả hai lý do khi vừa quá hạn vừa 0 fact liên tiếp", () => {
    const [row] = catalystStaleness(
      [
        source({
          name: "unlocks.event_risks",
          fetched: 0,
          emptyStreak: 2,
          lastRunAt: new Date(NOW - 500 * MINUTE).toISOString(),
        }),
      ],
      NOW,
      THRESHOLDS
    );
    expect(row.reasons).toEqual(["overdue", "zero_facts"]);
  });

  it("không áp ngưỡng quá hạn cho nguồn lạ/scope all, và nguồn chưa chạy lần nào là quá hạn", () => {
    const rows = catalystStaleness(
      [
        source({ name: "custom.feed", lastRunAt: new Date(NOW - 10_000 * MINUTE).toISOString() }),
        source({ name: "binance.listing", lastRunAt: null }),
      ],
      NOW,
      THRESHOLDS
    );
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("custom.feed")?.stale).toBe(false);
    expect(byName.get("custom.feed")?.expectedEveryMinutes).toBeNull();
    expect(byName.get("binance.listing")?.stale).toBe(true);
    expect(byName.get("binance.listing")?.minutesSince).toBeNull();
    expect(byName.get("binance.listing")?.minutesLate).toBeNull();
  });
});

// Quy ước chung với FastAPI (scheduler.py): `schedulerEnabled=false` hoặc nhịp 0
// là GỠ job, nên không được coi là quá hạn/feed chết (nếu không sẽ STALE vĩnh
// viễn và spam webhook sau khi tắt job).
describe("0 = tắt: job bị gỡ thì không xét STALE", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => invalidateRadarConfigCache());
  afterEach(() => {
    process.env = { ...savedEnv };
    invalidateRadarConfigCache();
  });

  it("nhịp scope = 0 → bỏ cả 'overdue' lẫn 'zero_facts', scope khác vẫn báo", () => {
    process.env.SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES = "0";
    invalidateRadarConfigCache();

    const rows = catalystStaleness(
      [
        source({ name: "binance.listing", lastRunAt: null, fetched: 0, emptyStreak: 5 }),
        source({ name: "rss.RSS_COINDESK", lastRunAt: new Date(NOW - 200 * MINUTE).toISOString() }),
      ],
      NOW
    );
    const byName = new Map(rows.map((row) => [row.name, row]));

    expect(byName.get("binance.listing")?.expectedEveryMinutes).toBeNull();
    expect(byName.get("binance.listing")?.reasons).toEqual([]);
    expect(byName.get("binance.listing")?.stale).toBe(false);

    // news vẫn bật nhịp 15 phút → quá hạn vẫn báo như cũ.
    expect(byName.get("rss.RSS_COINDESK")?.stale).toBe(true);
    expect(byName.get("rss.RSS_COINDESK")?.reasons).toEqual(["overdue"]);
  });

  it("schedulerEnabled = false → không nguồn nào STALE dù nhịp > 0", () => {
    process.env.SCHEDULER_CATALYST_ENABLED = "0";
    invalidateRadarConfigCache();

    const rows = catalystStaleness(
      [
        source({ name: "binance.listing", lastRunAt: null, fetched: 0, emptyStreak: 5 }),
        source({ name: "rss.RSS_DECRYPT", lastRunAt: new Date(NOW - 500 * MINUTE).toISOString() }),
        source({
          name: "unlocks.event_risks",
          lastRunAt: new Date(NOW - 500 * MINUTE).toISOString(),
          fetched: 0,
          emptyStreak: 2,
        }),
      ],
      NOW
    );

    expect(rows.every((row) => row.expectedEveryMinutes === null)).toBe(true);
    expect(rows.every((row) => row.reasons.length === 0)).toBe(true);
    expect(rows.every((row) => !row.stale)).toBe(true);
  });

  // Parity với FastAPI (`_as_minutes`): nhịp âm = 0 = gỡ job. Nếu env parser
  // fallback về 15 phút thì job đã bị gỡ vẫn bị báo STALE vĩnh viễn.
  it("nhịp âm trong env cũng là job bị gỡ", () => {
    process.env.SCHEDULER_CATALYST_NEWS_MINUTES = "-5";
    invalidateRadarConfigCache();

    expect(catalystScopeIntervalMinutes("news")).toBeNull();
    const rows = catalystStaleness(
      [
        source({
          name: "rss.RSS_DECRYPT",
          lastRunAt: new Date(NOW - 500 * MINUTE).toISOString(),
          fetched: 0,
          emptyStreak: 5,
        }),
      ],
      NOW
    );
    expect(rows[0].expectedEveryMinutes).toBeNull();
    expect(rows[0].reasons).toEqual([]);
    expect(rows[0].stale).toBe(false);
  });

  // Parity với `_as_bool` của FastAPI: `false`/`off`/`no` cũng là tắt, không
  // chỉ chuỗi "0".
  it("SCHEDULER_CATALYST_ENABLED=false (chuỗi) tắt job như '0'", () => {
    process.env.SCHEDULER_CATALYST_ENABLED = "false";
    invalidateRadarConfigCache();

    expect(catalystScopeIntervalMinutes("announcements")).toBeNull();
    expect(catalystScopeIntervalMinutes("news")).toBeNull();
    expect(catalystScopeIntervalMinutes("unlocks")).toBeNull();
  });
});

describe("buildCatalystStaleMessage", () => {
  it("gộp các nguồn STALE vào một message, nêu cả lý do và nhịp", () => {
    const rows = catalystStaleness(
      [
        source({ name: "unlocks.event_risks", fetched: 0, emptyStreak: 2 }),
        source({ name: "binance.listing", lastRunAt: new Date(NOW - 25 * MINUTE).toISOString() }),
      ],
      NOW,
      THRESHOLDS
    );
    const text = buildCatalystStaleMessage(rows.filter((row) => row.stale));

    expect(text).toContain("2 nguồn catalyst STALE");
    expect(text).toContain("unlocks.event_risks [unlocks]: 0 fact 2 lượt liền");
    expect(text).toContain("quá hạn 15 phút");
    expect(text).toContain("Admin → Analytics → Catalyst sync");
  });
});
