// HEALTH-TRACK-01 — check `snapshot`: bản chụp của ngày vừa đóng phải tồn tại
// và verify được (payload khớp hash, head nối đúng bản trước).
//
// Ba trạng thái là ba sự cố khác nhau: thiếu bản chụp = job chưa chạy (warn),
// payload lệch hash = dữ liệu đã công bố bị sửa (fail), head lệch neo = head bị
// sửa (fail). Test mock phần đọc track record/snapshot để chỉ khoá logic check.

import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/db/preflight", () => ({
  preflightTrackRecordSchema: jest.fn(),
}));
jest.mock("@/lib/backtest/track-record-read", () => ({
  readTrackRecord: jest.fn(),
}));
jest.mock("@/lib/backtest/snapshot-store", () => ({
  listSnapshotGaps: jest.fn(),
  readSnapshotDayStatus: jest.fn(),
}));
jest.mock("@/lib/utils", () => ({
  getBusinessDate: jest.fn(() => "2026-11-24"),
  getYesterdayBusinessDate: jest.fn(() => "2026-11-23"),
}));

const { preflightTrackRecordSchema } = require("@/lib/db/preflight") as {
  preflightTrackRecordSchema: jest.Mock<() => Promise<unknown>>;
};
const { readTrackRecord } = require("@/lib/backtest/track-record-read") as {
  readTrackRecord: jest.Mock<() => Promise<unknown>>;
};
const { listSnapshotGaps, readSnapshotDayStatus } = require("@/lib/backtest/snapshot-store") as {
  listSnapshotGaps: jest.Mock<() => Promise<unknown>>;
  readSnapshotDayStatus: jest.Mock<(day: string) => Promise<unknown>>;
};

import { GET } from "../route";

function payload() {
  return {
    payload: {
      summary: { totals: { picks: 12 } },
      freshness: { stale: false, reason: null, pickAgeDays: 1 },
      split: { liveSince: "2026-09-01", liveSinceSource: "env", originSignal: null },
      settlement: { pendingPicks: 0, nextSettlementAt: null },
      meta: {
        metricsVersion: "track-record-v11",
        window: { capped: false, rowsRead: 42, limit: 20000 },
      },
    },
  };
}

type Body = { ok: boolean; checks: { id: string; status: string; detail: string }[] };

beforeEach(() => {
  jest.clearAllMocks();
  preflightTrackRecordSchema.mockResolvedValue({ ok: true, missing: [] });
  readTrackRecord.mockResolvedValue(payload());
  readSnapshotDayStatus.mockResolvedValue({
    day: "2026-11-23",
    entry: { day: "2026-11-23", headHash: "a".repeat(64) },
    payloadMatches: true,
    headLinked: true,
    previousDay: "2026-11-22",
  });
  listSnapshotGaps.mockResolvedValue({ missing: [], windowDays: 31, tip: "2026-11-23" });
});

describe("GET /api/health/track-record — snapshot", () => {
  it("bản chụp hôm qua tồn tại và verify được → check ok", async () => {
    const response = await GET();
    const body = (await response.json()) as Body;

    expect(response.status).toBe(200);
    expect(readSnapshotDayStatus).toHaveBeenCalledWith("2026-11-23");
    expect(body.checks.find((check) => check.id === "snapshot")).toMatchObject({
      status: "ok",
    });
    expect(body.checks.find((check) => check.id === "snapshot")?.detail).toContain("2026-11-23");
  });

  it("chưa có bản chụp cho hôm qua → warn, health vẫn 200", async () => {
    readSnapshotDayStatus.mockResolvedValue({
      day: "2026-11-23",
      entry: null,
      payloadMatches: null,
      headLinked: null,
      previousDay: null,
    });

    const response = await GET();
    const body = (await response.json()) as Body;
    const snapshot = body.checks.find((check) => check.id === "snapshot");

    expect(response.status).toBe(200);
    expect(snapshot?.status).toBe("warn");
    expect(snapshot?.detail).toContain("Chưa có bản chụp");
  });

  it("có ngày đã đóng khác không có bản chụp → warn và liệt kê ngày", async () => {
    listSnapshotGaps.mockResolvedValue({
      missing: ["2026-11-19", "2026-11-20"],
      windowDays: 31,
      tip: "2026-11-23",
    });

    const response = await GET();
    const body = (await response.json()) as Body;
    const snapshot = body.checks.find((check) => check.id === "snapshot");

    // Không phải "hỏng" (không 503) nhưng không được im lặng.
    expect(response.status).toBe(200);
    expect(snapshot?.status).toBe("warn");
    expect(snapshot?.detail).toContain("KHÔNG có bản chụp");
    expect(snapshot?.detail).toContain("2026-11-19");
    expect(snapshot?.detail).toContain("2026-11-20");
  });

  it("payload lệch payload_hash → fail, health trả 503", async () => {
    readSnapshotDayStatus.mockResolvedValue({
      day: "2026-11-23",
      entry: { day: "2026-11-23", headHash: "a".repeat(64) },
      payloadMatches: false,
      headLinked: true,
      previousDay: "2026-11-22",
    });

    const response = await GET();
    const body = (await response.json()) as Body;
    const snapshot = body.checks.find((check) => check.id === "snapshot");

    expect(response.status).toBe(503);
    expect(snapshot?.status).toBe("fail");
    expect(snapshot?.detail).toContain("payload_hash");
  });

  it("head_hash không nối đúng neo bản trước → fail", async () => {
    readSnapshotDayStatus.mockResolvedValue({
      day: "2026-11-23",
      entry: { day: "2026-11-23", headHash: "f".repeat(64) },
      payloadMatches: true,
      headLinked: false,
      previousDay: "2026-11-22",
    });

    const response = await GET();
    const body = (await response.json()) as Body;
    const snapshot = body.checks.find((check) => check.id === "snapshot");

    expect(response.status).toBe(503);
    expect(snapshot?.status).toBe("fail");
    expect(snapshot?.detail).toContain("head_hash");
  });

  it("không đọc được bảng chụp (thiếu migration) → fail", async () => {
    readSnapshotDayStatus.mockRejectedValue(new Error('relation "track_record_snapshots" does not exist'));

    const response = await GET();
    const body = (await response.json()) as Body;
    const snapshot = body.checks.find((check) => check.id === "snapshot");

    expect(response.status).toBe(503);
    expect(snapshot?.status).toBe("fail");
    expect(snapshot?.detail).toContain("0040");
  });
});
