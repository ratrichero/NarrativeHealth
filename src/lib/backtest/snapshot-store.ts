// SNAPSHOT-01 — đọc/ghi bản chụp track record theo ngày (server-only).
//
// Quy tắc: append-only, một dòng/ngày, dòng đầu tiên của ngày thắng. Chạy lại
// job không viết đè lịch sử; muốn sửa một ngày đã chốt thì phải tạo bản chụp
// mới ở ngày khác và chuỗi hash sẽ chỉ ra chỗ lệch.

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { trackRecordSnapshots } from "@/db/schema";
import {
  SNAPSHOT_GENESIS_HASH,
  buildSnapshotEntry,
  snapshotPayloadHash,
  verifySnapshotChain,
  type ChainVerification,
  type SnapshotEntry,
} from "./snapshot";

/** Số dòng tối đa trả về cho API công khai (đủ ~1 tháng, payload vừa phải). */
export const SNAPSHOT_CHAIN_LIMIT = 90;

type SnapshotRow = typeof trackRecordSnapshots.$inferSelect;

function toEntry(row: SnapshotRow): SnapshotEntry {
  return {
    day: row.day,
    sequence: row.sequence,
    payloadHash: row.payloadHash,
    prevHash: row.prevHash,
    hash: row.hash,
    metricsVersion: row.metricsVersion,
    createdAt:
      row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/** Chuỗi bản chụp, cũ → mới (thứ tự kiểm hash). */
export async function readSnapshotChain(limit = SNAPSHOT_CHAIN_LIMIT): Promise<SnapshotEntry[]> {
  const rows = await db
    .select()
    .from(trackRecordSnapshots)
    .orderBy(desc(trackRecordSnapshots.sequence))
    .limit(Math.min(Math.max(1, Math.floor(limit)), 365));
  return rows.map(toEntry).reverse();
}

export interface PublishSnapshotResult {
  /** false = ngày này đã có bản chụp, dòng cũ được giữ nguyên. */
  created: boolean;
  entry: SnapshotEntry;
  chainLength: number;
}

/**
 * Chốt payload của `day`. Idempotent: nếu ngày đã có bản chụp thì trả dòng cũ
 * với `created: false` — không âm thầm ghi đè thứ đã công bố.
 */
export async function publishDailySnapshot(
  payload: unknown,
  day: string,
  metricsVersion: string
): Promise<PublishSnapshotResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`SNAPSHOT-01: ngày không hợp lệ (${day})`);
  }

  const payloadHash = snapshotPayloadHash(payload);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [latest] = await db
      .select()
      .from(trackRecordSnapshots)
      .orderBy(desc(trackRecordSnapshots.sequence))
      .limit(1);

    const prevHash = latest?.hash ?? SNAPSHOT_GENESIS_HASH;
    const entry = buildSnapshotEntry({
      day,
      payloadHash,
      metricsVersion,
      prevHash,
    });

    const inserted = await db
      .insert(trackRecordSnapshots)
      .values({
        day,
        sequence: (latest?.sequence ?? 0) + 1,
        payloadHash,
        prevHash,
        hash: entry.hash,
        metricsVersion,
        payload: payload as object,
      })
      .onConflictDoNothing({ target: trackRecordSnapshots.day })
      .returning();

    if (inserted.length > 0) {
      const [count] = await db
        .select({ sequence: trackRecordSnapshots.sequence })
        .from(trackRecordSnapshots)
        .orderBy(desc(trackRecordSnapshots.sequence))
        .limit(1);
      return { created: true, entry: toEntry(inserted[0]), chainLength: count?.sequence ?? 1 };
    }

    // Ngày đã có (có thể do instance khác vừa ghi) → trả dòng hiện có.
    const existing = await db
      .select()
      .from(trackRecordSnapshots)
      .where(sqlDayEquals(day))
      .limit(1);
    if (existing.length > 0) {
      const [tip] = await db
        .select({ sequence: trackRecordSnapshots.sequence })
        .from(trackRecordSnapshots)
        .orderBy(desc(trackRecordSnapshots.sequence))
        .limit(1);
      return {
        created: false,
        entry: toEntry(existing[0]),
        chainLength: tip?.sequence ?? 1,
      };
    }
    // Không thấy dòng nhưng insert bị bỏ qua: sequence vừa đổi, thử lại.
  }

  throw new Error("SNAPSHOT-01: không chốt được bản chụp sau 3 lần thử");
}

/** Payload của một bản chụp (để verify hash, không trả ra API công khai). */
export async function readSnapshotPayload(day: string): Promise<unknown | null> {
  const [row] = await db
    .select({ payload: trackRecordSnapshots.payload })
    .from(trackRecordSnapshots)
    .where(sqlDayEquals(day))
    .limit(1);
  return row?.payload ?? null;
}

export interface VerifiedSnapshotChain {
  entries: SnapshotEntry[];
  verification: ChainVerification;
}

/** Đọc chuỗi + kiểm hash từng dòng (không kiểm payload để giữ response nhẹ). */
export async function readVerifiedSnapshotChain(
  limit = SNAPSHOT_CHAIN_LIMIT
): Promise<VerifiedSnapshotChain> {
  const entries = await readSnapshotChain(limit);
  return { entries, verification: verifySnapshotChain(entries) };
}

function sqlDayEquals(day: string) {
  return eq(trackRecordSnapshots.day, day);
}
