// SNAPSHOT-02-ANCHOR — neo `head` ra ngoài mỗi lần chốt.
//
// Vì sao cần: `head_hash` trong DB chỉ có nghĩa khi có một bản sao NẰM NGOÀI
// quyền ghi của hệ thống. Ai sửa được DB cũng tính lại được cả chuỗi neo, nên
// bằng chứng chống sửa lịch sử chỉ có thật khi con số `head` của mỗi ngày đã
// được gửi tới một kênh không sửa được từ DB (Telegram/Webhook/Resend của
// ALERT-02) — hoặc ít nhất nằm trong log của scheduler/refresh.
//
// Mỗi lần MỘT ngày được chốt (chỉ khi `created: true`), gửi đúng 3 thứ cần để
// đối chiếu về sau: `day`, `payloadHash`, `head`. Vì `head` = băm(head ngày
// trước · ngày · payloadHash), sửa bất kỳ ngày nào cũng làm head của mọi ngày
// sau nó lệch với bản đã gửi.
//
// Ngân sách: không có kênh nào được cấu hình → dispatch trả 0 và KHÔNG chặn
// việc chốt (giống BT-08). Không bao giờ ném lỗi ra ngoài: chốt số quan trọng
// hơn việc gửi tin.

import { appendFile } from "node:fs/promises";
import { dispatchCustomText } from "@/lib/services/alert-delivery.service";
import type { SnapshotEntry } from "./snapshot";

export const SNAPSHOT_ANCHOR_LABEL = "Track record snapshot anchor";
/** Prefix log cố định — dùng để grep/đối chiếu log scheduler. */
export const SNAPSHOT_ANCHOR_LOG_PREFIX = "[SNAPSHOT-ANCHOR]";

/** Pure — nội dung tin nhắn neo (test được, không I/O). */
export function buildSnapshotAnchorText(entry: SnapshotEntry): string {
  return [
    `🔒 [NarrativeHealth] Track record snapshot — ${entry.day}`,
    `day: ${entry.day}`,
    `payloadHash: ${entry.payloadHash}`,
    `head: ${entry.headHash}`,
    `metricsVersion: ${entry.metricsVersion}`,
    `createdAt: ${entry.createdAt}`,
    "",
    "Giữ tin nhắn này để đối chiếu: head = băm(head ngày trước · ngày · payloadHash). Sửa payload, ngày hay hash của bất kỳ ngày nào cũng làm head đọc lại khác con số đã neo ở đây.",
    "Không phải khuyến nghị đầu tư.",
  ].join("\n");
}

/** Cho phép test truyền dispatcher giả; production dùng ALERT-02. */
export type SnapshotAnchorDispatch = (label: string, text: string) => Promise<number>;

