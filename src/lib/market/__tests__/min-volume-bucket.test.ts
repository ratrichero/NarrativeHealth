import {
  DEFAULT_MIN_VOLUME_USD,
  MIN_VOLUME_BUCKETS,
  normalizeMinVolume,
} from "../radar";

describe("normalizeMinVolume", () => {
  const original = process.env.RADAR_MIN_VOLUME_USD;

  beforeEach(() => {
    delete process.env.RADAR_MIN_VOLUME_USD;
  });

  afterAll(() => {
    if (original === undefined) delete process.env.RADAR_MIN_VOLUME_USD;
    else process.env.RADAR_MIN_VOLUME_USD = original;
  });

  it("giữ nguyên đúng các mốc UI", () => {
    for (const bucket of MIN_VOLUME_BUCKETS) {
      expect(normalizeMinVolume(bucket)).toBe(bucket);
    }
  });

  it("làm tròn lên để filter không lỏng hơn yêu cầu", () => {
    expect(normalizeMinVolume(1)).toBe(5_000_000);
    expect(normalizeMinVolume(6_000_000)).toBe(10_000_000);
    expect(normalizeMinVolume(12_000_000)).toBe(25_000_000);
    expect(normalizeMinVolume(26_000_000)).toBe(50_000_000);
    expect(normalizeMinVolume(51_000_000)).toBe(100_000_000);
  });

  it("chặn trên ở bucket cao nhất thay vì tạo key mới", () => {
    expect(normalizeMinVolume(500_000_000)).toBe(100_000_000);
  });

  it("giá trị thiếu/không hợp lệ dùng default, không tạo bucket rác", () => {
    expect(normalizeMinVolume()).toBe(DEFAULT_MIN_VOLUME_USD);
    expect(normalizeMinVolume(0)).toBe(DEFAULT_MIN_VOLUME_USD);
    expect(normalizeMinVolume(-5)).toBe(DEFAULT_MIN_VOLUME_USD);
    expect(normalizeMinVolume(Number.NaN)).toBe(DEFAULT_MIN_VOLUME_USD);
  });

  it("chỉ có tối đa 5 key từ tham số tuỳ ý", () => {
    const keys = new Set<number>();
    for (const raw of [1, 4_999_999, 5_000_000, 7_777_777, 10_000_000, 24_000_000, 90_000_000]) {
      keys.add(normalizeMinVolume(raw));
    }
    expect(keys.size).toBeLessThanOrEqual(MIN_VOLUME_BUCKETS.length);
    for (const key of keys) expect(MIN_VOLUME_BUCKETS).toContain(key);
  });
});
