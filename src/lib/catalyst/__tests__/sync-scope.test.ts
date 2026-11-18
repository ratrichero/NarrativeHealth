// RADAR-06-SCHED — scope tách nhịp: mỗi job scheduler chỉ chạy đúng nguồn của nó.
import {
  catalystSourceStatuses,
  catalystSyncInfo,
  mergeSyncStatus,
  normalizeSyncStatus,
  parseCatalystSyncScope,
  syncCatalysts,
  type CatalystSyncScope,
  type CatalystSyncStatus,
  type CatalystSyncSummary,
} from "@/lib/catalyst/sync";
import { fetchBinanceCatalog } from "@/lib/catalyst/binance-announcements";
import { fetchRssFeed } from "@/lib/catalyst/rss";
import { readUnlockFacts } from "@/lib/catalyst/unlocks";
import { upsertCatalystFacts } from "@/lib/catalyst/store";
import type { CatalystFact } from "@/lib/catalyst/types";

jest.mock("@/db", () => ({
  db: {
    insert: jest.fn(() => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    })),
  },
}));
jest.mock("@/db/schema", () => ({ appSettings: { key: "key" } }));
jest.mock("@/lib/catalyst/binance-announcements", () => ({
  BINANCE_CATALOGS: { listing: 48, delisting: 161, news: 49 },
  fetchBinanceCatalog: jest.fn(),
}));
jest.mock("@/lib/catalyst/rss", () => ({
  RSS_FEEDS: [
    { source: "RSS_COINDESK", url: "https://example.com/a", label: "CoinDesk" },
    { source: "RSS_COINTELEGRAPH", url: "https://example.com/b", label: "Cointelegraph" },
    { source: "RSS_DECRYPT", url: "https://example.com/c", label: "Decrypt" },
    { source: "RSS_THEBLOCK", url: "https://example.com/d", label: "The Block" },
  ],
  fetchRssFeed: jest.fn(),
}));
jest.mock("@/lib/catalyst/unlocks", () => ({ readUnlockFacts: jest.fn() }));
jest.mock("@/lib/catalyst/store", () => ({
  upsertCatalystFacts: jest.fn(),
  purgeExpiredCatalysts: jest.fn(),
}));

const NOW = Date.parse("2026-11-18T00:00:00Z");

function fact(externalId: string): CatalystFact {
  return {
    type: "NEWS",
    source: "RSS_COINDESK",
    externalId,
    title: "t",
    sourceUrl: "https://example.com/x",
    symbols: ["ARB"],
    publishedAt: "2026-11-18T00:00:00.000Z",
  };
}

const binanceMock = fetchBinanceCatalog as jest.Mock;
const rssMock = fetchRssFeed as jest.Mock;
const unlockMock = readUnlockFacts as jest.Mock;
const upsertMock = upsertCatalystFacts as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  binanceMock.mockResolvedValue([fact("binance:1")]);
  rssMock.mockResolvedValue([fact("rss:1")]);
  unlockMock.mockResolvedValue({ facts: [fact("unlock:1")], skippedNoSource: 2 });
  upsertMock.mockImplementation(async (facts: CatalystFact[]) => ({
    stored: facts.length,
    skipped: 0,
  }));
});

async function run(scope: CatalystSyncScope) {
  const summary = await syncCatalysts(NOW, scope);
  return { summary, names: summary.sources.map((s) => s.name) };
}

describe("parseCatalystSyncScope", () => {
  it("nhận scope hợp lệ, mặc định 'all' cho input lạ/thiếu", () => {
    expect(parseCatalystSyncScope("announcements")).toBe("announcements");
    expect(parseCatalystSyncScope(" NEWS ")).toBe("news");
    expect(parseCatalystSyncScope("unlocks")).toBe("unlocks");
    expect(parseCatalystSyncScope("all")).toBe("all");
    expect(parseCatalystSyncScope(undefined)).toBe("all");
    expect(parseCatalystSyncScope("bogus")).toBe("all");
    expect(parseCatalystSyncScope(42)).toBe("all");
  });
});

