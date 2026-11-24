// SNAPSHOT-02 — đọc/ghi bản chụp track record theo ngày (server-only).
//
// Quy tắc: append-only, một dòng/ngày, dòng đầu tiên của ngày thắng. Chạy lại
// job không viết đè lịch sử. Mỗi dòng chỉ giữ `payload_hash` (kiểm lại được từ
// payload) và `head_hash` (neo ra ngoài); không còn sequence/prev_hash nên
// không có vòng retry cũng không có "kiểm chuỗi" trong app — xem `snapshot.ts`.

import { desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { trackRecordSnapshots } from "@/db/schema";
import {
  SNAPSHOT_GENESIS_HASH,
  buildBackfillPayload,
  closedDaysBefore,
  shiftBusinessDay,
  computeHeadHash,
  evaluateSnapshotDay,
  snapshotPayloadHash,
  type SnapshotDayDecision,
  type SnapshotEntry,
  type SnapshotRefusalReason,
} from "./snapshot";

/** Số dòng tối đa trả về cho API công khai (đủ ~1 tháng, payload vừa phải). */
export const SNAPSHOT_READ_LIMIT = 90;

type SnapshotRow = typeof trackRecordSnapshots.$inferSelect;

function toEntry(row: SnapshotRow): SnapshotEntry {
  return {
    day: row.day,
    payloadHash: row.payloadHash,
    headHash: row.headHash,
    metricsVersion: row.metricsVersion,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(1, Math.floor(limit)), 365);
}

/** Các bản chụp, cũ → mới (thứ tự để đọc head). */
export async function readSnapshotEntries(limit = SNAPSHOT_READ_LIMIT): Promise<SnapshotEntry[]> {
  const rows = await db
    .select()
    .from(trackRecordSnapshots)
    .orderBy(desc(trackRecordSnapshots.day))
    .limit(clampLimit(limit));
  return rows.map(toEntry).reverse();
}

export interface PublishSnapshotResult {
  /** false = ngày này đã có bản chụp, dòng cũ được giữ nguyên. */
  created: boolean;
  entry: SnapshotEntry;
  /** Head hiện tại của chuỗi neo — in ra ngoài sau mỗi lần chốt. */
  head: string;
}

/**
 * Chốt payload của `day`. Idempotent: ngày đã có bản chụp thì trả dòng cũ với
 * `created: false` — không âm thầm ghi đè thứ đã công bố.
 */
export async function publishDailySnapshot(
  payload: unknown,
  day: string,
  metricsVersion: string
): Promise<PublishSnapshotResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`SNAPSHOT-02: ngày không hợp lệ (${day})`);
  }

  const payloadHash = snapshotPayloadHash(payload);
  const [tip] = await db
    .select({ headHash: trackRecordSnapshots.headHash })
    .from(trackRecordSnapshots)
    .orderBy(desc(trackRecordSnapshots.day))
    .limit(1);
  const headHash = computeHeadHash({
    day,
    payloadHash,
    prevHead: tip?.headHash ?? SNAPSHOT_GENESIS_HASH,
  });

  const inserted = await db
    .insert(trackRecordSnapshots)
    .values({ day, payloadHash, headHash, metricsVersion, payload: payload as object })
    .onConflictDoNothing({ target: trackRecordSnapshots.day })
    .returning();

  if (inserted.length > 0) {
    return { created: true, entry: toEntry(inserted[0]), head: headHash };
  }

  // Ngày đã có (có thể do instance khác vừa ghi) → trả dòng hiện có, kèm head
  // thật của chuỗi để người gọi không neo nhầm con số vừa tính.
  const [existing] = await db
    .select()
    .from(trackRecordSnapshots)
    .where(eq(trackRecordSnapshots.day, day))
    .limit(1);
  if (!existing) {
    throw new Error("SNAPSHOT-02: không đọc lại được bản chụp vừa bị bỏ qua");
  }
  const [currentTip] = await db
    .select({ headHash: trackRecordSnapshots.headHash })
    .from(trackRecordSnapshots)
    .orderBy(desc(trackRecordSnapshots.day))
    .limit(1);
  return {
    created: false,
    entry: toEntry(existing),
    head: currentTip?.headHash ?? existing.headHash,
  };
}

