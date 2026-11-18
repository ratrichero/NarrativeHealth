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
  });

  it("đọc env và bỏ giá trị không phải số", () => {
    const config = envRadarConfig({
      RADAR_CLUSTER_THRESHOLD: "0.42",
      RADAR_ALERT_WEBHOOK_URL: " https://hooks.example/x ",
      CATALYST_LLM_ENABLED: "0",
      CATALYST_PER_IP_PER_MIN: "abc",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.clusterThreshold).toBe(0.42);
    expect(config.alertWebhookUrl).toBe("https://hooks.example/x");
    expect(config.catalystLlmEnabled).toBe(false);
    expect(config.catalystPerIpPerMin).toBe(20);
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

  it("bool nhận boolean và chuỗi 0/1", () => {
    expect(coerceFieldValue(spec("catalystLlmEnabled"), true)).toBe(true);
    expect(coerceFieldValue(spec("catalystLlmEnabled"), "0")).toBe(false);
    expect(() => coerceFieldValue(spec("catalystLlmEnabled"), "maybe")).toThrow(RadarConfigError);
  });
});
