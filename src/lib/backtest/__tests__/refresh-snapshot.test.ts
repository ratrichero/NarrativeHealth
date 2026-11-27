// SNAPSHOT-02 — bước snapshot trong refresh.
//
// Điều cần khoá: settlement hỏng chỉ chặn việc CHỐT. Danh sách ngày đã đóng
// còn thiếu vẫn phải được đọc và ghi log — nếu không, log im lặng đúng lúc
// settlement hỏng, tức đúng lúc bảng chụp có nguy cơ thiếu ngày nhất.

import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import type { TrackRecordPayload } from "../track-record-read";
import { runRefreshSnapshotStep, type RefreshSnapshotDeps } from "../refresh-snapshot";
import type { SnapshotGapReport } from "../snapshot-store";
import type { SnapshotDayDecision } from "../snapshot";

const TODAY = "2026-11-24";

const payload = {
  meta: { dataAsOf: "2026-11-23", metricsVersion: "track-record-v11" },
  summary: { lastEvaluatedAt: "2026-11-24T00:10:00.000Z", totals: { picks: 3 } },
} as unknown as TrackRecordPayload;

const gapReport: SnapshotGapReport = {
  missing: ["2026-11-21", "2026-11-22"],
  windowDays: 31,
  tip: "2026-11-20",
};

const okDecision: SnapshotDayDecision = {
  ok: true,
  day: "2026-11-23",
  today: TODAY,
  settlementDay: "2026-11-23",
  reason: null,
};

function deps(overrides: Partial<RefreshSnapshotDeps> = {}) {
  return {
    readTrackRecord: jest.fn(async () => ({ payload }) as never),
    publishClosedDaySnapshot: jest.fn(async () => ({
      decision: okDecision,
      result: {
        created: true,
        entry: {
          day: "2026-11-23",
          payloadHash: "a".repeat(64),
          headHash: "b".repeat(64),
          metricsVersion: "track-record-v11",
          createdAt: "2026-11-24T00:10:00.000Z",
        },
        head: "b".repeat(64),
        anchor: null,
      },
    })) as unknown as RefreshSnapshotDeps["publishClosedDaySnapshot"],
    listSnapshotGaps: jest.fn(async () => gapReport),
    today: () => TODAY,
    yesterday: () => "2026-11-23",
    ...overrides,
  };
}

describe("runRefreshSnapshotStep", () => {
  let warn: ReturnType<typeof jest.spyOn>;
  let error: ReturnType<typeof jest.spyOn>;
  let log: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
    log.mockRestore();
  });

  it("settleErrors > 0 → không chốt, nhưng vẫn đọc gap và ghi log", async () => {
    const d = deps();

    const outcome = await runRefreshSnapshotStep({ settleErrors: 2, deps: d });

    expect(outcome.seal).toBe("skipped");
    expect(d.publishClosedDaySnapshot).not.toHaveBeenCalled();
    expect(d.readTrackRecord).not.toHaveBeenCalled();

    // Phần quan trọng: gap vẫn được nói ra dù settlement hỏng.
    expect(d.listSnapshotGaps).toHaveBeenCalledWith({ today: TODAY });
    expect(outcome.gaps).toEqual(gapReport);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skip seal"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2026-11-21, 2026-11-22"));
  });

  it("settleErrors = 0 → chốt rồi vẫn đọc gap", async () => {
    const d = deps();

    const outcome = await runRefreshSnapshotStep({ settleErrors: 0, deps: d });

    expect(outcome.seal).toBe("sealed");
    expect(d.publishClosedDaySnapshot).toHaveBeenCalledTimes(1);
    expect(d.listSnapshotGaps).toHaveBeenCalledTimes(1);
  });

  it("bước chốt ném lỗi → gap vẫn chạy, không ném ra ngoài", async () => {
    const d = deps({
      readTrackRecord: jest.fn(async () => {
        throw new Error("db down");
      }) as unknown as RefreshSnapshotDeps["readTrackRecord"],
    });

    const outcome = await runRefreshSnapshotStep({ settleErrors: 0, deps: d });

    expect(outcome.seal).toBe("error");
    expect(d.listSnapshotGaps).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });
});