/** `SNAPSHOT_ANCHOR_ENABLED=0` để tắt gửi (mặc định BẬT). */
export function snapshotAnchorEnabled(): boolean {
  const raw = process.env.SNAPSHOT_ANCHOR_ENABLED;
  if (raw == null || raw.trim() === "") return true;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

export interface SnapshotAnchorOutcome {
  /** Số kênh đã nhận tin nhắn neo. 0 = head chỉ còn trong log. */
  delivered: number;
  /** Đã tới được ít nhất một kênh ngoài hệ thống. */
  anchored: boolean;
  /** `disabled` khi tắt bằng env, `error` khi dispatch ném lỗi. */
  skipped: "disabled" | "error" | null;
  /**
   * Neo thứ hai: file append-only ngoài DB (`SNAPSHOT_ANCHOR_FILE`). Một kênh
   * tin nhắn có thể bị xoá/sửa; một file trên đĩa khác hoặc được log-shipper
   * mang đi là bản sao độc lập rẻ nhất. `not-configured` = chưa đặt env.
   */
  fileAnchor?: "appended" | "error" | "not-configured";
}

/**
 * Neo thứ hai: mỗi lần chốt ghi THÊM một dòng JSON vào file ngoài DB.
 *
 * Định dạng dòng khớp với thứ `scripts/verify-snapshot.mjs --anchor-file` đọc
 * được (day/payloadHash/head), nên file này dùng để đối chiếu được ngay. Ghi
 * append nên không bao giờ ghi đè bản cũ; lỗi ghi không được làm hỏng việc chốt
 * (DB đã có dòng, log đã có head).
 */
export function snapshotAnchorFile(): string | null {
  const raw = process.env.SNAPSHOT_ANCHOR_FILE?.trim();
  return raw ? raw : null;
}

export async function appendSnapshotAnchorLine(
  entry: SnapshotEntry,
  file: string | null = snapshotAnchorFile(),
  append: typeof appendFile = appendFile
): Promise<"appended" | "error" | "not-configured"> {
  if (!file) return "not-configured";
  // Cùng định dạng với dòng log neo, nên `verify-snapshot.mjs --anchor-file`
  // đọc thẳng file này mà không cần parser riêng.
  const line =
    `${SNAPSHOT_ANCHOR_LOG_PREFIX} day=${entry.day} payloadHash=${entry.payloadHash} head=${entry.headHash}` +
    ` metricsVersion=${entry.metricsVersion} createdAt=${entry.createdAt}\n`;
  try {
    await append(file, line, "utf8");
    return "appended";
  } catch (error) {
    console.warn(
      `${SNAPSHOT_ANCHOR_LOG_PREFIX} không ghi được neo file (${file}) — head vẫn còn trong log/DB:`,
      error instanceof Error ? error.message : String(error)
    );
    return "error";
  }
}

/**
 * Gửi neo của một bản chụp vừa chốt. Không bao giờ ném lỗi.
 *
 * Log được ghi TRƯỚC khi gửi: log của refresh/scheduler cũng là một bản neo và
 * vẫn còn khi mọi kênh tin nhắn đều chết. Kết quả gửi được log riêng để người
 * vận hành biết bằng chứng đã ra ngoài hay mới chỉ nằm trong log.
 */
export async function emitSnapshotAnchor(
  entry: SnapshotEntry,
  dispatch: SnapshotAnchorDispatch = dispatchCustomText
): Promise<SnapshotAnchorOutcome> {
  console.info(
    `${SNAPSHOT_ANCHOR_LOG_PREFIX} day=${entry.day} payloadHash=${entry.payloadHash} head=${entry.headHash}`
  );
  // Neo file chạy TRƯỚC khi gửi tin: rẻ, không phụ thuộc mạng, và vẫn có tác
  // dụng khi mọi kênh tin nhắn chết.
  const fileAnchor = await appendSnapshotAnchorLine(entry);

  if (!snapshotAnchorEnabled()) {
    console.warn(
      `${SNAPSHOT_ANCHOR_LOG_PREFIX} SNAPSHOT_ANCHOR_ENABLED=0 — head chỉ còn trong log, không gửi ra kênh nào.`
    );
    return { delivered: 0, anchored: false, skipped: "disabled", fileAnchor };
  }

  try {
    const delivered = await dispatch(
      `${SNAPSHOT_ANCHOR_LABEL} ${entry.day}`,
      buildSnapshotAnchorText(entry)
    );
    if (delivered <= 0) {
      console.warn(
        `${SNAPSHOT_ANCHOR_LOG_PREFIX} không kênh nào nhận (Telegram/Webhook/Resend chưa cấu hình?) — head ngày ${entry.day} chỉ còn trong log.`
      );
      return { delivered: 0, anchored: false, skipped: null, fileAnchor };
    }
    console.info(
      `${SNAPSHOT_ANCHOR_LOG_PREFIX} delivered=${delivered} day=${entry.day} head=${entry.headHash}`
    );
    return { delivered, anchored: true, skipped: null, fileAnchor };
  } catch (error) {
    console.warn(
      `${SNAPSHOT_ANCHOR_LOG_PREFIX} gửi neo lỗi (head vẫn còn trong log):`,
      error instanceof Error ? error.message : String(error)
    );
    return { delivered: 0, anchored: false, skipped: "error", fileAnchor };
  }
}
