// RADAR-CONFIG — cấu hình runtime cho radar/catalyst, lưu trong `app_settings`.
//
// Env chỉ còn là ĐƯỜNG FALLBACK: giá trị trong DB (key `radar.config`) được ưu
// tiên; env dùng khi DB chưa có key, đọc DB lỗi, hoặc một field chưa từng lưu.
// Nhờ vậy đổi ngưỡng/URL trên Admin không cần restart server (cache 10 giây, và
// admin save sẽ cập nhật cache ngay).
//
// Module này KHÔNG import route/UI; consumer đọc qua `readRadarRuntimeConfig()`
// (async, có cache) hoặc `peekRadarRuntimeConfig()` (sync, dùng trong hàm sync
// sau khi request đã await bản async ở đầu).

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

export const RADAR_CONFIG_KEY = "radar.config";
export const RADAR_CONFIG_CACHE_MS = 10_000;

export type RadarConfigGroup = "cluster" | "alert" | "catalyst" | "scheduler";

export interface RadarRuntimeConfig {
  // Cụm rotation
  clusterUniverse: number;
  clusterThreshold: number;
  clusterMaxSize: number;
  enrichPerSide: number;
  unusualCandidates: number;
  // Alert radar (RADAR-03/06)
  alertWebhookUrl: string | null;
  alertMinScore: number;
  alertMinEntry: number;
  alertMaxImpulseHours: number;
  alertCooldownHours: number;
  // Catalyst (RADAR-06)
  catalystTriggerVolumeZ: number;
  catalystTriggerVolumeRatio: number;
  catalystTriggerAbsChangePct: number;
  catalystLlmEnabled: boolean;
  catalystLlmDailyLimit: number;
  catalystPerIpPerMin: number;
  catalystStaleCooldownHours: number;
  // Nhịp job catalyst trong FastAPI (SCHEDULER_CATALYST_*)
  schedulerEnabled: boolean;
  schedulerAnnouncementsMinutes: number;
  schedulerNewsMinutes: number;
  schedulerUnlocksMinutes: number;
  // Nhịp job cohort/ledger/alert (SCHEDULER_RADAR_COHORT_MINUTES)
  schedulerCohortMinutes: number;
  // Nhịp job outcome radar_bias_log (SCHEDULER_RADAR_BIAS_OUTCOME_MINUTES)
  schedulerBiasOutcomeMinutes: number;
}

export interface RadarConfigField {
  key: keyof RadarRuntimeConfig;
  env: string;
  label: string;
  hint: string;
  group: RadarConfigGroup;
  type: "int" | "float" | "bool" | "url";
  min?: number;
  max?: number;
  step?: number;
}

export const RADAR_CONFIG_GROUPS: Array<{ id: RadarConfigGroup; label: string; hint: string }> = [
  {
    id: "cluster",
    label: "Cụm rotation",
    hint: "Universe quét cụm, ngưỡng tương quan residual và số coin enrich mỗi tab.",
  },
  {
    id: "alert",
    label: "Alert radar",
    hint: "Webhook + ngưỡng gửi alert (cả alert kèm catalyst). Để trống URL = tắt alert.",
  },
  {
    id: "catalyst",
    label: "Catalyst",
    hint: "Điều kiện mở panel, LLM tóm tắt, rate limit và cooldown cảnh báo STALE.",
  },
  {
    id: "scheduler",
    label: "Nhịp job scheduler (FastAPI)",
    hint: "FastAPI đọc lại DB mỗi 30 giây và reschedule khi nhịp đổi — không cần restart. Nhịp catalyst ở đây cũng là ngưỡng cảnh báo STALE; nhịp cohort là khoảng cách tối thiểu giữa hai lượt ghi ledger/gửi alert. Token scheduler vẫn nằm ở env.",
  },
];

