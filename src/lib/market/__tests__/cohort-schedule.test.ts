// RADAR-COHORT: nhịp + khoá của job cohort/ledger/alert (pure, không cần DB).
import {
  COHORT_DUE_TOLERANCE_MS,
  DEFAULT_COHORT_INTERVAL_MINUTES,
  MAX_COHORT_INTERVAL_MINUTES,
  MIN_COHORT_LEASE_MINUTES,
  cohortIntervalMinutes,
  cohortLeaseMs,
} from "@/lib/market/track-record";

jest.mock("@/db", () => ({ db: { execute: jest.fn() } }));

describe("cohort schedule", () => {
  it("dùng nhịp mặc định khi giá trị thiếu hoặc hỏng", () => {
    expect(cohortIntervalMinutes(undefined)).toBe(DEFAULT_COHORT_INTERVAL_MINUTES);
    expect(cohortIntervalMinutes(null)).toBe(DEFAULT_COHORT_INTERVAL_MINUTES);
    expect(cohortIntervalMinutes("abc")).toBe(DEFAULT_COHORT_INTERVAL_MINUTES);
    expect(cohortIntervalMinutes(-5)).toBe(DEFAULT_COHORT_INTERVAL_MINUTES);
    expect(cohortIntervalMinutes(Number.NaN)).toBe(DEFAULT_COHORT_INTERVAL_MINUTES);
  });

  it("giữ 0 = tắt job thay vì rơi về mặc định", () => {
    expect(cohortIntervalMinutes(0)).toBe(0);
    expect(cohortIntervalMinutes("0")).toBe(0);
  });

  it("ép số nguyên và kẹp trần 1440 phút", () => {
    expect(cohortIntervalMinutes("15")).toBe(15);
    expect(cohortIntervalMinutes(12.9)).toBe(12);
    expect(cohortIntervalMinutes(99_999)).toBe(MAX_COHORT_INTERVAL_MINUTES);
  });

  it("khoá giữ ít nhất 10 phút và đúng bằng nhịp khi nhịp dài hơn", () => {
    expect(cohortLeaseMs(1)).toBe(MIN_COHORT_LEASE_MINUTES * 60_000);
    expect(cohortLeaseMs(0)).toBe(MIN_COHORT_LEASE_MINUTES * 60_000);
    expect(cohortLeaseMs(30)).toBe(30 * 60_000);
    expect(cohortLeaseMs(120)).toBe(120 * 60_000);
    expect(COHORT_DUE_TOLERANCE_MS).toBeLessThan(MIN_COHORT_LEASE_MINUTES * 60_000);
  });
});
