import {
  DEFAULT_MIN_VOLUME_USD,
  MIN_VOLUME_BUCKETS,
  MIN_VOLUME_MAX_USD,
  MinVolumeOutOfRangeError,
  getRadarSnapshot,
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

  it("vượt bucket cao nhất bị TỪ CHỐI, không kẹp xuống làm filter lỏng hơn", () => {
    expect(normalizeMinVolume(MIN_VOLUME_MAX_USD)).toBe(MIN_VOLUME_MAX_USD);
    expect(() => normalizeMinVolume(MIN_VOLUME_MAX_USD + 1)).toThrow(MinVolumeOutOfRangeError);
    expect(() => normalizeMinVolume(500_000_000)).toThrow(MinVolumeOutOfRangeError);
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

// Default lấy từ env cũng phải nằm trong bucket: nếu không, env lẻ tạo cache key
// ngoài bucket còn env > mốc cao nhất làm filter lỏng hơn ngưỡng UI.
describe("RADAR_MIN_VOLUME_USD ngoài bucket", () => {
  const originalDemo = process.env.RADAR_DEMO;
  const originalMinVolume = process.env.RADAR_MIN_VOLUME_USD;

  beforeEach(() => {
    process.env.RADAR_DEMO = "1";
  });

  afterAll(() => {
    if (originalDemo === undefined) delete process.env.RADAR_DEMO;
    else process.env.RADAR_DEMO = originalDemo;
    if (originalMinVolume === undefined) delete process.env.RADAR_MIN_VOLUME_USD;
    else process.env.RADAR_MIN_VOLUME_USD = originalMinVolume;
  });

  it("env lẻ được làm tròn lên bucket, không tạo cache key riêng", async () => {
    process.env.RADAR_MIN_VOLUME_USD = "15000000";
    const snapshot = await getRadarSnapshot({ side: "gainer" });
    expect(snapshot.minVolume).toBe(25_000_000);
    expect(MIN_VOLUME_BUCKETS).toContain(snapshot.minVolume);
    expect(normalizeMinVolume(15_000_000)).toBe(snapshot.minVolume);
  });

  it("env vượt bucket cao nhất bị kẹp về 100M, không throw", async () => {
    process.env.RADAR_MIN_VOLUME_USD = "500000000";
    const snapshot = await getRadarSnapshot({ side: "gainer" });
    expect(snapshot.minVolume).toBe(MIN_VOLUME_MAX_USD);
    expect(normalizeMinVolume()).toBe(MIN_VOLUME_MAX_USD);
  });

  it("env không hợp lệ vẫn về default 10M", async () => {
    process.env.RADAR_MIN_VOLUME_USD = "not-a-number";
    const snapshot = await getRadarSnapshot({ side: "gainer" });
    expect(snapshot.minVolume).toBe(DEFAULT_MIN_VOLUME_USD);
  });
});

// Snapshot phải nói ra bucket đã áp thật, để permalink/ledger so sánh đúng
// thay vì tưởng filter là giá trị thô người dùng gửi lên.
describe("RadarSnapshot.minVolume", () => {
  const originalDemo = process.env.RADAR_DEMO;
  const originalMinVolume = process.env.RADAR_MIN_VOLUME_USD;

  beforeEach(() => {
    process.env.RADAR_DEMO = "1";
    delete process.env.RADAR_MIN_VOLUME_USD;
  });

  afterAll(() => {
    if (originalDemo === undefined) delete process.env.RADAR_DEMO;
    else process.env.RADAR_DEMO = originalDemo;
    if (originalMinVolume === undefined) delete process.env.RADAR_MIN_VOLUME_USD;
    else process.env.RADAR_MIN_VOLUME_USD = originalMinVolume;
  });

  it("trả bucket hiệu lực (làm tròn lên), không phải giá trị thô trong URL", async () => {
    const snapshot = await getRadarSnapshot({ side: "gainer", minVolume: 26_000_000 });
    expect(snapshot.minVolume).toBe(50_000_000);
    expect(snapshot.rows.length).toBeGreaterThan(0);
  });

  it("không truyền minVolume → bucket mặc định", async () => {
    const snapshot = await getRadarSnapshot({ side: "gainer" });
    expect(snapshot.minVolume).toBe(DEFAULT_MIN_VOLUME_USD);
  });

  it("hai request cùng bucket trả cùng minVolume (permalink không lệch)", async () => {
    const rounded = await getRadarSnapshot({ side: "gainer", minVolume: 26_000_000 });
    const exact = await getRadarSnapshot({ side: "gainer", minVolume: 50_000_000 });
    expect(rounded.minVolume).toBe(exact.minVolume);
  });
});
