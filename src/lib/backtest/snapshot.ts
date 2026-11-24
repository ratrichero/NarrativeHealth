// SNAPSHOT-02 — chốt số công khai của một ngày: `payload_hash` + neo `head_hash`.
//
// Bản trước lưu cả chuỗi (sequence, prev_hash, hash từng dòng) và kiểm chuỗi
// trong app. Nhưng ai có quyền ghi DB cũng tính lại được cả chuỗi, nên chuỗi
// nội bộ chỉ bắt được sửa cục bộ — trong khi cái cần là "số hôm qua đã từng
// đúng": một hash của payload (kiểm lại được từ chính payload) và một head
// hash để **neo ra ngoài** (commit, tin nhắn, log của scheduler). Vì vậy ở đây
// chỉ còn hai thứ:
//   • `payloadHash` = băm payload canonical → kiểm được bất cứ lúc nào.
//   • `headHash`    = băm (head trước, ngày, payloadHash) → in ra ngoài mỗi lần
//     chốt; sửa lịch sử làm head lệch với bản đã neo, không cần chuỗi trong DB.
//
// Thuần (chỉ crypto) → test được không cần DB. Phần đọc/ghi ở `snapshot-store.ts`.

import { createHash } from "node:crypto";
import { getBusinessDate } from "@/lib/utils";

/** Tăng khi cách băm/định dạng payload đổi — khác version thì không so hash. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** `prevHead` của bản chụp đầu tiên: 64 số 0, không phải null. */
export const SNAPSHOT_GENESIS_HASH = "0".repeat(64);

/**
 * JSON canonical: object key sắp xếp đệ quy, `undefined` bị bỏ, mảng giữ thứ
 * tự. Hash chỉ có nghĩa khi cùng dữ liệu luôn cho cùng chuỗi byte — thứ tự key
 * của `JSON.stringify` phụ thuộc cách object được dựng, nên không dùng trực tiếp.
 */
export function canonicalJson(value: unknown): string {
  const encode = (node: unknown): string => {
    if (node === null) return "null";
    if (node === undefined) return "null";
    const type = typeof node;
    if (type === "number") return Number.isFinite(node as number) ? String(node) : "null";
    if (type === "boolean") return node ? "true" : "false";
    if (type === "string") return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(encode).join(",")}]`;
    if (type === "object") {
      const record = node as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(",")}}`;
    }
    // bigint/function/symbol không có trong payload JSON; đưa về null thay vì
    // làm hash phụ thuộc môi trường.
    return "null";
  };
  return encode(value);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash của payload đã chụp (không gồm metadata của chính bản chụp). */
export function snapshotPayloadHash(payload: unknown): string {
  return sha256Hex(`v${SNAPSHOT_SCHEMA_VERSION}|${canonicalJson(payload)}`);
}

export interface SnapshotHashInput {
  /** Ngày dữ liệu (YYYY-MM-DD) — khoá tự nhiên của bản chụp. */
  day: string;
  payloadHash: string;
  metricsVersion: string;
  /** Head của bản chụp trước (hoặc genesis) — đầu vào của neo. */
  prevHead: string;
}

export interface SnapshotEntry {
  day: string;
  payloadHash: string;
  headHash: string;
  metricsVersion: string;
  createdAt: string;
}

/**
 * Neo của một bản chụp = băm (head trước, ngày, payload hash). Đây là con số
 * nên in ra ngoài sau mỗi lần chốt: sửa payload/ngày/hash của một dòng sẽ làm
 * head tính lại khác bản đã neo.
 */
export function computeHeadHash(input: {
  day: string;
  payloadHash: string;
  prevHead: string;
}): string {
  return sha256Hex(`head-v1|${input.day}|${input.payloadHash}|${input.prevHead}`);
}