describe("catalystSyncInfo — hợp trạng thái theo scope", () => {
  function summary(overrides: Partial<CatalystSyncSummary> = {}): CatalystSyncSummary {
    return {
      startedAt: "2026-11-18T00:00:00.000Z",
      finishedAt: "2026-11-18T00:00:05.000Z",
      scope: "announcements",
      sources: [
        { name: "binance.listing", fetched: 3, stored: 3, skipped: 0 },
        { name: "binance.delisting", fetched: 1, stored: 1, skipped: 0 },
      ],
      totals: { fetched: 4, stored: 4, failedSources: 0 },
      purged: 0,
      ...overrides,
    };
  }

  function status(scopes: CatalystSyncStatus["scopes"]): CatalystSyncStatus {
    return { version: 2, scopes };
  }

  it("chưa có catalyst.sync → never_synced (không phải “không khớp”)", () => {
    expect(catalystSyncInfo(null)).toEqual({
      state: "never_synced",
      lastSyncAt: null,
      failedSources: [],
      checkedSources: [],
    });
    expect(catalystSyncInfo(status({})).state).toBe("never_synced");
  });

  it("mọi nguồn của mọi scope đều lỗi → sources_failed + tên nguồn", () => {
    const info = catalystSyncInfo(
      status({
        announcements: summary({
          sources: [
            { name: "binance.listing", fetched: 0, stored: 0, skipped: 0, error: "HTTP 500" },
          ],
          totals: { fetched: 0, stored: 0, failedSources: 1 },
        }),
        news: summary({
          scope: "news",
          finishedAt: "2026-11-18T00:10:00.000Z",
          sources: [
            { name: "rss.RSS_COINDESK", fetched: 0, stored: 0, skipped: 0, error: "HTTP 503" },
            { name: "rss.RSS_DECRYPT", fetched: 0, stored: 0, skipped: 0, error: "timeout" },
          ],
          totals: { fetched: 0, stored: 0, failedSources: 2 },
        }),
      })
    );
    expect(info.state).toBe("sources_failed");
    expect(info.checkedSources).toEqual([]);
    expect(info.failedSources).toEqual([
      "binance.listing",
      "rss.RSS_COINDESK",
      "rss.RSS_DECRYPT",
    ]);
    expect(info.lastSyncAt).toBe("2026-11-18T00:10:00.000Z");
  });

  it("job announcement chạy sau không xoá kết quả RSS/unlock đã chạy trước đó", () => {
    const info = catalystSyncInfo(
      status({
        news: summary({
          scope: "news",
          finishedAt: "2026-11-18T00:10:00.000Z",
          sources: [
            { name: "rss.RSS_COINDESK", fetched: 30, stored: 12, skipped: 0 },
            { name: "rss.RSS_DECRYPT", fetched: 0, stored: 0, skipped: 0, error: "HTTP 503" },
          ],
          totals: { fetched: 30, stored: 12, failedSources: 1 },
        }),
        unlocks: summary({
          scope: "unlocks",
          finishedAt: "2026-11-18T00:05:30.000Z",
          sources: [{ name: "unlocks.event_risks", fetched: 4, stored: 3, skipped: 1 }],
          totals: { fetched: 4, stored: 3, failedSources: 0 },
        }),
        // Announcement chạy 5 phút/lần → finishedAt mới nhất, chỉ có nguồn của nó.
        announcements: summary({ finishedAt: "2026-11-18T00:15:00.000Z" }),
      })
    );

    expect(info.state).toBe("synced");
    expect(info.checkedSources).toEqual([
      "binance.delisting",
      "binance.listing",
      "rss.RSS_COINDESK",
      "unlocks.event_risks",
    ]);
    expect(info.failedSources).toEqual(["rss.RSS_DECRYPT"]);
    expect(info.lastSyncAt).toBe("2026-11-18T00:15:00.000Z");
  });

  it("mỗi nguồn lấy lần chạy mới nhất của chính nó (scope all ghi đè kết quả cũ)", () => {
    const info = catalystSyncInfo(
      status({
        news: summary({
          scope: "news",
          finishedAt: "2026-11-18T00:10:00.000Z",
          sources: [
            { name: "rss.RSS_COINDESK", fetched: 0, stored: 0, skipped: 0, error: "HTTP 503" },
          ],
        }),
        all: summary({
          scope: "all",
          finishedAt: "2026-11-18T01:00:00.000Z",
          sources: [{ name: "rss.RSS_COINDESK", fetched: 30, stored: 30, skipped: 0 }],
        }),
      })
    );
    expect(info.state).toBe("synced");
    expect(info.checkedSources).toEqual(["rss.RSS_COINDESK"]);
    expect(info.failedSources).toEqual([]);
  });
});

