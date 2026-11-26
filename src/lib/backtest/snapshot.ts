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

/**
 * Tăng khi cách băm/định dạng payload đổi — khác version thì không so hash.
 * v2: mọi payload mang thêm `snapshot: { capturedAt }` (xem `buildSnapshotPayload`).
 */
export const SNAPSHOT_SCHEMA_VERSION = 2;

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

/**
 * Phiên bản băm mà một payload tự khai.
 *
 * v2 gói `snapshot.capturedAt` vào payload; v1 (dòng chốt trước SNAPSHOT-02)
 * không có field đó và được băm bằng tiền tố `v1|`. Phải đọc từ chính payload
 * chứ không lấy `SNAPSHOT_SCHEMA_VERSION`: nếu lấy hằng số hiện tại thì mọi dòng
 * cũ đều "lệch hash" và health/verify báo nhầm là dữ liệu bị sửa — đúng lúc
 * cần phân biệt dòng cũ với dòng bị sửa tay.
 */
export function payloadSchemaVersion(payload: unknown): number {
  if (payload && typeof payload === "object") {
    const seal = (payload as { snapshot?: unknown }).snapshot;
    if (seal && typeof seal === "object" && typeof (seal as SnapshotSeal).capturedAt === "string") {
      return 2;
    }
  }
  return 1;
}

/** Hash theo đúng phiên bản của payload (xem `payloadSchemaVersion`). */
export function snapshotPayloadHashAtVersion(payload: unknown, version: number): string {
  return sha256Hex(`v${version}|${canonicalJson(payload)}`);
}

/** Hash của payload đã chụp theo luật băm HIỆN TẠI (dùng khi chốt mới). */
export function snapshotPayloadHash(payload: unknown): string {
  return snapshotPayloadHashAtVersion(payload, SNAPSHOT_SCHEMA_VERSION);
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
  /** Luật băm đã dùng cho dòng này (1 = trước SNAPSHOT-02, 2 = có capturedAt). */
  schemaVersion: number;
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
  input: SnapshotHashInput & { schemaVersion?: number },
  options: { createdAt?: string } = {}
): SnapshotEntry {
  return {
    day: input.day,
    payloadHash: input.payloadHash,
    metricsVersion: input.metricsVersion,
    headHash: computeHeadHash(input),
    createdAt: options.createdAt ?? new Date().toISOString(),
    schemaVersion: input.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION,
  };
}

/**
 * Payload đọc từ DB còn khớp `payload_hash` đã công bố hay không.
 *
 * Băm theo phiên bản payload TỰ KHAI, không theo hằng số hiện tại: dòng v1 vẫn
 * verify đúng bằng luật v1, còn payload bị sửa thì vẫn lệch (hash đã lưu sinh
 * từ nội dung gốc).
 */
export function snapshotPayloadMatches(entry: SnapshotEntry, payload: unknown): boolean {
  return snapshotPayloadHashAtVersion(payload, payloadSchemaVersion(payload)) === entry.payloadHash;
}

/**
 * Dấu đóng gói trong payload của MỌI bản chụp (không chỉ bản chốt bù, khái niệm
 * đó đã bị bỏ): thời điểm đọc số liệu. Trước đây mốc này chỉ có ở cột
 * `created_at` — sửa được mà không ai thấy, vì nó không nằm trong `payload_hash`.
 * Đặt trong payload nghĩa là đổi `capturedAt` sẽ đổi hash và lệch với head đã neo.
 */
export interface SnapshotSeal {
  /** ISO-8601, thời điểm đọc payload. */
  capturedAt: string;
}

/**
 * Payload để chốt: giữ nguyên số liệu, thêm `snapshot: { capturedAt }`.
 * Gọi ở đúng một chỗ (`publishDailySnapshot`) để không có đường ghi nào bỏ sót.
 */
export function buildSnapshotPayload(
  payload: object,
  input: { capturedAt: string }
): Record<string, unknown> & { snapshot: SnapshotSeal } {
  const record = payload as Record<string, unknown>;
  return { ...record, snapshot: { capturedAt: input.capturedAt } };
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

/** Số ngày giữa hai ngày nghiệp vụ (YYYY-MM-DD); null khi một bên không đọc được. */
export function daysBetweenDays(from: string, to: string): number | null {
  const a = /^\d{4}-\d{2}-\d{2}$/.test(from) ? Date.parse(`${from}T00:00:00Z`) : Number.NaN;
  const b = /^\d{4}-\d{2}-\d{2}$/.test(to) ? Date.parse(`${to}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * WATCHDOG-SNAPSHOT — bản chụp mới nhất đã cũ bao nhiêu ngày so với ngày vừa đóng.
 *
 * Vì sao cần ngoài check `snapshot` của health: check đó nói chuyện của RIÊNG
 * hôm qua (và gap chỉ được tính trong lượt refresh). Nếu cả refresh chết thì
 * không lượt nào chạy gap, và mọi thứ vẫn "ok" cho tới khi ai đó mở web. Phép
 * đo ở đây chỉ đọc một dòng mới nhất và không phụ thuộc refresh đã chạy.
 *
 * `maxAgeDays` = 1: ngày vừa đóng phải có bản chụp (job 07:10 ICT chốt hôm
 * qua), trễ hơn 1 ngày là đáng báo. `stale` là `ageDays > maxAgeDays`.
 */
export interface SnapshotFreshness {
  /** Ngày của bản chụp mới nhất; null = bảng chưa từng chốt. */
  tipDay: string | null;
  /** Ngày đã đóng gần nhất (hôm qua theo giờ nghiệp vụ). */
  expectedDay: string;
  /** `expectedDay − tipDay` theo ngày; null khi chưa có bản chụp nào. */
  ageDays: number | null;
  maxAgeDays: number;
  stale: boolean;
}

export const SNAPSHOT_MAX_AGE_DAYS = 1;

export function evaluateSnapshotFreshness(input: {
  tipDay: string | null;
  today: string;
  maxAgeDays?: number;
}): SnapshotFreshness {
  const maxAgeDays =
    Number.isFinite(input.maxAgeDays) && (input.maxAgeDays as number) >= 0
      ? Math.floor(input.maxAgeDays as number)
      : SNAPSHOT_MAX_AGE_DAYS;
  const expectedDay = shiftBusinessDay(input.today, -1);
  if (input.tipDay === null) {
    // Deployment mới chưa chốt ngày nào: không phải "tụt lại" mà là chưa bắt đầu.
    return { tipDay: null, expectedDay, ageDays: null, maxAgeDays, stale: false };
  }
  const ageDays = daysBetweenDays(input.tipDay, expectedDay);
  return {
    tipDay: input.tipDay,
    expectedDay,
    ageDays,
    maxAgeDays,
    stale: ageDays !== null && ageDays > maxAgeDays,
  };
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
