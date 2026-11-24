// SNAPSHOT-02 — POST chỉ được chốt bởi scheduler và chỉ với ngày ĐÃ ĐÓNG.
//
// Test khoá đúng ba thứ dễ hỏng nhất của endpoint ghi vĩnh viễn:
//   1. Không có token (hoặc token sai) → không chốt.
//   2. Ngày chưa đóng (hôm nay) → 409, không gọi publish.
//   3. Settlement chưa chạy trong/sau ngày đó → 409.
// Cộng thêm một lượt hợp lệ để chắc cổng không chặn quá tay.

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

jest.mock("@/lib/backtest/track-record-read", () => ({
  readTrackRecord: jest.fn(),
}));
jest.mock("@/lib/backtest/snapshot-store", () => {
  const { evaluateSnapshotDay } = jest.requireActual(
    "@/lib/backtest/snapshot"
  ) as typeof import("@/lib/backtest/snapshot");
  const publishDailySnapshot = jest.fn();
  return {
    publishDailySnapshot,
    readVerifiedSnapshotChain: jest.fn(),
    // Double cho helper thật: cổng thật (`evaluateSnapshotDay`, thuần) + publish
    // giả (không chạm DB). Tổ hợp thật được phủ ở snapshot-postgres.test.ts.
    publishClosedDaySnapshot: jest.fn(
      async (options: {
        payload: unknown;
        day: string;
        today: string;
        lastEvaluatedAt: string | null;
        hasPicks?: boolean;
        metricsVersion: string;
      }) => {
        const decision = evaluateSnapshotDay(options);
        if (!decision.ok) return { decision, result: null };
        return {
          decision,
          result: await publishDailySnapshot(
            options.payload,
            options.day,
            options.metricsVersion
          ),
        };
      }
    ),
  };
});
jest.mock("@/lib/env/route-guard", () => ({
  runtimeGuardResponse: jest.fn(() => null),
}));
// Hôm nay cố định 2026-11-24 (cổng so `day < today` không được phụ thuộc giờ chạy),
// nhưng vẫn giữ cách đổi timestamp → ngày ICT thật cho `lastEvaluatedAt`.
jest.mock("@/lib/utils", () => {
  const actual = jest.requireActual("@/lib/utils") as typeof import("@/lib/utils");
  return {
    ...actual,
    getBusinessDate: jest.fn((date?: Date | string) =>
      date === undefined ? "2026-11-24" : actual.getBusinessDate(date)
    ),
    getYesterdayBusinessDate: jest.fn(() => "2026-11-23"),
  };
});

const { readTrackRecord } = require("@/lib/backtest/track-record-read") as {
  readTrackRecord: jest.Mock<() => Promise<unknown>>;
};
const { publishDailySnapshot } = require("@/lib/backtest/snapshot-store") as {
  publishDailySnapshot: jest.Mock<
    (payload: unknown, day: string, metricsVersion: string) => Promise<unknown>
  >;
};

import { POST } from "../route";

const TOKEN = "test-scheduler-token";
const METRICS_VERSION = "track-record-v11";

function trackRecord(
  dataAsOf: string | null,
  lastEvaluatedAt: string | null,
  // Mặc định > 0: các ca "thiếu settlement" muốn kiểm đúng cổng chặn, không
  // rơi vào ngoại lệ track record rỗng.
  picks = 12
) {
  return {
    picks: [],
    payload: {
      summary: { lastEvaluatedAt, totals: { picks } },
      meta: { dataAsOf, metricsVersion: METRICS_VERSION },
    },
  };
}

function post(headers: Record<string, string> = {}) {
  return POST(
    new NextRequest("http://localhost/api/track-record/snapshots", {
      method: "POST",
      headers,
    })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCHEDULER_CATALYST_TOKEN = TOKEN;
  readTrackRecord.mockResolvedValue(trackRecord("2026-11-23", "2026-11-24T00:30:00.000Z"));
  publishDailySnapshot.mockResolvedValue({
    created: true,
    entry: { day: "2026-11-23" },
    head: "a".repeat(64),
  });
});

afterEach(() => {
  delete process.env.SCHEDULER_CATALYST_TOKEN;
});