/**
 * Chốt MỘT ngày đã đóng, kèm cổng kiểm tra dùng chung với route POST.
 *
 * Đây là chỗ DUY NHẤT gộp cổng (ngày đã đóng + settlement) với việc chốt:
 * route POST, job tự động trong `/api/refresh` và chốt bù đều đi qua đây, nên
 * không có bản sao luật nào để lệch nhau. Trả cả `decision` để caller hiển thị
 * được `day/today/settlementDay` khi từ chối mà không phải tự gọi
 * `evaluateSnapshotDay`.
 */
export async function publishClosedDaySnapshot(options: {
  payload: unknown;
  lastEvaluatedAt: string | null;
  metricsVersion: string;
  day: string;
  today: string;
  /** false = track record rỗng; bỏ cổng settlement vì không có gì để chốt. */
  hasPicks?: boolean;
}): Promise<{ decision: SnapshotDayDecision; result: PublishSnapshotResult | null }> {
  const decision = evaluateSnapshotDay({
    day: options.day,
    today: options.today,
    lastEvaluatedAt: options.lastEvaluatedAt,
    hasPicks: options.hasPicks,
  });
  if (!decision.ok) {
    return { decision, result: null };
  }
  return {
    decision,
    result: await publishDailySnapshot(options.payload, options.day, options.metricsVersion),
  };
}

/** Số ngày đã đóng gần nhất được thử chốt bù trong mỗi lượt refresh. */
export const SNAPSHOT_BACKFILL_DAYS = 3;
/** Số ngày ngoài cửa sổ tối đa liệt kê trong báo cáo/health (đếm vẫn đủ). */
export const SNAPSHOT_GAP_REPORT_MAX_DAYS = 31;

export interface SnapshotGapReport {
  /** Ngày đã đóng còn thiếu TRONG cửa sổ chốt bù (lượt refresh tới sẽ thử chốt). */
  inWindow: string[];
  /**
   * Ngày đã đóng còn thiếu NGOÀI cửa sổ chốt bù nhưng vẫn nằm sau đuôi chuỗi neo
   * — tức là chốt bù được nếu cửa sổ rộng hơn, nhưng lượt refresh hiện tại sẽ
   * bỏ qua. Đây là chỗ "mất âm thầm" mà health/log phải nói ra. Liệt kê tối đa
   * `SNAPSHOT_GAP_REPORT_MAX_DAYS` ngày gần nhất; `outsideWindowCount` là tổng.
   */
  outsideWindow: string[];
  outsideWindowCount: number;
  /** Ngày mới nhất đã chốt (đuôi chuỗi neo); null = bảng rỗng. */
  tip: string | null;
}

/**
 * Liệt kê các ngày ĐÃ ĐÓNG còn thiếu bản chụp, tách theo khả năng chốt bù.
 *
 * Bảng rỗng thì không báo gì ngoài cửa sổ: chưa từng có bản chụp nào thì không
 * có mốc nào để nói "đáng lẽ phải có". Chỉ khi đã có đuôi chuỗi neo mới biết
 * những ngày sau nó là thiếu thật.
 */
export async function listSnapshotGaps(options: {
  today: string;
  /** Truyền sẵn entries để caller khỏi đọc DB hai lần. */
  entries?: SnapshotEntry[];
}): Promise<SnapshotGapReport> {
  const days = closedDaysBefore(options.today, SNAPSHOT_BACKFILL_DAYS);
  const entries = options.entries ?? (await readSnapshotEntries());
  const sealed = new Set(entries.map((entry) => entry.day));
  const tip = entries.length > 0 ? entries[entries.length - 1].day : null;

  const inWindow = days.filter((day) => !sealed.has(day));

  // Thiếu giữa đuôi neo và cửa sổ: lùi từ ngày cũ nhất của cửa sổ về tip+1.
  // Đếm đủ để báo, chỉ giữ tối đa SNAPSHOT_GAP_REPORT_MAX_DAYS ngày gần nhất.
  const outsideWindow: string[] = [];
  let outsideWindowCount = 0;
  let cursor = shiftBusinessDay(days[0], -1);
  while (tip !== null && cursor > tip) {
    outsideWindowCount += 1;
    if (outsideWindow.length < SNAPSHOT_GAP_REPORT_MAX_DAYS) outsideWindow.push(cursor);
    cursor = shiftBusinessDay(cursor, -1);
  }
  outsideWindow.reverse();

  return { inWindow, outsideWindow, outsideWindowCount, tip };
}

