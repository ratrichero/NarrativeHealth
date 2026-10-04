// BT-08 — daily backtest digest: test thuần builder text (không gửi thật,
// không đụng DB — mock @/db + alert-delivery để import module không side-effect).

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

import { buildDailyDigest, type DailyDigestStats } from "../digest";

const base: DailyDigestStats = {
  date: "2026-10-02",
  settledToday: { wins: 2, losses: 1, expired: 1, skipped: 3 },
  win7d: { wins: 10, losses: 6 },
  pending: 15,
  ready: 2,
  noData: 0,
  lastEvaluatedAt: "2026-10-02T07:15:00.000Z",
};

describe("BT-08 buildDailyDigest", () => {
  test("render đủ 4 khối: ngày, chốt hôm nay, win rate 7d, PENDING", () => {
    const text = buildDailyDigest(base);
    expect(text).toContain("Backtest digest — 2026-10-02");
    expect(text).toContain("Hôm nay chốt: 7 pick (2 thắng · 1 thua · 1 hết hạn · 3 bỏ qua)");
    expect(text).toContain("Win rate 7 ngày: 62.5% (16 lệnh: 10T / 6L)");
    expect(text).toContain("Còn PENDING: 15 · sẵn sàng chốt (14d): 2");
    expect(text).toContain("Lần chốt cuối: 2026-10-02 07:15");
    // noData = 0 → không hiện phần "thiếu nến"
    expect(text).not.toContain("thiếu nến");
  });

  test("noData > 0 → báo rõ pick thiếu nến", () => {
    const text = buildDailyDigest({ ...base, noData: 4 });
    expect(text).toContain("thiếu nến: 4");
  });

  test("chưa có lệnh chốt 7 ngày → fallback, win7d null không crash", () => {
    const text = buildDailyDigest({ ...base, win7d: null, lastEvaluatedAt: null });
    expect(text).toContain("chưa có lệnh chốt nào");
    expect(text).not.toContain("Lần chốt cuối");
  });

  test("hôm nay không chốt gì → 0 pick, các nhóm đều 0", () => {
    const text = buildDailyDigest({
      ...base,
      settledToday: { wins: 0, losses: 0, expired: 0, skipped: 0 },
    });
    expect(text).toContain("Hôm nay chốt: 0 pick (0 thắng · 0 thua · 0 hết hạn · 0 bỏ qua)");
  });
});