describe("POST /api/track-record/snapshots — auth", () => {
  it("chưa cấu hình token → 503 fail-closed, không đọc/chốt gì", async () => {
    delete process.env.SCHEDULER_CATALYST_TOKEN;

    const response = await post({ "x-scheduler-token": "anything" });

    expect(response.status).toBe(503);
    expect(readTrackRecord).not.toHaveBeenCalled();
    expect(publishDailySnapshot).not.toHaveBeenCalled();
  });

  it("thiếu token → 401, không đọc/chốt gì", async () => {
    const response = await post();

    expect(response.status).toBe(401);
    expect(readTrackRecord).not.toHaveBeenCalled();
    expect(publishDailySnapshot).not.toHaveBeenCalled();
  });

  it("token sai → 401, không chốt", async () => {
    const response = await post({ "x-scheduler-token": "wrong" });

    expect(response.status).toBe(401);
    expect(publishDailySnapshot).not.toHaveBeenCalled();
  });
});

describe("POST /api/track-record/snapshots — chỉ ngày đã đóng/sau settlement", () => {
  it("ngày hôm nay chưa đóng → 409 day-open, không chốt", async () => {
    readTrackRecord.mockResolvedValue(trackRecord("2026-11-24", "2026-11-24T00:30:00.000Z"));

    const response = await post({ "x-scheduler-token": TOKEN });
    const body = (await response.json()) as {
      success: boolean;
      error: string;
      data: { reason: string; day: string; today: string };
    };

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.data).toMatchObject({ reason: "day-open", day: "2026-11-24", today: "2026-11-24" });
    expect(body.error).toContain("chưa đóng");
    expect(publishDailySnapshot).not.toHaveBeenCalled();
  });

  it("settlement chưa chạy kể từ ngày đó → 409 settlement-pending, không chốt", async () => {
    readTrackRecord.mockResolvedValue(trackRecord("2026-11-23", "2026-11-19T02:00:00.000Z"));

    const response = await post({ "x-scheduler-token": TOKEN });
    const body = (await response.json()) as { data: { reason: string; settlementDay: string | null } };

    expect(response.status).toBe(409);
    expect(body.data).toMatchObject({ reason: "settlement-pending", settlementDay: "2026-11-19" });
    expect(publishDailySnapshot).not.toHaveBeenCalled();
  });

  it("chưa từng có settlement stamp → 409 settlement-pending", async () => {
    readTrackRecord.mockResolvedValue(trackRecord("2026-11-23", null));

    const response = await post({ "x-scheduler-token": TOKEN });
    const body = (await response.json()) as { data: { reason: string; settlementDay: string | null } };

    expect(response.status).toBe(409);
    expect(body.data).toMatchObject({ reason: "settlement-pending", settlementDay: null });
    expect(publishDailySnapshot).not.toHaveBeenCalled();
  });

  it("track record rỗng (0 pick, chưa từng settlement) → vẫn chốt được", async () => {
    // Deployment mới: chưa pick nào nên settlement chưa từng chạy, và cũng
    // không có `dataAsOf` (không ngày dữ liệu) → khoá theo ngày vừa đóng.
    // Không có số nào để bảo vệ khỏi bị đóng băng, nên cổng settlement phải
    // cho qua — nếu không, ngày đầu tiên không bao giờ được chốt.
    readTrackRecord.mockResolvedValue(trackRecord(null, null, 0));

    const response = await post({ "x-scheduler-token": TOKEN });
    const body = (await response.json()) as { success: boolean; data: { created: boolean } };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(true);
    expect(publishDailySnapshot).toHaveBeenCalledTimes(1);
    expect(publishDailySnapshot).toHaveBeenCalledWith(
      expect.anything(),
      "2026-11-23",
      METRICS_VERSION
    );
  });

  it("track record rỗng nhưng ngày vẫn chưa đóng → 409 day-open", async () => {
    // Ngoại lệ rỗng chỉ bỏ cổng settlement, không được mở cổng ngày đang mở.
    readTrackRecord.mockResolvedValue(trackRecord("2026-11-24", null, 0));

    const response = await post({ "x-scheduler-token": TOKEN });
    const body = (await response.json()) as { data: { reason: string } };

    expect(response.status).toBe(409);
    expect(body.data.reason).toBe("day-open");
    expect(publishDailySnapshot).not.toHaveBeenCalled();
  });

  it("ngày đã đóng + settlement đã chạy → chốt đúng ngày của payload", async () => {
    const response = await post({ "x-scheduler-token": TOKEN });
    const body = (await response.json()) as { success: boolean; data: { created: boolean; head: string } };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(true);
    expect(publishDailySnapshot).toHaveBeenCalledTimes(1);
    expect(publishDailySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ metricsVersion: METRICS_VERSION }) }),
      "2026-11-23",
      METRICS_VERSION
    );
  });
});