export interface SnapshotBackfillRow {
  day: string;
  /**
   * `sealed` = vừa chốt (lần đầu), `exists` = đã có bản chụp nên giữ nguyên,
   * `skipped` = chưa chốt được (xem `skipped`).
   */
  status: "sealed" | "exists" | "skipped";
  /**
   * Lý do cổng từ chối, hoặc `chain-gap`: ngày thiếu nằm TRƯỚC bản chụp mới
   * nhất nên chốt bù sẽ phải neo vào head của ngày sau nó → phá neo, không ghi.
   */
  skipped: SnapshotRefusalReason | "chain-gap" | null;
  result: PublishSnapshotResult | null;
}

/**
 * Chốt bù các ngày ĐÃ ĐÓNG nhưng chưa có bản chụp (SNAPSHOT-02).
 *
 * Vì sao cần: refresh không chạy một ngày thì ngày đó không bao giờ được chốt
 * nữa — lượt sau chỉ chốt "hôm qua", và bảng append-only không điền lại được.
 *
 * Ba ràng buộc giữ cho việc chốt bù không thành bịa số:
 *   1. Chỉ ngày đã đóng và đã qua settlement (`evaluateSnapshotDay`) — cùng
 *      cổng với lượt chốt thường.
 *   2. Không ghi đè: ngày đã có bản chụp trả `exists`.
 *   3. Chỉ chốt bù ở ĐUÔI chuỗi neo: ngày thiếu phải mới hơn bản chụp mới nhất.
 *      Ngày thiếu chen giữa hai bản đã chốt không thể thêm mà không làm lệch
 *      `head_hash` của ngày đứng sau (head tính từ bản liền trước), nên trả
 *      `chain-gap` và để health báo.
 *
 * Payload chốt bù mang dấu `snapshotBackfill` (xem `buildBackfillPayload`):
 * số đọc ở thời điểm chốt bù, không phải số đã công bố đúng ngày đó. Dấu này
 * nằm trong `payload_hash` nên không thể bỏ im lặng.
 */
export async function publishMissingSnapshots(options: {
  payload: object;
  /** Hôm nay theo giờ nghiệp vụ ICT. */
  today: string;
  lastEvaluatedAt: string | null;
  metricsVersion: string;
  hasPicks?: boolean;
  /** Chỉ để test khoá được giá trị; production dùng thời điểm thực. */
  capturedAt?: string;
}): Promise<{ rows: SnapshotBackfillRow[]; gaps: SnapshotGapReport }> {
  const days = closedDaysBefore(options.today, SNAPSHOT_BACKFILL_DAYS);
  const entries = await readSnapshotEntries();
  // Báo cáo tính trên cùng tập entries — một lần đọc, không lệch nhau.
  const gaps = await listSnapshotGaps({ today: options.today, entries });
  const sealed = new Set(entries.map((entry) => entry.day));
  // `readSnapshotEntries` trả cũ → mới, nên phần tử cuối là đuôi chuỗi neo.
  const tip = entries.length > 0 ? entries[entries.length - 1].day : null;
  // Cùng một payload cho mọi ngày được chốt bù trong lượt này.
  const payload = buildBackfillPayload(options.payload, {
    capturedAt: options.capturedAt ?? new Date().toISOString(),
  });

  const rows: SnapshotBackfillRow[] = [];
  for (const day of days) {
    if (sealed.has(day)) {
      rows.push({ day, status: "exists", skipped: null, result: null });
      continue;
    }
    if (tip !== null && day < tip) {
      rows.push({ day, status: "skipped", skipped: "chain-gap", result: null });
      continue;
    }
    const { decision, result } = await publishClosedDaySnapshot({
      payload,
      lastEvaluatedAt: options.lastEvaluatedAt,
      hasPicks: options.hasPicks,
      metricsVersion: options.metricsVersion,
      day,
      today: options.today,
    });
    rows.push(
      decision.ok && result
        ? { day, status: result.created ? "sealed" : "exists", skipped: null, result }
        : { day, status: "skipped", skipped: decision.reason, result: null }
    );
  }
  return { rows, gaps };
}