export const RADAR_CONFIG_FIELDS: RadarConfigField[] = [
  {
    key: "clusterUniverse",
    env: "RADAR_CLUSTER_UNIVERSE",
    label: "Universe quét cụm",
    hint: "Số coin đưa vào tính cụm (0 = tắt cụm). Tự nâng lên đủ chỗ cho 3 tab.",
    group: "cluster",
    type: "int",
    min: 0,
    max: 60,
  },
  {
    key: "clusterThreshold",
    env: "RADAR_CLUSTER_THRESHOLD",
    label: "Ngưỡng tương quan",
    hint: "Correlation residual tối thiểu để ghép cụm (0.3–0.9).",
    group: "cluster",
    type: "float",
    min: 0.3,
    max: 0.9,
    step: 0.01,
  },
  {
    key: "clusterMaxSize",
    env: "RADAR_CLUSTER_MAX_SIZE",
    label: "Cụm tối đa",
    hint: "Chặn siêu cụm (3–20 member).",
    group: "cluster",
    type: "int",
    min: 3,
    max: 20,
  },
  {
    key: "enrichPerSide",
    env: "RADAR_ENRICH_PER_SIDE",
    label: "Enrich mỗi tab",
    hint: "Số coin lấy klines/OI/funding cho mỗi bên (5–15).",
    group: "cluster",
    type: "int",
    min: 5,
    max: 15,
  },
  {
    key: "unusualCandidates",
    env: "RADAR_UNUSUAL_CANDIDATES",
    label: "Ứng viên unusual",
    hint: "Số coin quét cho tab unusual (6–20).",
    group: "cluster",
    type: "int",
    min: 6,
    max: 20,
  },
  {
    key: "alertWebhookUrl",
    env: "RADAR_ALERT_WEBHOOK_URL",
    label: "Webhook alert radar",
    hint: "URL http(s) nhận JSON {text}; để trống = tắt alert.",
    group: "alert",
    type: "url",
  },
  {
    key: "alertMinScore",
    env: "RADAR_ALERT_MIN_SCORE",
    label: "Score tối thiểu",
    hint: "0–100.",
    group: "alert",
    type: "int",
    min: 0,
    max: 100,
  },
  {
    key: "alertMinEntry",
    env: "RADAR_ALERT_MIN_ENTRY",
    label: "Entry quality tối thiểu",
    hint: "0–100.",
    group: "alert",
    type: "int",
    min: 0,
    max: 100,
  },
  {
    key: "alertMaxImpulseHours",
    env: "RADAR_ALERT_MAX_IMPULSE_HOURS",
    label: "Impulse tối đa (giờ)",
    hint: "Bỏ qua coin đã chạy quá lâu (0–168).",
    group: "alert",
    type: "int",
    min: 0,
    max: 168,
  },
  {
    key: "alertCooldownHours",
    env: "RADAR_ALERT_COOLDOWN_HOURS",
    label: "Cooldown theo symbol (giờ)",
    hint: "0–168.",
    group: "alert",
    type: "int",
    min: 0,
    max: 168,
  },
  {
    key: "catalystTriggerVolumeZ",
    env: "CATALYST_TRIGGER_VOLUME_Z",
    label: "Volume z-score",
    hint: "Panel mở khi volume z >= ngưỡng này.",
    group: "catalyst",
    type: "float",
    min: 0,
    max: 10,
    step: 0.1,
  },
  {
    key: "catalystTriggerVolumeRatio",
    env: "CATALYST_TRIGGER_VOLUME_RATIO",
    label: "Volume / TB 7 ngày",
    hint: "Panel mở khi tỷ lệ volume >= ngưỡng này.",
    group: "catalyst",
    type: "float",
    min: 0,
    max: 10,
    step: 0.1,
  },
  {
    key: "catalystTriggerAbsChangePct",
    env: "CATALYST_TRIGGER_ABS_CHANGE_PCT",
    label: "|Biến động 24h| (%)",
    hint: "Panel mở khi |change| >= ngưỡng này.",
    group: "catalyst",
    type: "float",
    min: 0,
    max: 100,
    step: 0.5,
  },
  {
    key: "catalystLlmEnabled",
    env: "CATALYST_LLM_ENABLED",
    label: "Dùng LLM tóm tắt",
    hint: "Tắt = chỉ template facts-only, không gọi provider.",
    group: "catalyst",
    type: "bool",
  },
  {
    key: "catalystLlmDailyLimit",
    env: "CATALYST_LLM_DAILY_LIMIT",
    label: "Trần LLM / ngày",
    hint: "0 = không giới hạn; vượt trần tự fallback template.",
    group: "catalyst",
    type: "int",
    min: 0,
    max: 100_000,
  },
  {
    key: "catalystPerIpPerMin",
    env: "CATALYST_PER_IP_PER_MIN",
    label: "Rate limit / IP / phút",
    hint: "Áp cho endpoint panel catalyst (1–10000).",
    group: "catalyst",
    type: "int",
    min: 1,
    max: 10_000,
  },
  {
    key: "catalystStaleCooldownHours",
    env: "CATALYST_STALE_ALERT_COOLDOWN_HOURS",
    label: "Cooldown STALE (giờ)",
    hint: "1–168; giờ tối thiểu giữa 2 cảnh báo cùng nguồn (giá trị <1 được coi là 1) để job 5 phút không spam feed chết.",
    group: "catalyst",
    type: "int",
    min: 1,
    max: 168,
  },
  {
    key: "schedulerEnabled",
    env: "SCHEDULER_CATALYST_ENABLED",
    label: "Bật job catalyst",
    hint: "Tắt = FastAPI gỡ cả 3 job khỏi APScheduler.",
    group: "scheduler",
    type: "bool",
  },
  {
    key: "schedulerAnnouncementsMinutes",
    env: "SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES",
    label: "Nhịp announcements (phút)",
    hint: "0 = tắt riêng job announcements (0–1440).",
    group: "scheduler",
    type: "int",
    min: 0,
    max: 1440,
  },
  {
    key: "schedulerNewsMinutes",
    env: "SCHEDULER_CATALYST_NEWS_MINUTES",
    label: "Nhịp news RSS (phút)",
    hint: "0 = tắt riêng job news (0–1440).",
    group: "scheduler",
    type: "int",
    min: 0,
    max: 1440,
  },
  {
    key: "schedulerUnlocksMinutes",
    env: "SCHEDULER_CATALYST_UNLOCKS_MINUTES",
    label: "Nhịp unlocks (phút)",
    hint: "0 = tắt riêng job unlocks (0–1440).",
    group: "scheduler",
    type: "int",
    min: 0,
    max: 1440,
  },
  {
    key: "schedulerCohortMinutes",
    env: "SCHEDULER_RADAR_COHORT_MINUTES",
    label: "Nhịp cohort/ledger/alert (phút)",
    hint: "0 = tắt job. FastAPI gọi POST /api/market/radar/cohort theo nhịp này; đây cũng là khoảng cách tối thiểu giữa 2 lượt (khoá DB, sàn 10 phút) nên nhiều instance không chạy trùng. Đổi nhịp không cần restart FastAPI.",
    group: "scheduler",
    type: "int",
    min: 0,
    max: 1440,
  },
  {
    key: "schedulerBiasOutcomeMinutes",
    env: "SCHEDULER_RADAR_BIAS_OUTCOME_MINUTES",
    label: "Nhịp tính outcome bias (phút)",
    hint: "0 = tắt job. FastAPI gọi POST /api/market/radar/bias-outcomes theo nhịp này để điền close/relative/MFE/MAE cho horizon 1h–7d trong radar_bias_log. Idempotent, chỉ đọc log — không đổi bias hiển thị.",
    group: "scheduler",
    type: "int",
    min: 0,
    max: 1440,
  },
];

