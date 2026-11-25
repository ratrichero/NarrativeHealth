// SNAPSHOT-02-GAP — báo những ngày ĐÃ ĐÓNG mà không có bản chụp.
//
// Sau khi bỏ chốt bù, ngày thiếu là thiếu vĩnh viễn (bảng append-only) và số
// hiện tại không phải số của ngày đó — nên việc duy nhất còn làm được là NÓI RA.
// Log của lượt refresh không đủ: refresh chạy trong im lặng và log bị rotate,
// nên cảnh báo đi qua kênh ALERT-02 sẵn có (Telegram/Webhook/Resend).
//
// Chống dội: refresh có thể chạy nhiều lượt/ngày (cron + bấm tay). Mỗi cặp
// (tập ngày thiếu, ngày nghiệp vụ) chỉ gửi một lần; tập ngày đổi (thiếu thêm
// ngày, hoặc sang ngày mới) thì gửi lại. Trạng thái nằm trong app_settings.
//
// Không bao giờ ném lỗi: cảnh báo hỏng không được làm hỏng refresh.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { dispatchCustomText } from "@/lib/services/alert-delivery.service";
import type { SnapshotGapReport } from "./snapshot-store";

export const SNAPSHOT_GAP_ALERT_KEY = "snapshot.gap.alerted";
export const SNAPSHOT_GAP_ALERT_LABEL = "Track record snapshot gap";
/** Số ngày tối đa liệt kê trong một tin nhắn (phần còn lại ghi "… và N ngày"). */
export const SNAPSHOT_GAP_ALERT_MAX_LISTED = 10;

/** Pure — nội dung tin cảnh báo (test được, không I/O). */
export function buildSnapshotGapAlertText(report: SnapshotGapReport): string {
  const shown = report.missing.slice(0, SNAPSHOT_GAP_ALERT_MAX_LISTED);
  const rest = report.missing.length - shown.length;
  return [
    `⚠️ [NarrativeHealth] Track record thiếu bản chụp — ${report.missing.length} ngày`,
    `Đuôi chuỗi neo: ${report.tip ?? "chưa có"} · cửa sổ kiểm: ${report.windowDays} ngày gần nhất`,
    `Ngày đã đóng mà không có bản chụp (${shown.length}/${report.missing.length}):`,
    ...shown.map((day) => `• ${day}`),
    rest > 0 ? `… và ${rest} ngày nữa` : null,
    "",
    "Không có chốt bù: số hiện tại không phải số của ngày đó, nên ghi lại sẽ là tuyên bố sai. Thiếu là thiếu — chỉ tránh được bằng cách để refresh chạy đúng ngày.",
    "Không phải khuyến nghị đầu tư.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export interface SnapshotGapAlertState {
  /** Danh sách ngày thiếu tại lần gửi cuối (đã join bằng dấu phẩy). */
  signature: string;
  /** Ngày nghiệp vụ của lần gửi cuối. */
  day: string;
}

async function readState(): Promise<SnapshotGapAlertState | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SNAPSHOT_GAP_ALERT_KEY))
    .limit(1);
  const value = row?.value as Partial<SnapshotGapAlertState> | undefined;
  if (!value || typeof value.signature !== "string" || typeof value.day !== "string") {
    return null;
  }
  return { signature: value.signature, day: value.day };
}

async function writeState(state: SnapshotGapAlertState): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: SNAPSHOT_GAP_ALERT_KEY, value: state, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: state, updatedAt: new Date() },
    });
}

export type SnapshotGapAlertOutcome = {
  sent: boolean;
  reason: "no-gap" | "already-sent" | "no-channel" | "error" | "ok";
  channels?: number;
};

export interface SnapshotGapAlertOptions {
  /** Ngày nghiệp vụ ICT — một phần của khoá chống dội. */
  today: string;
  dispatch?: (label: string, text: string) => Promise<number>;
  readState?: () => Promise<SnapshotGapAlertState | null>;
  writeState?: (state: SnapshotGapAlertState) => Promise<void>;
}

/**
 * Gửi cảnh báo gap nếu có ngày thiếu và chưa gửi cho đúng tập ngày này trong
 * ngày nghiệp vụ hiện tại. Không bao giờ ném lỗi.
 */
export async function alertSnapshotGaps(
  report: SnapshotGapReport,
  options: SnapshotGapAlertOptions
): Promise<SnapshotGapAlertOutcome> {
  if (report.missing.length === 0) return { sent: false, reason: "no-gap" };

  const signature = report.missing.join(",");
  try {
    const last = await (options.readState ?? readState)();
    if (last && last.signature === signature && last.day === options.today) {
      return { sent: false, reason: "already-sent" };
    }

    const channels = await (options.dispatch ?? dispatchCustomText)(
      `${SNAPSHOT_GAP_ALERT_LABEL} ${options.today}`,
      buildSnapshotGapAlertText(report)
    );
    if (channels <= 0) return { sent: false, reason: "no-channel" };

    await (options.writeState ?? writeState)({ signature, day: options.today });
    return { sent: true, reason: "ok", channels };
  } catch (error) {
    console.warn(
      "[SNAPSHOT-GAP] không gửi được cảnh báo (gap vẫn còn trong log):",
      error instanceof Error ? error.message : String(error)
    );
    return { sent: false, reason: "error" };
  }
}
