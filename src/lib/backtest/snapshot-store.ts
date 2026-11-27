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
  buildSnapshotPayload,
  closedDaysBefore,
  computeHeadHash,
  evaluateSnapshotDay,
  evaluateSnapshotFreshness,
  payloadSchemaVersion,
  snapshotPayloadHash,
  snapshotPayloadMatches,
  type SnapshotDayDecision,
  type SnapshotEntry,
  type SnapshotFreshness,
} from "./snapshot";
import { emitSnapshotAnchor, type SnapshotAnchorOutcome } from "./snapshot-anchor";

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
    // Đọc từ payload, không lấy hằng số: dòng chốt trước v2 vẫn được verify
    // bằng luật v1 thay vì bị báo nhầm là đã bị sửa.
    schemaVersion: payloadSchemaVersion(row.payload),
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
  /**
   * Kết quả neo `head` ra ngoài (SNAPSHOT-02-ANCHOR). `null` = lần gọi này
   * không tạo dòng mới nên không có gì để neo (tránh gửi trùng mỗi lượt refresh).
   */
  anchor: SnapshotAnchorOutcome | null;
}

/**
 * Chốt payload của `day`. Idempotent: ngày đã có bản chụp thì trả dòng cũ với
 * `created: false` — không âm thầm ghi đè thứ đã công bố.
 *
 * `capturedAt` được gói vào payload (`snapshot.capturedAt`) TRƯỚC khi băm, nên
 * thời điểm chụp nằm trong `payload_hash` và không sửa được sau khi công bố.
 * Chỉ truyền khi cần khoá giá trị trong test; production dùng thời điểm thực.
 */
export async function publishDailySnapshot(
  payload: unknown,
  day: string,
  metricsVersion: string,
  options: { capturedAt?: string } = {}
): Promise<PublishSnapshotResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`SNAPSHOT-02: ngày không hợp lệ (${day})`);
  }

  const sealedPayload = buildSnapshotPayload(payload as object, {
    capturedAt: options.capturedAt ?? new Date().toISOString(),
  });
  const payloadHash = snapshotPayloadHash(sealedPayload);
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
    .values({ day, payloadHash, headHash, metricsVersion, payload: sealedPayload })
    .onConflictDoNothing({ target: trackRecordSnapshots.day })
    .returning();

  if (inserted.length > 0) {
    const entry = toEntry(inserted[0]);
    // Neo ngay tại cửa ghi duy nhất: route POST và job trong `/api/refresh`
    // đều đi qua đây nên không có đường chốt nào quên neo. Chỉ ngày
    // vừa tạo mới được gửi — chạy lại job không dội lại tin đã gửi.
    const anchor = await emitSnapshotAnchor(entry);
    return { created: true, entry, head: headHash, anchor };
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
    anchor: null,
  };
}

/**
 * Chốt MỘT ngày đã đóng, kèm cổng kiểm tra dùng chung với route POST.
 *
 * Đây là chỗ DUY NHẤT gộp cổng (ngày đã đóng + settlement) với việc chốt:
 * route POST và job tự động trong `/api/refresh` đều đi qua đây, nên không có
 * bản sao luật nào để lệch nhau. Trả cả `decision` để caller hiển thị
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
  /** Chỉ để test khoá `snapshot.capturedAt`; production dùng thời điểm thực. */
  capturedAt?: string;
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
    result: await publishDailySnapshot(options.payload, options.day, options.metricsVersion, {
      capturedAt: options.capturedAt,
    }),
  };
}

/**
 * Số ngày đã đóng gần nhất được kiểm khi báo gap. Không có "cửa sổ chốt bù":
 * ngày thiếu chỉ được BÁO, không được ghi lại — số hiện tại không phải số của
 * ngày đó nên gán nhãn ngày cũ là tuyên bố sai (xem docs/Upgrade.md SNAPSHOT-02).
 */
export const SNAPSHOT_GAP_WINDOW_DAYS = 31;

export interface SnapshotGapReport {
  /**
   * Ngày ĐÃ ĐÓNG, từ bản chụp đầu tiên trở đi, mà không có bản chụp nào, cũ →
   * mới. Mảng rỗng khi bảng chưa từng được chốt hoặc khi mọi ngày đều đã chốt.
   */
  missing: string[];
  /** Số ngày đã đóng gần nhất được kiểm (cửa sổ báo cáo). */
  windowDays: number;
  /** Ngày mới nhất đã chốt (đuôi chuỗi neo); null = bảng rỗng. */
  tip: string | null;
}

/**
 * Liệt kê các ngày ĐÃ ĐÓNG còn thiếu bản chụp trong cửa sổ báo cáo.
 *
 * Chỉ xét ngày SAU `tip`: trước bản chụp đầu tiên thì chưa có gì để hứa, và
 * ngày chen giữa hai bản đã chốt chỉ xuất hiện khi ai đó sửa/xoá DB — việc đó
 * `readSnapshotDayStatus` bắt ở chính ngày bị sửa, không phải ở đây.
 *
 * Hàm này KHÔNG chốt bù gì cả: nó chỉ trả lời "ngày nào đang thiếu" để log và
 * health nói ra. Bảng append-only nên thiếu là thiếu vĩnh viễn.
 */