/** Giá trị fallback lấy từ env (đúng như hành vi trước khi có config DB). */
export function envRadarConfig(env: NodeJS.ProcessEnv = process.env): RadarRuntimeConfig {
  const num = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    clusterUniverse: num("RADAR_CLUSTER_UNIVERSE", 32),
    clusterThreshold: num("RADAR_CLUSTER_THRESHOLD", 0.6),
    clusterMaxSize: num("RADAR_CLUSTER_MAX_SIZE", 8),
    enrichPerSide: num("RADAR_ENRICH_PER_SIDE", 10),
    unusualCandidates: num("RADAR_UNUSUAL_CANDIDATES", 12),
    alertWebhookUrl: env.RADAR_ALERT_WEBHOOK_URL?.trim() || null,
    alertMinScore: num("RADAR_ALERT_MIN_SCORE", 75),
    alertMinEntry: num("RADAR_ALERT_MIN_ENTRY", 50),
    alertMaxImpulseHours: num("RADAR_ALERT_MAX_IMPULSE_HOURS", 12),
    alertCooldownHours: num("RADAR_ALERT_COOLDOWN_HOURS", 6),
    catalystTriggerVolumeZ: num("CATALYST_TRIGGER_VOLUME_Z", 2),
    catalystTriggerVolumeRatio: num("CATALYST_TRIGGER_VOLUME_RATIO", 2.2),
    catalystTriggerAbsChangePct: num("CATALYST_TRIGGER_ABS_CHANGE_PCT", 10),
    catalystLlmEnabled: String(env.CATALYST_LLM_ENABLED ?? "1").toLowerCase() !== "0",
    catalystLlmDailyLimit: num("CATALYST_LLM_DAILY_LIMIT", 200),
    catalystPerIpPerMin: Math.max(1, Math.floor(num("CATALYST_PER_IP_PER_MIN", 20))),
    catalystStaleCooldownHours: num("CATALYST_STALE_ALERT_COOLDOWN_HOURS", 6),
    schedulerEnabled:
      String(env.SCHEDULER_CATALYST_ENABLED ?? "1").toLowerCase() !== "0",
    schedulerAnnouncementsMinutes: num("SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES", 5),
    schedulerNewsMinutes: num("SCHEDULER_CATALYST_NEWS_MINUTES", 15),
    schedulerUnlocksMinutes: num("SCHEDULER_CATALYST_UNLOCKS_MINUTES", 60),
    schedulerCohortMinutes: num("SCHEDULER_RADAR_COHORT_MINUTES", 30),
    schedulerBiasOutcomeMinutes: num("SCHEDULER_RADAR_BIAS_OUTCOME_MINUTES", 10),
  };
}

