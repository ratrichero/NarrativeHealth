import {
  RADAR_CONFIG_FIELDS,
  RadarConfigError,
  coerceFieldValue,
  envRadarConfig,
  resolveRadarConfig,
} from "@/lib/settings/radar-config";

const spec = (key: string) => {
  const found = RADAR_CONFIG_FIELDS.find((field) => field.key === key);
  if (!found) throw new Error(`missing spec ${key}`);
  return found;
};

describe("envRadarConfig", () => {
  it("dùng default khi không có env", () => {
    const config = envRadarConfig({} as unknown as NodeJS.ProcessEnv);
    expect(config.clusterUniverse).toBe(32);
    expect(config.clusterThreshold).toBe(0.6);
    expect(config.alertWebhookUrl).toBeNull();
    expect(config.catalystLlmEnabled).toBe(true);
    expect(config.catalystPerIpPerMin).toBe(20);
    expect(config.schedulerEnabled).toBe(true);
    expect(config.schedulerAnnouncementsMinutes).toBe(5);
    expect(config.schedulerNewsMinutes).toBe(15);
    expect(config.schedulerUnlocksMinutes).toBe(60);
    expect(config.telegramTargets).toEqual([]);
  });

  it("RADAR_TELEGRAM_TARGETS vẫn là fallback env cho telegramTargets", () => {
    const config = envRadarConfig({
      RADAR_TELEGRAM_TARGETS:
        '[{"chatId":"-1001","label":"public"},{"chatId":"-1002","threadId":42,"minScore":80}]',
    } as unknown as NodeJS.ProcessEnv);
    expect(config.telegramTargets).toEqual([
      { chatId: "-1001", label: "public" },
      { chatId: "-1002", threadId: 42, minScore: 80 },
    ]);
  });

  it("đọc env và bỏ giá trị không phải số", () => {
    const config = envRadarConfig({
      RADAR_CLUSTER_THRESHOLD: "0.42",
      RADAR_ALERT_WEBHOOK_URL: " https://hooks.example/x ",
      CATALYST_LLM_ENABLED: "0",
      CATALYST_PER_IP_PER_MIN: "abc",
      SCHEDULER_CATALYST_ENABLED: "0",
      SCHEDULER_CATALYST_NEWS_MINUTES: "7",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.clusterThreshold).toBe(0.42);
    expect(config.alertWebhookUrl).toBe("https://hooks.example/x");
    expect(config.catalystLlmEnabled).toBe(false);
    expect(config.catalystPerIpPerMin).toBe(20);
    expect(config.schedulerEnabled).toBe(false);
    expect(config.schedulerNewsMinutes).toBe(7);
  });

  // Parity với FastAPI (`_as_minutes`): nhịp âm = 0 = gỡ job, KHÔNG fallback
  // về default (fallback sẽ khiến health báo STALE vĩnh viễn cho job đã gỡ).
  it("nhịp âm = 0, không fallback default", () => {
    const config = envRadarConfig({
      SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES: "-5",
      SCHEDULER_CATALYST_NEWS_MINUTES: "-0.5",
      SCHEDULER_CATALYST_UNLOCKS_MINUTES: "0",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.schedulerAnnouncementsMinutes).toBe(0);
    expect(config.schedulerNewsMinutes).toBe(0);
    expect(config.schedulerUnlocksMinutes).toBe(0);
  });

  it("nhịp > 1440 bị kẹp 1440, số lẻ được floor", () => {
    const config = envRadarConfig({
      SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES: "99999",
      SCHEDULER_CATALYST_NEWS_MINUTES: "2.9",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.schedulerAnnouncementsMinutes).toBe(1440);
    expect(config.schedulerNewsMinutes).toBe(2);
  });

  it("SCHEDULER_CATALYST_ENABLED nhận false/no/off như FastAPI", () => {
    for (const raw of ["0", "false", "off", "NO"]) {
      const config = envRadarConfig({
        SCHEDULER_CATALYST_ENABLED: raw,
      } as unknown as NodeJS.ProcessEnv);
      expect(config.schedulerEnabled).toBe(false);
    }
    expect(
      envRadarConfig({ SCHEDULER_CATALYST_ENABLED: "on" } as unknown as NodeJS.ProcessEnv)
        .schedulerEnabled
    ).toBe(true);
    // Giá trị rác giữ fallback (job vẫn bật), không âm thầm gỡ job.
    expect(
      envRadarConfig({ SCHEDULER_CATALYST_ENABLED: "maybe" } as unknown as NodeJS.ProcessEnv)
        .schedulerEnabled
    ).toBe(true);
  });

  it("nhịp rỗng/không phải số vẫn dùng default như FastAPI", () => {
    const config = envRadarConfig({
      SCHEDULER_CATALYST_NEWS_MINUTES: "",
      SCHEDULER_CATALYST_UNLOCKS_MINUTES: "abc",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.schedulerNewsMinutes).toBe(15);
    expect(config.schedulerUnlocksMinutes).toBe(60);
  });
});

describe("resolveRadarConfig", () => {
  it("giá trị trong DB ưu tiên hơn env, field thiếu lấy env", () => {
    const { config, applied } = resolveRadarConfig(
      { values: { clusterThreshold: 0.75, alertCooldownHours: 2 } },
      { RADAR_CLUSTER_THRESHOLD: "0.4", RADAR_CLUSTER_MAX_SIZE: "12" } as unknown as NodeJS.ProcessEnv
    );
    expect(config.clusterThreshold).toBe(0.75);
    expect(config.alertCooldownHours).toBe(2);
    expect(config.clusterMaxSize).toBe(12);
    expect(applied.sort()).toEqual(["alertCooldownHours", "clusterThreshold"]);
  });

  it("telegramTargets: DB thay toàn bộ env, mảng rỗng cũng là giá trị hợp lệ", () => {
    const env = {
      RADAR_TELEGRAM_TARGETS: '-1001,-1002:7',
    } as unknown as NodeJS.ProcessEnv;
    const stored = resolveRadarConfig(
      { values: { telegramTargets: [{ chatId: "-2001", threadId: 9, minScore: 90 }] } },
      env
    );
    expect(stored.config.telegramTargets).toEqual([
      { chatId: "-2001", threadId: 9, minScore: 90 },
    ]);
    expect(stored.applied).toEqual(["telegramTargets"]);

    const cleared = resolveRadarConfig({ values: { telegramTargets: [] } }, env);
    expect(cleared.config.telegramTargets).toEqual([]);
  });

  it("bỏ qua field lưu hỏng thay vì làm sập config", () => {
    const { config } = resolveRadarConfig(
      { values: { clusterThreshold: 99, clusterUniverse: 40 } },
      {} as unknown as NodeJS.ProcessEnv
    );
    expect(config.clusterThreshold).toBe(0.6);
    expect(config.clusterUniverse).toBe(40);
  });

  it("payload lạ/không có values → env fallback", () => {
    expect(resolveRadarConfig(null).applied).toEqual([]);
    expect(resolveRadarConfig({ foo: 1 }).config.clusterUniverse).toBe(32);
  });
});

describe("coerceFieldValue", () => {
  it("ép int và kiểm tra biên", () => {
    expect(coerceFieldValue(spec("clusterMaxSize"), "9.9")).toBe(9);
    expect(() => coerceFieldValue(spec("clusterMaxSize"), 2)).toThrow(RadarConfigError);
    expect(() => coerceFieldValue(spec("clusterMaxSize"), "abc")).toThrow(RadarConfigError);
  });

  it("url rỗng → null, sai scheme → lỗi", () => {
    expect(coerceFieldValue(spec("alertWebhookUrl"), "")).toBeNull();
    expect(coerceFieldValue(spec("alertWebhookUrl"), "https://x.test/hook")).toBe(
      "https://x.test/hook"
    );
    expect(() => coerceFieldValue(spec("alertWebhookUrl"), "ftp://x")).toThrow(RadarConfigError);
  });

  it("cooldown STALE tối thiểu 1 giờ, khớp với clamp trong health.ts", () => {
    expect(coerceFieldValue(spec("catalystStaleCooldownHours"), 1)).toBe(1);
    expect(() => coerceFieldValue(spec("catalystStaleCooldownHours"), 0)).toThrow(
      RadarConfigError
    );
  });

  it("nhịp job nhận 0 (tắt) và chặn quá 1440 phút", () => {
    expect(coerceFieldValue(spec("schedulerAnnouncementsMinutes"), "0")).toBe(0);
    expect(coerceFieldValue(spec("schedulerNewsMinutes"), 10)).toBe(10);
    expect(() => coerceFieldValue(spec("schedulerUnlocksMinutes"), 1441)).toThrow(
      RadarConfigError
    );
  });

  it("targets: nhận mảng/chuỗi JSON, từ chối entry hỏng hoặc trùng", () => {
    expect(
      coerceFieldValue(spec("telegramTargets"), [
        { chatId: "-1001", threadId: "42", minScore: "80" },
      ])
    ).toEqual([{ chatId: "-1001", threadId: 42, minScore: 80 }]);
    expect(
      coerceFieldValue(spec("telegramTargets"), '[{"chatId":"-1002","label":"paid"}]')
    ).toEqual([{ chatId: "-1002", label: "paid" }]);
    expect(coerceFieldValue(spec("telegramTargets"), "")).toEqual([]);
    expect(() => coerceFieldValue(spec("telegramTargets"), "[not json")).toThrow(
      RadarConfigError
    );
    expect(() =>
      coerceFieldValue(spec("telegramTargets"), [{ chatId: "not-a-chat" }])
    ).toThrow(RadarConfigError);
    expect(() =>
      coerceFieldValue(spec("telegramTargets"), [
        { chatId: "-1" },
        { chatId: "-1" },
      ])
    ).toThrow(/trùng/);
  });

  it("bool nhận boolean và chuỗi 0/1", () => {
    expect(coerceFieldValue(spec("catalystLlmEnabled"), true)).toBe(true);
    expect(coerceFieldValue(spec("catalystLlmEnabled"), "0")).toBe(false);
    expect(() => coerceFieldValue(spec("catalystLlmEnabled"), "maybe")).toThrow(RadarConfigError);
  });
});