export interface SnapshotDayStatus {
  day: string;
  entry: SnapshotEntry | null;
  /** Payload trong DB còn khớp `payload_hash`; null khi ngày chưa có bản chụp. */
  payloadMatches: boolean | null;
  /**
   * `head_hash` của ngày này khớp neo tính lại từ ngày trước (hoặc genesis).
   * null khi ngày chưa có bản chụp. Bắt được sửa tay cột head mà băm payload
   * không thấy.
   */
  headLinked: boolean | null;
  /** Bản chụp liền trước dùng cho neo (null = đây là bản đầu). */
  previousDay: string | null;
}

/**
 * Trạng thái kiểm được tại chỗ của một ngày: có bản chụp không, payload còn
 * khớp hash không, và head có nối đúng bản trước không. Dùng cho `/api/health`
 * và test; không trả payload ra ngoài.
 */
export async function readSnapshotDayStatus(day: string): Promise<SnapshotDayStatus> {
  const [row] = await db
    .select()
    .from(trackRecordSnapshots)
    .where(eq(trackRecordSnapshots.day, day))
    .limit(1);
  if (!row) {
    return { day, entry: null, payloadMatches: null, headLinked: null, previousDay: null };
  }

  const [prev] = await db
    .select({ day: trackRecordSnapshots.day, headHash: trackRecordSnapshots.headHash })
    .from(trackRecordSnapshots)
    .where(lt(trackRecordSnapshots.day, day))
    .orderBy(desc(trackRecordSnapshots.day))
    .limit(1);

  const expectedHead = computeHeadHash({
    day: row.day,
    payloadHash: row.payloadHash,
    prevHead: prev?.headHash ?? SNAPSHOT_GENESIS_HASH,
  });

  return {
    day: row.day,
    entry: toEntry(row),
    payloadMatches: snapshotPayloadHash(row.payload) === row.payloadHash,
    headLinked: expectedHead === row.headHash,
    previousDay: prev?.day ?? null,
  };
}

/** Payload của một bản chụp (để verify hash, không trả ra API công khai). */
export async function readSnapshotPayload(day: string): Promise<unknown | null> {
  const [row] = await db
    .select({ payload: trackRecordSnapshots.payload })
    .from(trackRecordSnapshots)
    .where(eq(trackRecordSnapshots.day, day))
    .limit(1);
  return row?.payload ?? null;
}

export interface SnapshotVerification {
  ok: boolean;
  /** Số dòng đã kiểm payload. */
  checked: number;
  /** Ngày có payload trong DB không còn khớp `payload_hash` đã công bố. */
  mismatchedDays: string[];
}

export interface VerifiedSnapshotChain {
  entries: SnapshotEntry[];
  head: string;
  verification: SnapshotVerification;
}

/**
 * Đọc các bản chụp + băm lại payload của từng dòng. Đây là phần kiểm được tại
 * chỗ; tính toàn vẹn của lịch sử dựa vào `head` đã neo bên ngoài.
 */
export async function readVerifiedSnapshotChain(
  limit = SNAPSHOT_READ_LIMIT
): Promise<VerifiedSnapshotChain> {
  const rows = await db
    .select()
    .from(trackRecordSnapshots)
    .orderBy(desc(trackRecordSnapshots.day))
    .limit(clampLimit(limit));

  const mismatchedDays = rows
    .filter((row) => snapshotPayloadHash(row.payload) !== row.payloadHash)
    .map((row) => row.day);
  const entries = rows.map(toEntry).reverse();

  return {
    entries,
    head: entries.length > 0 ? entries[entries.length - 1].headHash : SNAPSHOT_GENESIS_HASH,
    verification: {
      ok: mismatchedDays.length === 0,
      checked: entries.length,
      mismatchedDays: mismatchedDays.reverse(),
    },
  };
}