export class RadarConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RadarConfigError";
  }
}

function fieldSpec(key: keyof RadarRuntimeConfig): RadarConfigField {
  const spec = RADAR_CONFIG_FIELDS.find((field) => field.key === key);
  if (!spec) throw new RadarConfigError(`Không có tham số ${String(key)}.`);
  return spec;
}

/** Ép + kiểm tra một giá trị theo spec. Ném RadarConfigError nếu sai. */
export function coerceFieldValue(
  spec: RadarConfigField,
  raw: unknown
): RadarRuntimeConfig[keyof RadarRuntimeConfig] {
  if (spec.type === "bool") {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "1" || raw === 1) return true;
    if (raw === "false" || raw === "0" || raw === 0) return false;
    throw new RadarConfigError(`${spec.label}: phải là bật/tắt.`);
  }
  if (spec.type === "url") {
    if (raw === null || raw === undefined || raw === "") return null;
    if (typeof raw !== "string") throw new RadarConfigError(`${spec.label}: URL không hợp lệ.`);
    const value = raw.trim();
    if (!value) return null;
    if (!/^https?:\/\/\S+$/i.test(value)) {
      throw new RadarConfigError(`${spec.label}: URL phải bắt đầu bằng http(s)://.`);
    }
    return value.slice(0, 500);
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) throw new RadarConfigError(`${spec.label}: phải là số.`);
  const min = spec.min ?? 0;
  const max = spec.max ?? Number.MAX_SAFE_INTEGER;
  if (value < min || value > max) {
    throw new RadarConfigError(`${spec.label}: phải trong khoảng ${min}–${max}.`);
  }
  return spec.type === "int" ? Math.floor(value) : value;
}

/**
 * Gộp config đã lưu trong DB lên trên env fallback. Chỉ nhận field đã biết;
 * field lưu hỏng bị bỏ qua (dùng env) thay vì làm sập request.
 */
export function resolveRadarConfig(
  stored: unknown,
  env: NodeJS.ProcessEnv = process.env
): { config: RadarRuntimeConfig; applied: Array<keyof RadarRuntimeConfig> } {
  const config = envRadarConfig(env);
  const applied: Array<keyof RadarRuntimeConfig> = [];
  if (!stored || typeof stored !== "object") return { config, applied };
  const values = (stored as { values?: unknown }).values;
  if (!values || typeof values !== "object") return { config, applied };

  for (const spec of RADAR_CONFIG_FIELDS) {
    if (!(spec.key in (values as Record<string, unknown>))) continue;
    try {
      const coerced = coerceFieldValue(spec, (values as Record<string, unknown>)[spec.key]);
      (config as unknown as Record<string, unknown>)[spec.key] = coerced;
      applied.push(spec.key);
    } catch {
      // Giá trị lưu hỏng → giữ env fallback.
    }
  }
  return { config, applied };
}

