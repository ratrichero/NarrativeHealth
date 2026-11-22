// BT-HEALTH — cảnh báo chủ động khi backtest/settlement chết âm thầm.
//
// Trước đây dữ liệu cũ chỉ hiện thành banner trên /track-record, nên khi
// settlement đứng 14 ngày không ai biết cho tới lúc mở web. Module này dùng LẠI
// kênh alert sẵn có (`dispatchCustomText` → Telegram / ALERT_WEBHOOK_URL /
// email, xem ALERT-02) và bắt đúng ba kiểu hỏng:
//
//   1. `settlement-stale`   — chốt cuối đã quá STALE_SETTLEMENT_AFTER_DAYS ngày
//                             (hoặc chưa từng chốt dù đã có pick).
//   2. `run-errors`         — lần chạy chốt gần nhất có lỗi ghi DB/evaluator.
//   3. `ready-not-settling` — có pick "sẵn sàng chốt" (đã đóng window, đủ nến)
//                             treo quá READY_STUCK_AFTER_DAYS ngày mà vẫn PENDING.
//
// Dedupe theo loại issue + cooldown để refresh nhiều lần trong ngày không dội
// kênh. Không cấu hình kênh nào → không đánh dấu "đã gửi", lần sau còn thử.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { dispatchCustomText } from "@/lib/services/alert-delivery.service";
import { getBusinessDate } from "@/lib/utils";
import { daysBetween } from "./engine";
import { getBacktestStatus, DEFAULT_HORIZON } from "./settlement";
import { STALE_SETTLEMENT_AFTER_DAYS } from "./track-record";

/** Số ngày treo "sẵn sàng chốt" trước khi coi là settlement kẹt. */
export const READY_STUCK_AFTER_DAYS = 2;

/** Cooldown mặc định giữa hai cảnh báo cùng loại (giờ). */
export const DEFAULT_HEALTH_ALERT_COOLDOWN_HOURS = 24;

const STATE_KEY = "backtest.health.state";
const KEEP_DAYS = 30;

export type SettlementIssueKind = "settlement-stale" | "run-errors" | "ready-not-settling";

export interface SettlementHealthInput {
  /** Business date (YYYY-MM-DD). */
  today: string;
  /** Có pick nào trong bảng chưa (để phân biệt "chưa có gì" với "có mà không chốt"). */
  hasPicks: boolean;
  lastEvaluatedAt: string | null;
  /** Số lỗi của lần chạy settlement gần nhất. */
  errors: number;
  /** Số pick sẵn sàng chốt ở horizon auto-settle. */
  ready: number;
  /** Ngày đầu tiên thấy ready > 0 (null = hiện không có pick nào chờ chốt). */
  readySince: string | null;
  noData?: number;
}

export interface SettlementIssue {
  kind: SettlementIssueKind;
  message: string;
}

/**
 * Pure: các vấn đề cần báo. Ngưỡng stale dùng chung với banner công khai
 * (`STALE_SETTLEMENT_AFTER_DAYS`) để web và alert không nói hai câu khác nhau.
 */
export function settlementHealthIssues(input: SettlementHealthInput): SettlementIssue[] {
  const issues: SettlementIssue[] = [];

  if (input.lastEvaluatedAt == null) {
    if (input.hasPicks) {
      issues.push({
        kind: "settlement-stale",
        message: `Chưa từng ghi nhận lần chốt nào dù đã có pick — settlement có thể chưa chạy được lần nào.`,
      });
    }
  } else {
    const age = daysBetween(input.lastEvaluatedAt.slice(0, 10), input.today);
    if (age > STALE_SETTLEMENT_AFTER_DAYS) {
      issues.push({
        kind: "settlement-stale",
        message: `Lần chốt cuối ${input.lastEvaluatedAt.slice(0, 10)} — ${age} ngày trước, vượt ngưỡng ${STALE_SETTLEMENT_AFTER_DAYS} ngày.`,
      });
    }
  }

  if (input.errors > 0) {
    issues.push({
      kind: "run-errors",
      message: `Lần chạy chốt gần nhất có ${input.errors} lỗi (xem log server: [BT-03] / [BT-AUTO]).`,
    });
  }

  if (input.ready > 0 && input.readySince != null) {
    const stuckDays = daysBetween(input.readySince, input.today);
    if (stuckDays >= READY_STUCK_AFTER_DAYS) {
      issues.push({
        kind: "ready-not-settling",
        message: `${input.ready} pick sẵn sàng chốt từ ${input.readySince} (${stuckDays} ngày) vẫn PENDING${
          input.noData ? ` · ${input.noData} pick thiếu nến` : ""
        }.`,
      });
    }
  }

  return issues;
}