describe("catalystSourceStatuses — bảng trạng thái cho admin", () => {
  const status: CatalystSyncStatus = {
    version: 2,
    scopes: {
      announcements: {
        startedAt: "2026-11-18T00:14:50.000Z",
        finishedAt: "2026-11-18T00:15:00.000Z",
        scope: "announcements",
        sources: [
          { name: "binance.listing", fetched: 20, stored: 18, skipped: 2 },
          { name: "binance.delisting", fetched: 5, stored: 5, skipped: 0 },
        ],
        totals: { fetched: 25, stored: 23, failedSources: 0 },
        purged: 0,
      },
      news: {
        startedAt: "2026-11-18T00:09:50.000Z",
        finishedAt: "2026-11-18T00:10:00.000Z",
        scope: "news",
        sources: [
          { name: "rss.RSS_COINDESK", fetched: 30, stored: 12, skipped: 0 },
          { name: "rss.RSS_DECRYPT", fetched: 0, stored: 0, skipped: 0, error: "RSS RSS_DECRYPT HTTP 503" },
        ],
        totals: { fetched: 30, stored: 12, failedSources: 1 },
        purged: 0,
      },
      unlocks: {
        startedAt: "2026-11-18T00:05:00.000Z",
        finishedAt: "2026-11-18T00:05:30.000Z",
        scope: "unlocks",
        sources: [{ name: "unlocks.event_risks", fetched: 4, stored: 3, skipped: 1 }],
        totals: { fetched: 4, stored: 3, failedSources: 0 },
        purged: 0,
      },
    },
  };

  it("mỗi nguồn một dòng: lần chạy riêng, số fact đã lưu, nguồn lỗi", () => {
    const rows = catalystSourceStatuses(status);

    expect(rows.map((row) => row.name)).toEqual([
      "binance.delisting",
      "binance.listing",
      "rss.RSS_COINDESK",
      "rss.RSS_DECRYPT",
      "unlocks.event_risks",
    ]);

    const decrypt = rows.find((row) => row.name === "rss.RSS_DECRYPT");
    expect(decrypt).toMatchObject({
      scope: "news",
      failing: true,
      stored: 0,
      lastRunAt: "2026-11-18T00:10:00.000Z",
    });
    expect(decrypt?.error).toContain("503");

    // Announcement chạy sau nhưng không làm đổi thời điểm của nguồn RSS.
    expect(rows.find((row) => row.name === "rss.RSS_COINDESK")).toMatchObject({
      fetched: 30,
      stored: 12,
      lastRunAt: "2026-11-18T00:10:00.000Z",
      failing: false,
    });
    expect(rows.find((row) => row.name === "binance.listing")?.lastRunAt).toBe(
      "2026-11-18T00:15:00.000Z"
    );
  });

  it("chưa sync lần nào → bảng rỗng", () => {
    expect(catalystSourceStatuses(null)).toEqual([]);
  });
});

