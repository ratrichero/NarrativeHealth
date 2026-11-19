/**
 * GET /api/admin/catalyst/sync dùng `peekRadarRuntimeConfig()` (sync) để tính
 * STALE, nên nếu route không preload thì cold start sẽ lấy nhịp/env cũ. Test này
 * mô phỏng cache lạnh: `peek` trả env cho tới khi `readRadarRuntimeConfig` chạy,
 * rồi kiểm tra STALE thực sự nhìn thấy config DB.
 */
import { NextRequest } from "next/server";
import type { RadarRuntimeConfig } from "@/lib/settings/radar-config";
import { catalystStaleness } from "@/lib/catalyst/health";
import { peekRadarRuntimeConfig, readRadarRuntimeConfig } from "@/lib/settings/radar-config";
import { syncCatalysts } from "@/lib/catalyst/sync";
import { GET, POST } from "../route";

jest.mock("@/db", () => ({ db: { select: jest.fn(), insert: jest.fn() } }));

jest.mock("@/lib/settings/radar-config", () => ({
  readRadarRuntimeConfig: jest.fn(),
  peekRadarRuntimeConfig: jest.fn(),
}));

jest.mock("@/lib/catalyst/health", () => ({ catalystStaleness: jest.fn() }));

jest.mock("@/lib/catalyst/sync", () => ({
  parseCatalystSyncScope: (raw: unknown) =>
    raw === "announcements" || raw === "news" || raw === "unlocks" ? raw : "all",
  readCatalystSyncStatus: jest.fn(),
  catalystSyncInfo: jest.fn(() => ({ state: "synced" })),
  catalystSourceStatuses: jest.fn(() => [
    { name: "news", lastRunAt: "2026-11-19T00:00:00.000Z", lastCount: 4, error: null },
  ]),
  syncCatalysts: jest.fn(),
}));

jest.mock("@/lib/catalyst/store", () => ({ countLiveCatalystFacts: jest.fn() }));

jest.mock("@/lib/catalyst/summarize", () => ({
  catalystSourceLabel: (source: string) => source,
  catalystSyncSourceLabel: (source: string) => source,
}));

import { readCatalystSyncStatus } from "@/lib/catalyst/sync";
import { countLiveCatalystFacts } from "@/lib/catalyst/store";

const envConfig = {
  catalystStaleCooldownHours: 6,
  schedulerAnnouncementsMinutes: 5,
  schedulerNewsMinutes: 15,
  schedulerUnlocksMinutes: 60,
} as unknown as RadarRuntimeConfig;

// Cùng shape nhưng khác env — nếu route không preload, STALE sẽ đọc 15 phút.
const dbConfig = {
  ...envConfig,
  schedulerNewsMinutes: 3,
} as RadarRuntimeConfig;

const peekMock = peekRadarRuntimeConfig as unknown as jest.Mock;
const readMock = readRadarRuntimeConfig as unknown as jest.Mock;
const stalenessMock = catalystStaleness as unknown as jest.Mock;
const syncMock = syncCatalysts as unknown as jest.Mock;
const statusMock = readCatalystSyncStatus as unknown as jest.Mock;
const liveMock = countLiveCatalystFacts as unknown as jest.Mock;

let seenConfigs: RadarRuntimeConfig[];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RADAR_DEMO;

  // Cache lạnh: peek trả env cho tới khi read chạy xong.
  let cache = envConfig;
  peekMock.mockImplementation(() => cache);
  readMock.mockImplementation(async () => {
    cache = dbConfig;
    return { config: dbConfig, applied: [] };
  });

  seenConfigs = [];
  stalenessMock.mockImplementation(() => {
    seenConfigs.push(peekRadarRuntimeConfig());
    return [];
  });

  statusMock.mockResolvedValue({
    announcements: null,
    news: { lastRunAt: "2026-11-19T00:00:00.000Z", lastCount: 4, error: null },
    unlocks: null,
  });
  liveMock.mockResolvedValue([{ source: "news", live: 3 }]);
  syncMock.mockResolvedValue({ scope: "news", sources: [] });
});

afterEach(() => {
  delete process.env.RADAR_DEMO;
});

describe("GET /api/admin/catalyst/sync", () => {
  it("preload config DB trước khi tính STALE (cache lạnh không dùng env)", async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(readMock).toHaveBeenCalledTimes(1);
    // catalystStaleness chạy sau preload nên peek phải trả config DB, không phải env.
    expect(seenConfigs).toHaveLength(1);
    expect(seenConfigs[0]).toBe(dbConfig);
    expect(seenConfigs[0].schedulerNewsMinutes).toBe(3);
    expect(seenConfigs[0].schedulerNewsMinutes).not.toBe(envConfig.schedulerNewsMinutes);
    expect(json.data.live.total).toBe(3);
    expect(json.data.sources[0].label).toBe("news");
  });

  it("demo mode không đọc DB (giữ status mẫu)", async () => {
    process.env.RADAR_DEMO = "1";

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(readMock).not.toHaveBeenCalled();
    expect(statusMock).not.toHaveBeenCalled();
    expect(json.success).toBe(true);
  });
});

describe("POST /api/admin/catalyst/sync", () => {
  it("preload config DB trước khi sync để STALE/quota không đọc env", async () => {
    const request = new NextRequest("http://localhost/api/admin/catalyst/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "news" }),
    });

    const res = await POST(request);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ scope: "news", sources: [] });
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(syncMock.mock.calls[0][1]).toBe("news");
    expect(syncMock.mock.calls[0][0]).toEqual(expect.any(Number));
    // Thứ tự: preload xong mới sync (cache đã là DB khi sync bắt đầu).
    expect(readMock.mock.invocationCallOrder[0]).toBeLessThan(
      syncMock.mock.invocationCallOrder[0]
    );
  });
});