interface CacheState {
  config: RadarRuntimeConfig;
  applied: Array<keyof RadarRuntimeConfig>;
  stored: Partial<RadarRuntimeConfig>;
  updatedAt: string | null;
  updatedBy: string | null;
  expires: number;
}

let cache: CacheState | null = null;
let inflight: Promise<CacheState> | null = null;

async function loadFromDb(): Promise<CacheState> {
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, RADAR_CONFIG_KEY))
      .limit(1);
    const value = row?.value as
      | { values?: Partial<RadarRuntimeConfig>; updatedAt?: string; updatedBy?: string }
      | undefined;
    const { config, applied } = resolveRadarConfig(value);
    return {
      config,
      applied,
      stored: value?.values ?? {},
      updatedAt: value?.updatedAt ?? null,
      updatedBy: value?.updatedBy ?? null,
      expires: Date.now() + RADAR_CONFIG_CACHE_MS,
    };
  } catch (error) {
    console.warn(
      "[RADAR-CONFIG] Không đọc được cấu hình từ DB, dùng env fallback:",
      error instanceof Error ? error.message : String(error)
    );
    return {
      config: envRadarConfig(),
      applied: [],
      stored: {},
      updatedAt: null,
      updatedBy: null,
      expires: Date.now() + 5_000,
    };
  }
}

export interface RadarConfigSnapshot {
  config: RadarRuntimeConfig;
  applied: Array<keyof RadarRuntimeConfig>;
  stored: Partial<RadarRuntimeConfig>;
  updatedAt: string | null;
  updatedBy: string | null;
}

function snapshot(state: CacheState): RadarConfigSnapshot {
  return {
    config: state.config,
    applied: state.applied,
    stored: state.stored,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
  };
}

/** Đọc config hiện hành (DB > env > default), cache ngắn để không query mỗi row. */
export async function readRadarRuntimeConfig(): Promise<RadarConfigSnapshot> {
  if (cache && cache.expires > Date.now()) return snapshot(cache);
  if (!inflight) {
    inflight = loadFromDb().finally(() => {
      inflight = null;
    });
  }
  cache = await inflight;
  return snapshot(cache);
}

/** Sync cho code thuần (sau khi route đã await bản async); fallback env. */
export function peekRadarRuntimeConfig(): RadarRuntimeConfig {
  return cache?.config ?? envRadarConfig();
}

/** Ghi đè một phần cấu hình; validate toàn bộ trước khi lưu. */
export async function updateRadarRuntimeConfig(
  patch: Record<string, unknown>,
  updatedBy = "admin"
): Promise<RadarConfigSnapshot> {
  if (!patch || typeof patch !== "object") {
    throw new RadarConfigError("Payload phải là object { values }.");
  }
  const current = await readRadarRuntimeConfig();
  const values: Partial<RadarRuntimeConfig> = { ...current.stored };
  for (const [key, raw] of Object.entries(patch)) {
    if (!RADAR_CONFIG_FIELDS.some((field) => field.key === key)) {
      throw new RadarConfigError(`Tham số không hợp lệ: ${key}.`);
    }
    const spec = fieldSpec(key as keyof RadarRuntimeConfig);
    (values as Record<string, unknown>)[spec.key] = coerceFieldValue(spec, raw);
  }

  const { config, applied } = resolveRadarConfig({ values });
  const updatedAt = new Date().toISOString();
  const value = { values, updatedAt, updatedBy };

  await db
    .insert(appSettings)
    .values({ key: RADAR_CONFIG_KEY, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });

  cache = {
    config,
    applied,
    stored: values,
    updatedAt,
    updatedBy,
    expires: Date.now() + RADAR_CONFIG_CACHE_MS,
  };
  return snapshot(cache);
}

/** Xoá cache (test hoặc sau khi sửa DB trực tiếp). */
export function invalidateRadarConfigCache(): void {
  cache = null;
}