describe("normalizeSyncStatus / mergeSyncStatus", () => {
  function summary(scope: CatalystSyncScope): CatalystSyncSummary {
    return {
      startedAt: "2026-11-18T00:00:00.000Z",
      finishedAt: "2026-11-18T00:00:05.000Z",
      scope,
      sources: [{ name: "rss.RSS_COINDESK", fetched: 1, stored: 1, skipped: 0 }],
      totals: { fetched: 1, stored: 1, failedSources: 0 },
      purged: 0,
    };
  }

  it("đọc được value format cũ (một summary) không mất trạng thái sau deploy", () => {
    const legacy = summary("news");
    const normalized = normalizeSyncStatus(legacy);
    expect(normalized?.scopes.news).toEqual(legacy);
    expect(normalizeSyncStatus(null)).toBeNull();
    expect(normalizeSyncStatus({ hello: 1 })).toBeNull();
  });

  it("merge chỉ thay scope của mình, giữ nguyên scope khác", () => {
    const first = mergeSyncStatus(null, "news", summary("news"));
    const second = mergeSyncStatus(first, "announcements", summary("announcements"));

    expect(Object.keys(second.scopes).sort()).toEqual(["announcements", "news"]);
    expect(second.scopes.news).toEqual(summary("news"));
  });
});

describe("syncCatalysts theo scope", () => {
  it("announcements: chỉ 3 catalog Binance, không đụng RSS/unlock", async () => {
    const { summary, names } = await run("announcements");
    expect(names).toEqual(["binance.listing", "binance.delisting", "binance.news"]);
    expect(summary.scope).toBe("announcements");
    expect(binanceMock).toHaveBeenCalledTimes(3);
    expect(rssMock).not.toHaveBeenCalled();
    expect(unlockMock).not.toHaveBeenCalled();
    expect(summary.totals).toEqual({ fetched: 3, stored: 3, failedSources: 0 });
  });

  it("news: chỉ 4 feed RSS", async () => {
    const { summary, names } = await run("news");
    expect(names).toEqual([
      "rss.RSS_COINDESK",
      "rss.RSS_COINTELEGRAPH",
      "rss.RSS_DECRYPT",
      "rss.RSS_THEBLOCK",
    ]);
    expect(rssMock).toHaveBeenCalledTimes(4);
    expect(binanceMock).not.toHaveBeenCalled();
    expect(unlockMock).not.toHaveBeenCalled();
    expect(summary.totals.stored).toBe(4);
  });

  it("unlocks: chỉ đọc event_risks, giữ skippedNoSource trong fetched/skipped", async () => {
    const { summary, names } = await run("unlocks");
    expect(names).toEqual(["unlocks.event_risks"]);
    expect(unlockMock).toHaveBeenCalledTimes(1);
    expect(binanceMock).not.toHaveBeenCalled();
    expect(rssMock).not.toHaveBeenCalled();
    expect(summary.sources[0]).toMatchObject({ fetched: 3, stored: 1, skipped: 2 });
  });

  it("all: 3 catalog + 4 RSS + unlock = 8 nguồn", async () => {
    const { summary } = await run("all");
    expect(summary.sources).toHaveLength(8);
    expect(summary.scope).toBe("all");
    // 3 catalog × 1 fact + 4 feed × 1 item + unlock 1 fact + 2 bỏ vì thiếu source
    expect(summary.totals.fetched).toBe(3 + 4 + 3);
  });

  it("nguồn lỗi chỉ tính failedSources, các nguồn khác vẫn chạy", async () => {
    rssMock.mockImplementation(async (feed: { source: string }) => {
      if (feed.source === "RSS_DECRYPT") throw new Error("RSS RSS_DECRYPT HTTP 503");
      return [fact("rss:1")];
    });

    const { summary } = await run("news");
    expect(summary.totals.failedSources).toBe(1);
    expect(summary.sources.filter((s) => s.error)).toHaveLength(1);
    expect(summary.sources.find((s) => s.name === "rss.RSS_DECRYPT")?.error).toContain("503");
    expect(summary.totals.stored).toBe(3);
  });
});
