// BT-HEALTH — cảnh báo settlement chết âm thầm. Test thuần trên logic ngưỡng;
// mock @/db + alert-delivery để import module không side-effect.

jest.mock("@/db", () => ({
  db: {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({ limit: jest.fn(() => Promise.resolve([])) })),
      })),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoUpdate: jest.fn(() => Promise.resolve(undefined)),
      })),
    })),
  },
}));
jest.mock("@/lib/services/alert-delivery.service", () => ({
  dispatchCustomText: jest.fn(async () => 0),
}));

import {
  settlementHealthIssues,
  buildSettlementHealthMessage,
  runBacktestHealthCheck,
  READY_STUCK_AFTER_DAYS,
  type SettlementHealthInput,
} from "../health";
import { STALE_SETTLEMENT_AFTER_DAYS } from "../track-record";

const healthy: SettlementHealthInput = {
  today: "2026-11-21",
  hasPicks: true,
  lastEvaluatedAt: "2026-11-19T02:00:00.000Z",
  errors: 0,
  ready: 0,
  readySince: null,
};

const kinds = (input: Partial<SettlementHealthInput>) =>
  settlementHealthIssues({ ...healthy, ...input }).map((issue) => issue.kind);

describe("BT-HEALTH settlementHealthIssues", () => {
  test("settlement khoẻ → không issue nào", () => {
    expect(kinds({})).toEqual([]);
  });

  test("chốt cuối đúng ngưỡng chưa báo, vượt ngưỡng mới báo", () => {
    const exactly = kinds({ lastEvaluatedAt: "2026-11-16T02:00:00.000Z" });
    expect(STALE_SETTLEMENT_AFTER_DAYS).toBe(5);
    expect(exactly).toEqual([]); // 5 ngày = đúng ngưỡng

    const over = kinds({ lastEvaluatedAt: "2026-11-15T02:00:00.000Z" }); // 6 ngày
    expect(over).toEqual(["settlement-stale"]);
  });

  test("có pick nhưng chưa từng chốt (sự cố 14 ngày) → báo stale", () => {
    const issues = settlementHealthIssues({
      ...healthy,
      lastEvaluatedAt: null,
      hasPicks: true,
    });
    expect(issues.map((i) => i.kind)).toEqual(["settlement-stale"]);
    expect(issues[0].message).toContain("Chưa từng ghi nhận lần chốt nào");
  });

  test("chưa có pick nào → không báo (hệ thống mới, không phải sự cố)", () => {
    expect(kinds({ lastEvaluatedAt: null, hasPicks: false })).toEqual([]);
  });

  test("run có errors > 0 → báo riêng, kèm số lỗi", () => {
    const issues = settlementHealthIssues({ ...healthy, errors: 3 });
    expect(issues.map((i) => i.kind)).toEqual(["run-errors"]);
    expect(issues[0].message).toContain("3 lỗi");
  });

  test("pick sẵn sàng chốt treo đủ ngưỡng → báo; mới treo hôm nay thì chưa", () => {
    expect(READY_STUCK_AFTER_DAYS).toBe(2);
    // readySince hôm nay → 0 ngày
    expect(kinds({ ready: 4, readySince: "2026-11-21" })).toEqual([]);
    // 1 ngày → chưa đủ ngưỡng
    expect(kinds({ ready: 4, readySince: "2026-11-20" })).toEqual([]);
    // 2 ngày → báo
    const issues = settlementHealthIssues({
      ...healthy,
      ready: 4,
      readySince: "2026-11-19",
      noData: 2,
    });
    expect(issues.map((i) => i.kind)).toEqual(["ready-not-settling"]);
    expect(issues[0].message).toContain("4 pick sẵn sàng chốt từ 2026-11-19 (2 ngày)");
    expect(issues[0].message).toContain("2 pick thiếu nến");
  });

  test("sẵn sàng chốt = 0 → không báo dù còn mốc cũ", () => {
    expect(kinds({ ready: 0, readySince: "2026-11-01" })).toEqual([]);
  });

  test("nhiều vấn đề cùng lúc → gộp đủ trong một message", () => {
    const issues = settlementHealthIssues({
      ...healthy,
      lastEvaluatedAt: "2026-11-01T02:00:00.000Z",
      errors: 2,
      ready: 1,
      readySince: "2026-11-10",
    });
    expect(issues.map((i) => i.kind)).toEqual([
      "settlement-stale",
      "run-errors",
      "ready-not-settling",
    ]);

    const text = buildSettlementHealthMessage(issues, healthy.today);
    expect(text).toContain("Backtest settlement cần kiểm tra — 2026-11-21");
    expect(text).toContain("20 ngày trước");
    expect(text).toContain("2 lỗi");
    expect(text).toContain("1 pick sẵn sàng chốt từ 2026-11-10");
    expect(text).toContain("/track-record");
  });
});

describe("BT-HEALTH runBacktestHealthCheck", () => {
  test("trong test env là no-op (không gọi DB/webhook)", async () => {
    await expect(runBacktestHealthCheck({ errors: 5 })).resolves.toEqual({
      issues: [],
      alerted: 0,
    });
  });
});