/** Một message gộp — đủ ngữ cảnh để người nhận tự kiểm tra. */
export function buildSettlementHealthMessage(
  issues: SettlementIssue[],
  today: string
): string {
  return [
    `⚠️ [NarrativeHealth] Backtest settlement cần kiểm tra — ${today}`,
    "",
    ...issues.map((issue) => `- ${issue.message}`),
    "",
    "Kiểm tra: Admin → Backtest (chip sẵn sàng chốt, lần chốt cuối, noData) rồi chạy dry-run.",
    "Trang công khai: /track-record sẽ hiện banner dữ liệu cũ khi quá ngưỡng.",
  ].join("\n");
}

interface HealthState {
  /** kind → ISO timestamp lần cảnh báo gần nhất. */
  alerted: Record<string, string>;
  /** Ngày đầu tiên thấy ready > 0. */
  readySince: string | null;
}

function cooldownHours(): number {
  const raw = process.env.BT_HEALTH_ALERT_COOLDOWN_HOURS;
  const hours = raw == null || raw.trim() === "" ? DEFAULT_HEALTH_ALERT_COOLDOWN_HOURS : Number(raw);
  return Number.isFinite(hours) ? Math.min(168, Math.max(1, hours)) : DEFAULT_HEALTH_ALERT_COOLDOWN_HOURS;
}

async function readState(): Promise<HealthState | null> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, STATE_KEY)).limit(1);
    const value = row?.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { alerted: {}, readySince: null };
    }
    const raw = value as { alerted?: unknown; readySince?: unknown };
    const alerted: Record<string, string> = {};
    if (raw.alerted && typeof raw.alerted === "object" && !Array.isArray(raw.alerted)) {
      for (const [kind, at] of Object.entries(raw.alerted as Record<string, unknown>)) {
        if (typeof at === "string" && Number.isFinite(Date.parse(at))) alerted[kind] = at;
      }
    }
    return {
      alerted,
      readySince: typeof raw.readySince === "string" ? raw.readySince : null,
    };
  } catch {
    // Không đọc được dedupe → không gửi, tránh spam mỗi lần refresh.
    return null;
  }
}

async function writeState(state: HealthState): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: STATE_KEY, value: state, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: state, updatedAt: new Date() } });
}

export interface BacktestHealthResult {
  issues: SettlementIssue[];
  /** Số kênh đã nhận cảnh báo (0 = không có issue / cooldown / chưa cấu hình kênh). */
  alerted: number;
}

/**
 * Đọc trạng thái settlement, cập nhật mốc `readySince`, gửi cảnh báo cho các
 * issue chưa báo trong cooldown. Best-effort: caller bọc try/catch, lỗi ở đây
 * không được phá refresh.
 */
export async function runBacktestHealthCheck(
  options: { errors?: number; now?: Date } = {}
): Promise<BacktestHealthResult> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") {
    return { issues: [], alerted: 0 };
  }

  const now = options.now ?? new Date();
  const today = getBusinessDate(now);
  const status = await getBacktestStatus();
  const ready = status.readyByHorizon[DEFAULT_HORIZON] ?? 0;
  const hasPicks = status.lastEvaluatedAt != null || status.pending > 0;

  const state = await readState();
  if (state === null) return { issues: [], alerted: 0 };

  // Mốc "treo": giữ nguyên ngày đầu tiên thấy ready > 0; reset khi hàng đợi trống.
  const readySince = ready > 0 ? (state.readySince ?? today) : null;

  const issues = settlementHealthIssues({
    today,
    hasPicks,
    lastEvaluatedAt: status.lastEvaluatedAt,
    errors: Math.max(0, options.errors ?? 0),
    ready,
    readySince,
    noData: status.noDataByHorizon[DEFAULT_HORIZON] ?? 0,
  });

  const cutoff = now.getTime() - cooldownHours() * 3_600_000;
  const due = issues.filter((issue) => {
    const at = Date.parse(state.alerted[issue.kind] ?? "");
    return !Number.isFinite(at) || at < cutoff;
  });

  let alerted = 0;
  let nextAlerted = state.alerted;

  if (due.length > 0) {
    const delivered = await dispatchCustomText(
      "Backtest settlement health",
      buildSettlementHealthMessage(due, today)
    );
    if (delivered > 0) {
      alerted = delivered;
      nextAlerted = { ...state.alerted };
      const keepAfter = now.getTime() - KEEP_DAYS * 86_400_000;
      const stamp = now.toISOString();
      for (const issue of due) nextAlerted[issue.kind] = stamp;
      for (const [kind, at] of Object.entries(nextAlerted)) {
        if (Date.parse(at) < keepAfter) delete nextAlerted[kind];
      }
    }
  }

  try {
    await writeState({ alerted: nextAlerted, readySince });
  } catch (error) {
    console.warn(
      "[BT-HEALTH] không lưu được state cảnh báo:",
      error instanceof Error ? error.message : String(error)
    );
  }

  return { issues, alerted };
}