export function buildSnapshotEntry(
  input: SnapshotHashInput,
  options: { createdAt?: string } = {}
): SnapshotEntry {
  return {
    day: input.day,
    payloadHash: input.payloadHash,
    metricsVersion: input.metricsVersion,
    headHash: computeHeadHash(input),
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

/** Payload đọc từ DB còn khớp `payload_hash` đã công bố hay không. */
export function snapshotPayloadMatches(entry: SnapshotEntry, payload: unknown): boolean {
  return snapshotPayloadHash(payload) === entry.payloadHash;
}

/**
 * Dịch một ngày nghiệp vụ (YYYY-MM-DD) đi `deltaDays` ngày, tính theo UTC để
 * không phụ thuộc timezone của máy chạy (ngày đã là ngày ICT do caller quyết).
 */
export function shiftBusinessDay(day: string, deltaDays: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date) + deltaDays * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/**
 * Các ngày ĐÃ ĐÓNG gần nhất trước `today`, cũ → mới: `today-1` … `today-count`.
 * `today` không bao giờ nằm trong danh sách — ngày đang mở không được chốt.
 * Kẹp 1..366 để không trả mảng rỗng hoặc vòng lặp vô hạn.
 */
export function closedDaysBefore(today: string, count: number): string[] {
  const days: string[] = [];
  const total = Number.isFinite(count) ? Math.min(Math.max(1, Math.floor(count)), 366) : 1;
  for (let offset = total; offset >= 1; offset -= 1) {
    days.push(shiftBusinessDay(today, -offset));
  }
  return days;
}

/**
 * Dấu trên payload của một bản chụp CHỐT BÙ: ngày đó không có bản chụp lúc nó
 * đóng (refresh không chạy), nên payload được đọc ở `capturedAt` — có thể đã
 * bao gồm cả số của những ngày sau ngày được chốt bù. Ghi rõ thay vì giả vờ đó là bản
 * chụp đúng ngày; `payload_hash` bao gồm luôn dấu này nên không thể lặng lẽ bỏ.
 */
export interface SnapshotBackfillMarker {
  /** Thời điểm thực sự đọc payload (ISO). */
  capturedAt: string;
  /** `meta.dataAsOf` của payload lúc chụp; null nếu payload không có. */
  dataAsOf: string | null;
}

/**
 * Payload để chốt bù: giữ nguyên payload gốc, thêm `snapshotBackfill`.
 *
 * Dấu chỉ còn hai thông tin KHÔNG suy ra được: đọc lúc nào và payload thực sự
 * bao phủ tới ngày nào. Sự có mặt của key đã nói "đây là bản chốt bù", còn
 * ngày được chốt bù chính là `day` của dòng.
 */
export function buildBackfillPayload(
  payload: object,
  input: { capturedAt: string }
): Record<string, unknown> & { snapshotBackfill: SnapshotBackfillMarker } {
  const record = payload as Record<string, unknown>;
  const meta = record.meta;
  const dataAsOf =
    meta !== null && typeof meta === "object" && !Array.isArray(meta) &&
    typeof (meta as Record<string, unknown>).dataAsOf === "string"
      ? ((meta as Record<string, unknown>).dataAsOf as string)
      : null;
  return { ...record, snapshotBackfill: { capturedAt: input.capturedAt, dataAsOf } };
}

/**
 * Lý do từ chối chốt một ngày. Mỗi lý do là một trạng thái vận hành khác nhau,
 * không phải "lỗi chung":
 *   • `invalid-day`       — payload không có ngày hợp lệ để chốt.
 *   • `day-open`          — ngày đó chưa đóng (>= hôm nay theo giờ nghiệp vụ);
 *     chốt bây giờ là đóng băng một con số còn đang thay đổi.
 *   • `settlement-pending`— settlement chưa chạy trong/ sau ngày đó, nên số của
 *     ngày đó có thể còn pick chưa chốt.
 */
export type SnapshotRefusalReason = "invalid-day" | "day-open" | "settlement-pending";

export interface SnapshotDayDecision {
  ok: boolean;
  reason: SnapshotRefusalReason | null;
  /** Ngày định chốt (YYYY-MM-DD, hoặc chuỗi thô khi không hợp lệ). */
  day: string | null;
  /** Hôm nay theo giờ nghiệp vụ — mốc so sánh "đã đóng". */
  today: string;
  /** Ngày nghiệp vụ của lần settlement gần nhất; null = chưa chốt lần nào. */
  settlementDay: string | null;
}

/** Ngày nghiệp vụ của một timestamp ISO; null khi không đọc được. */
export function businessDayOf(timestamp: string | null | undefined): string | null {
  if (typeof timestamp !== "string" || timestamp.trim() === "") return null;
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  return getBusinessDate(new Date(ms));
}

/**
 * Quyết định một ngày đã đủ điều kiện chốt chưa: ngày phải đã đóng theo giờ
 * nghiệp vụ ICT và settlement phải đã chạy trong hoặc sau ngày đó.
 *
 * Ngoại lệ rỗng: track record chưa có pick nào (`hasPicks: false`) thì
 * settlement không có gì để chốt, nên `lastEvaluatedAt === null` là trạng thái
 * bình thường của deployment mới — không được coi là "settlement tụt lại" và
 * khoá chốt vĩnh viễn (deployment mới sẽ không bao giờ có bản chụp đầu tiên).
 *
 * Thuần (không DB) để route và test dùng chung đúng một luật.
 */
export function evaluateSnapshotDay(input: {
  day: string | null;
  today: string;
  lastEvaluatedAt: string | null;
  /** Mặc định true: caller cũ giữ nguyên hành vi chặn khi thiếu settlement. */
  hasPicks?: boolean;
}): SnapshotDayDecision {
  const today = input.today;
  const day = typeof input.day === "string" ? input.day.trim() : null;
  const settlementDay = businessDayOf(input.lastEvaluatedAt);
  const base = { day, today, settlementDay };

  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { ...base, ok: false, reason: "invalid-day" };
  }
  // So chuỗi ISO là so ngày: cùng định dạng YYYY-MM-DD nên thứ tự từ điển =
  // thứ tự thời gian. `>= today` gồm cả ngày tương lai.
  if (day >= today) {
    return { ...base, ok: false, reason: "day-open" };
  }
  // Rỗng: chưa có pick nào thì không có "số dở dang" để bảo vệ.
  if (input.hasPicks === false) {
    return { ...base, ok: true, reason: null };
  }
  if (settlementDay === null || settlementDay < day) {
    return { ...base, ok: false, reason: "settlement-pending" };
  }
  return { ...base, ok: true, reason: null };
}