export async function listSnapshotGaps(options: {
  today: string;
  /** Số ngày đã đóng gần nhất được kiểm; mặc định `SNAPSHOT_GAP_WINDOW_DAYS`. */
  windowDays?: number;
  /** Truyền sẵn entries để caller khỏi đọc DB hai lần. */
  entries?: SnapshotEntry[];
}): Promise<SnapshotGapReport> {
  const windowDays = Math.min(
    Math.max(1, Math.floor(options.windowDays ?? SNAPSHOT_GAP_WINDOW_DAYS)),
    366
  );
  const entries = options.entries ?? (await readSnapshotEntries());
  const tip = entries.length > 0 ? entries[entries.length - 1].day : null;
  // Chưa từng chốt ngày nào: không có mốc nào để nói "đáng lẽ phải có", và
  // deployment mới không được coi là đang thiếu 31 ngày.
  if (tip === null) return { missing: [], windowDays, tip: null };

  const sealed = new Set(entries.map((entry) => entry.day));
  // Mốc bắt đầu "đã hứa": ngày chốt sớm nhất. Ngày trước nó thì chưa có gì để
  // thiếu; từ nó trở đi, ngày đã đóng mà không có dòng đều được báo — kể cả lỗ
  // chen giữa (chỉ xảy ra khi ai đó sửa/xoá DB, và càng phải nói ra).
  const first = entries[0].day;
  const missing = closedDaysBefore(options.today, windowDays).filter(
    (day) => day >= first && !sealed.has(day)
  );
  return { missing, windowDays, tip };
}

export interface SnapshotDayStatus {
  day: string;
  entry: SnapshotEntry | null;
  /** Payload trong DB còn khớp `payload_hash`; null khi ngày chưa có bản chụp. */
  payloadMatches: boolean | null;
  /** Luật băm của dòng này (1 = trước SNAPSHOT-02); null khi chưa có bản chụp. */
  schemaVersion: number | null;
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
    return {
      day,
      entry: null,
      payloadMatches: null,
      schemaVersion: null,
      headLinked: null,
      previousDay: null,
    };
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

  const entry = toEntry(row);
  return {
    day: row.day,
    entry,
    payloadMatches: snapshotPayloadMatches(entry, row.payload),
    schemaVersion: entry.schemaVersion,
    headLinked: expectedHead === row.headHash,
    previousDay: prev?.day ?? null,
  };
}

/**
 * WATCHDOG-SNAPSHOT — đọc MỘT dòng mới nhất để đo độ trễ của bản chụp.
 *
 * Chỉ select `day` + rule băm: không kéo payload 90 ngày về như
 * `readVerifiedSnapshotChain`. Dùng cho health vì đây là thứ uptime monitor gọi
 * liên tục, và nó phải còn nói được khi refresh (nơi duy nhất chạy gap) đã chết.
 */
export async function readSnapshotFreshness(options: {
  today: string;
  /** Mặc định `SNAPSHOT_MAX_AGE_DAYS` (1 ngày). */
  maxAgeDays?: number;
}): Promise<SnapshotFreshness> {
  const [row] = await db
    .select({ day: trackRecordSnapshots.day, payload: trackRecordSnapshots.payload })
    .from(trackRecordSnapshots)
    .orderBy(desc(trackRecordSnapshots.day))
    .limit(1);
  return evaluateSnapshotFreshness({
    tipDay: row?.day ?? null,
    today: options.today,
    maxAgeDays: options.maxAgeDays,
  });
}

/**
 * Một bản chụp kèm MỌI thứ cần để người ngoài kiểm lại mà không phải tin app:
 * payload gốc, hai hash đã công bố và `prevHead` (đầu vào của neo). Không có
 * `prevHead` thì không ai tự tính lại được `head_hash` — đó là lý do endpoint
 * công khai trả cả ba thứ này cùng payload thay vì chỉ hai hash như GET list.
 */
export interface SnapshotPayloadBundle {
  entry: SnapshotEntry;
  payload: unknown;
  /** Head của bản chụp liền trước; `SNAPSHOT_GENESIS_HASH` khi đây là bản đầu. */
  prevHead: string;
}

/** Bản chụp đầy đủ của một ngày (null = ngày chưa được chốt). */
export async function readSnapshotPayloadBundle(
  day: string
): Promise<SnapshotPayloadBundle | null> {
  const [row] = await db
    .select()
    .from(trackRecordSnapshots)
    .where(eq(trackRecordSnapshots.day, day))
    .limit(1);
  if (!row) return null;

  const [prev] = await db
    .select({ headHash: trackRecordSnapshots.headHash })
    .from(trackRecordSnapshots)
    .where(lt(trackRecordSnapshots.day, day))
    .orderBy(desc(trackRecordSnapshots.day))
    .limit(1);

  return {
    entry: toEntry(row),
    payload: row.payload,
    prevHead: prev?.headHash ?? SNAPSHOT_GENESIS_HASH,
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
    .filter((row) => !snapshotPayloadMatches(toEntry(row), row.payload))
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
