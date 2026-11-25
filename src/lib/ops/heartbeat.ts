/**
 * OPS-HEARTBEAT — phát hiện scheduler/refresh "chết âm thầm".
 *
 * Nguồn sự thật là `scheduler_logs`: mỗi lượt refresh đều ghi STARTED rồi
 * COMPLETED/FAILED. Nếu một lượt bị chặn bởi ENV-GUARD (403) hoặc APScheduler
 * chết, bảng này đứng yên — dashboard vẫn mở bình thường nên không ai thấy.
 *
 * Module này chỉ chứa logic thuần (không DB) để test được; phần đọc DB và gửi
 * cảnh báo nằm ở `scheduler-heartbeat.ts`.
 */

export const SCHEDULER_STALL_HOURS_VAR = "SCHEDULER_STALL_HOURS";
export const SCHEDULER_INTERVAL_HOURS_VAR = "SCHEDULER_INTERVAL_HOURS";
export const SCHEDULER_STALL_ALERT_COOLDOWN_VAR = "SCHEDULER_STALL_ALERT_COOLDOWN_HOURS";

/** Nhịp mặc định của FastAPI: chạy 1 lần/ngày 07:00 (VN). */
export const DAILY_CADENCE_HOURS = 24;

export interface SchedulerHeartbeatRow {
  jobName: string;
  status: string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
}

export interface SchedulerHeartbeatStatus {
  stalled: boolean;
  stallHours: number;
  lastSuccessAt: string | null;
  hoursSince: number | null;
  jobName: string | null;
}

/**
 * Chỉ tính job do scheduler sinh ra. Refresh tay (`manual_refresh`,
 * `refresh_coin_*`, `p3_execute_*`…) không được che việc cron đã chết, nên
 * không nằm trong danh sách này.
 */
export function isScheduledRefreshJob(jobName: string): boolean {
  const name = (jobName ?? "").trim().toLowerCase();
  return (
    name === "daily_refresh" ||
    name === "interval_refresh" ||
    name === "daily_refresh_trigger" ||
    name === "interval_refresh_trigger"
  );
}

function positiveInt(raw: string | undefined, min: number, max: number): number | null {
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/**
 * Ngưỡng "quá lâu không thành công", tính bằng giờ:
 *   • `SCHEDULER_STALL_HOURS` nếu set (1–168).
 *   • nếu chạy theo chu kỳ (`SCHEDULER_INTERVAL_HOURS` > 0): 1.5 nhịp + 1h,
 *     tối thiểu 3h — một lượt chậm do tải không bị báo nhầm.
 *   • mặc định 26h (nhịp ngày 07:00 + 2h đệm).
 */
export type EnvLike = Record<string, string | undefined>;

export function resolveStallHours(env: EnvLike = process.env): number {
  const explicit = positiveInt(env[SCHEDULER_STALL_HOURS_VAR], 1, 168);
  if (explicit !== null) return explicit;

  const interval = positiveInt(env[SCHEDULER_INTERVAL_HOURS_VAR], 1, 168);
  if (interval !== null) return Math.min(168, Math.max(3, Math.ceil(interval * 1.5) + 1));

  return DAILY_CADENCE_HOURS + 2;
}

/** Cooldown cảnh báo (giờ), 1–168, mặc định 6. */
export function resolveStallAlertCooldownHours(env: EnvLike = process.env): number {
  return positiveInt(env[SCHEDULER_STALL_ALERT_COOLDOWN_VAR], 1, 168) ?? 6;
}

function timestampOf(row: SchedulerHeartbeatRow): number {
  const raw = row.completedAt ?? row.startedAt;
  if (raw == null) return NaN;
  return raw instanceof Date ? raw.getTime() : Date.parse(raw);
}

/**
 * Trạng thái tim đập: lượt COMPLETED gần nhất của job scheduler.
 * Không có lượt nào → stalled (đây chính là trường hợp VPS thiếu env).
 */
export function evaluateSchedulerHeartbeat(
  rows: SchedulerHeartbeatRow[],
  now: number = Date.now(),
  stallHours: number = resolveStallHours()
): SchedulerHeartbeatStatus {
  let latest: { at: number; jobName: string } | null = null;

  for (const row of rows) {
    if ((row.status ?? "").trim().toUpperCase() !== "COMPLETED") continue;
    if (!isScheduledRefreshJob(row.jobName)) continue;
    const at = timestampOf(row);
    if (!Number.isFinite(at)) continue;
    if (!latest || at > latest.at) latest = { at, jobName: row.jobName };
  }

  if (!latest) {
    return {
      stalled: true,
      stallHours,
      lastSuccessAt: null,
      hoursSince: null,
      jobName: null,
    };
  }

  const hoursSince = Math.max(0, Math.round(((now - latest.at) / 3_600_000) * 10) / 10);
  return {
    stalled: hoursSince > stallHours,
    stallHours,
    lastSuccessAt: new Date(latest.at).toISOString(),
    hoursSince,
    jobName: latest.jobName,
  };
}

export function buildSchedulerStallMessage(
  status: SchedulerHeartbeatStatus,
  at: Date = new Date()
): string {
  const last =
    status.lastSuccessAt === null
      ? "chưa có lượt refresh/scheduler nào COMPLETED"
      : `lần cuối ${status.lastSuccessAt} (${status.hoursSince ?? "?"} giờ trước, job ${status.jobName ?? "?"})`;

  return [
    "⚠️ [NarrativeHealth] Scheduler không có lượt thành công nào trong thời gian dài",
    "",
    `Trạng thái: ${last}`,
    `Ngưỡng cảnh báo: ${status.stallHours} giờ`,
    `Thời điểm kiểm tra: ${at.toISOString()}`,
    "",
    "Kiểm tra theo thứ tự:",
    "1. `scheduler_logs` — lượt gần nhất STARTED/FAILED và `error_message`.",
    "2. Log Next/FastAPI: có 403 ENV-GUARD (thiếu PRODUCTION_ALLOWED_HOSTS) không.",
    "3. APScheduler còn sống không (backend/main.py chỉ start khi APP_ENV=production).",
    "",
    "Checklist: docs/VPS_ENV_CHECKLIST.md",
  ].join("\n");
}
