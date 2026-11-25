// SNAPSHOT-02 E2E — migration 0040 + 0041 và publishDailySnapshot/
// readVerifiedSnapshotChain chạy trên Postgres THẬT (PGlite).
//
// Bản v2 chỉ giữ `payload_hash` (kiểm lại được từ payload) và `head_hash` (neo
// in ra ngoài). Test này khoá đúng những gì còn lại: migration rút cột đúng,
// hai ngày nối head, chạy lại cùng ngày không ghi đè, và payload bị sửa trong
// DB thì lần đọc có kiểm phải báo lệch.
//
// Giới hạn đã biết, cố ý: sửa `head_hash`/`payload_hash` trong DB mà không sửa
// payload thì app KHÔNG tự phát hiện (không còn kiểm chuỗi) — đó là lý do mỗi
// lần chốt phải in `head` ra ngoài. Test cuối ghi lại đúng giới hạn này.
//
// PHẢI chạy qua `npm test` (NODE_OPTIONS=--experimental-vm-modules): PGlite nạp
// WASM bằng dynamic import.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

let mockDbInstance: unknown;

jest.mock("@/db", () => ({
  get db() {
    return mockDbInstance;
  },
}));

import {
  listSnapshotGaps,
  publishClosedDaySnapshot,
  publishDailySnapshot,
  readSnapshotDayStatus,
  readSnapshotEntries,
  readSnapshotPayload,
  readVerifiedSnapshotChain,
} from "../snapshot-store";
import {
  SNAPSHOT_GENESIS_HASH,
  buildSnapshotPayload,
  computeHeadHash,
  snapshotPayloadHash,
} from "../snapshot";

jest.setTimeout(30_000);

const MIGRATION_0040 = readFileSync(
  join(process.cwd(), "drizzle/migrations/0040_track_record_snapshots.sql"),
  "utf8"
);
const MIGRATION_0041 = readFileSync(
  join(process.cwd(), "drizzle/migrations/0041_track_record_snapshot_anchor.sql"),
  "utf8"
);

const DAY_ONE = "2026-11-20";
const DAY_TWO = "2026-11-21";
const METRICS_VERSION = "track-record-v11";

const payloadOne = { totalRNet: 12.5, trades: 4, version: METRICS_VERSION };
const payloadTwo = { totalRNet: -3.25, trades: 5, version: METRICS_VERSION };
const otherPayload = { totalRNet: 999, trades: 99, version: METRICS_VERSION };

let client: PGlite;
let pg: ReturnType<typeof drizzle>;

beforeAll(async () => {
  client = new PGlite();
  // Chạy đúng thứ tự migration sẽ chạy trên production: 0040 dựng bảng, 0041
  // rút chuỗi và thêm head_hash.
  await client.exec(MIGRATION_0040);
  await client.exec(MIGRATION_0041);
  pg = drizzle(client, { schema });
  mockDbInstance = pg;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.query("DELETE FROM track_record_snapshots");
});

// `capturedAt` cố định để test khoá được hash: mọi payload đã chốt mang
// `snapshot.capturedAt` và field đó nằm trong `payload_hash`.
const CAPTURED_ONE = "2026-11-20T23:59:00.000Z";
const CAPTURED_TWO = "2026-11-21T23:59:00.000Z";
const sealedOne = buildSnapshotPayload(payloadOne, { capturedAt: CAPTURED_ONE });
const sealedTwo = buildSnapshotPayload(payloadTwo, { capturedAt: CAPTURED_TWO });

async function sealTwoDays() {
  const first = await publishDailySnapshot(payloadOne, DAY_ONE, METRICS_VERSION, {
    capturedAt: CAPTURED_ONE,
  });
  const second = await publishDailySnapshot(payloadTwo, DAY_TWO, METRICS_VERSION, {
    capturedAt: CAPTURED_TWO,
  });
  return { first, second };
}

describe("SNAPSHOT-02 — bản chụp + neo head trên Postgres thật", () => {
  test("0040 + 0041 để lại đúng cột: không còn sequence/prev_hash/hash", async () => {
    const cols = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'track_record_snapshots'
        ORDER BY ordinal_position`
    );
    expect(cols.rows).toEqual([
      { column_name: "day", data_type: "date", is_nullable: "NO" },
      { column_name: "payload_hash", data_type: "character varying", is_nullable: "NO" },
      { column_name: "metrics_version", data_type: "character varying", is_nullable: "NO" },
      { column_name: "payload", data_type: "jsonb", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "head_hash", data_type: "character varying", is_nullable: "NO" },
    ]);

    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'track_record_snapshots' ORDER BY indexname`
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "track_record_snapshots_created_idx",
      "track_record_snapshots_pkey",
    ]);
  });

  test("chốt hai ngày: head ngày sau nối head ngày trước, verification sạch", async () => {
    const { first, second } = await sealTwoDays();

    expect(first.created).toBe(true);
    expect(first.entry).toMatchObject({
      day: DAY_ONE,
      metricsVersion: METRICS_VERSION,
      payloadHash: snapshotPayloadHash(sealedOne),
    });
    // Ngày đầu neo từ genesis.
    expect(first.entry.headHash).toBe(
      computeHeadHash({
        day: DAY_ONE,
        payloadHash: snapshotPayloadHash(sealedOne),
        prevHead: SNAPSHOT_GENESIS_HASH,
      })
    );

    expect(second.created).toBe(true);
    // Ngày sau neo từ head ngày trước — in head hôm trước ra ngoài là đủ để
    // phát hiện sửa hôm trước.
    expect(second.entry.headHash).toBe(
      computeHeadHash({
        day: DAY_TWO,
        payloadHash: snapshotPayloadHash(sealedTwo),
        prevHead: first.entry.headHash,
      })
    );
    expect(second.head).toBe(second.entry.headHash);

    const chain = await readVerifiedSnapshotChain();
    expect(chain.entries.map((entry) => entry.day)).toEqual([DAY_ONE, DAY_TWO]);
    expect(chain.head).toBe(second.entry.headHash);
    expect(chain.verification).toEqual({ ok: true, checked: 2, mismatchedDays: [] });

    // Payload đã chốt đọc lại đúng nội dung và khớp payload_hash.
    const stored = await readSnapshotPayload(DAY_TWO);
    // Payload đọc lại mang dấu `snapshot.capturedAt` đã nằm trong hash.
    expect(stored).toEqual(sealedTwo);
    expect(snapshotPayloadHash(stored)).toBe(second.entry.payloadHash);
    expect((stored as { snapshot: { capturedAt: string } }).snapshot.capturedAt).toBe(
      CAPTURED_TWO
    );
  });

  test("chạy lại cùng ngày trả created=false, giữ nguyên payload đã công bố", async () => {
    const { first, second } = await sealTwoDays();

    const again = await publishDailySnapshot(otherPayload, DAY_ONE, "track-record-v99");

    expect(again.created).toBe(false);
    expect(again.entry.payloadHash).toBe(first.entry.payloadHash);
    expect(again.entry.headHash).toBe(first.entry.headHash);
    expect(again.entry.metricsVersion).toBe(METRICS_VERSION);
    // Head trả về là head THẬT của chuỗi (ngày mới nhất), không phải head vừa tính.
    expect(again.head).toBe(second.entry.headHash);

    const rows = await client.query<{ day: Date; payload: unknown; head_hash: string }>(
      `SELECT day, payload, head_hash FROM track_record_snapshots ORDER BY day`
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].payload).toEqual(sealedOne);
    expect(rows.rows[0].head_hash).toBe(first.entry.headHash);
    expect(rows.rows[1].head_hash).toBe(second.entry.headHash);

    const chain = await readVerifiedSnapshotChain();
    expect(chain.verification.ok).toBe(true);
    expect(await readSnapshotPayload(DAY_ONE)).toEqual(sealedOne);
  });

  test("sửa payload trong DB: payload_hash không còn khớp, verify báo đúng ngày", async () => {
    await sealTwoDays();

    await client.query(
      `UPDATE track_record_snapshots SET payload = $2::jsonb WHERE day = $1`,
      [DAY_TWO, JSON.stringify(otherPayload)]
    );

    const chain = await readVerifiedSnapshotChain();
    expect(chain.verification).toEqual({
      ok: false,
      checked: 2,
      mismatchedDays: [DAY_TWO],
    });
    // Hash đã công bố vẫn nguyên — chính nó là bằng chứng payload bị đổi.
    const entries = await readSnapshotEntries();
    expect(entries[1].payloadHash).toBe(snapshotPayloadHash(sealedTwo));
  });

  test("auto-snapshot: từ chối ngày chưa đóng và ngày chưa qua settlement, không ghi dòng nào", async () => {
    const open = await publishClosedDaySnapshot({
      payload: payloadOne,
      lastEvaluatedAt: `${DAY_TWO}T02:00:00.000Z`,
      metricsVersion: METRICS_VERSION,
      day: DAY_TWO,
      today: DAY_TWO,
    });
    expect(open).toMatchObject({ decision: { reason: "day-open" }, result: null });

    const stale = await publishClosedDaySnapshot({
      payload: payloadOne,
      lastEvaluatedAt: `${DAY_ONE}T02:00:00.000Z`,
      metricsVersion: METRICS_VERSION,
      day: DAY_TWO,
      today: "2026-11-23",
    });
    expect(stale).toMatchObject({ decision: { reason: "settlement-pending" }, result: null });

    expect(await readSnapshotEntries()).toEqual([]);
  });

  test("auto-snapshot: track record rỗng chưa từng settlement vẫn chốt được ngày đầu", async () => {
    // Deployment mới: `lastEvaluatedAt` null vì chưa có pick nào. Không được
    // coi là settlement tụt lại — nếu không sẽ không bao giờ có bản chụp đầu.
    const emptyPayload = { summary: { totals: { picks: 0 }, lastEvaluatedAt: null }, meta: {} };

    const result = await publishClosedDaySnapshot({
      payload: emptyPayload,
      lastEvaluatedAt: null,
      hasPicks: false,
      metricsVersion: METRICS_VERSION,
      day: DAY_ONE,
      today: DAY_TWO,
      capturedAt: CAPTURED_ONE,
    });

    expect(result.decision.ok).toBe(true);
    expect(result.result).toMatchObject({ created: true, entry: { day: DAY_ONE } });
    expect(await readSnapshotPayload(DAY_ONE)).toEqual(
      buildSnapshotPayload(emptyPayload, { capturedAt: CAPTURED_ONE })
    );
  });

  test("auto-snapshot: ngày đã đóng + đã settlement thì chốt, chạy lại không ghi đè", async () => {
    // Settlement chạy sáng hôm sau (DAY_TWO) cho ngày DAY_ONE vừa đóng.
    const first = await publishClosedDaySnapshot({
      payload: payloadOne,
      lastEvaluatedAt: `${DAY_TWO}T00:30:00.000Z`,
      metricsVersion: METRICS_VERSION,
      day: DAY_ONE,
      today: DAY_TWO,
      capturedAt: CAPTURED_ONE,
    });
    expect(first.decision.ok).toBe(true);
    expect(first.result).toMatchObject({ created: true, entry: { day: DAY_ONE } });

    // Lượt refresh thứ hai trong cùng ngày: idempotent, giữ payload đã công bố.
    const second = await publishClosedDaySnapshot({
      payload: otherPayload,
      lastEvaluatedAt: `${DAY_TWO}T04:00:00.000Z`,
      metricsVersion: METRICS_VERSION,
      day: DAY_ONE,
      today: DAY_TWO,
    });
    expect(second.decision.ok).toBe(true);
    expect(second.result).toMatchObject({ created: false, entry: { day: DAY_ONE } });
    expect(await readSnapshotPayload(DAY_ONE)).toEqual(sealedOne);
    expect(await readSnapshotEntries()).toHaveLength(1);
  });

  test("chốt xong tự neo head ra ngoài: log đủ day/payloadHash/head, chạy lại không neo lần nữa", async () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const first = await publishDailySnapshot(payloadOne, DAY_ONE, METRICS_VERSION);
      const anchorLines = info.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("[SNAPSHOT-ANCHOR]"));

      expect(anchorLines).toEqual([
        `[SNAPSHOT-ANCHOR] day=${DAY_ONE} payloadHash=${first.entry.payloadHash} head=${first.entry.headHash}`,
      ]);
      expect(first.anchor).toMatchObject({ delivered: 0, anchored: false, skipped: null });
      // Test env không cấu hình kênh nào → phải nói ra là head mới chỉ ở log.
      expect(
        warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes("không kênh nào nhận"))
      ).toBe(true);

      // Lượt chạy lại cùng ngày không tạo dòng mới → không gửi neo trùng.
      info.mockClear();
      const again = await publishDailySnapshot(otherPayload, DAY_ONE, METRICS_VERSION);
      expect(again.anchor).toBeNull();
      expect(
        info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("[SNAPSHOT-ANCHOR]"))
      ).toEqual([]);
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  test("readSnapshotDayStatus: ngày chưa có bản chụp trả entry null", async () => {
    const status = await readSnapshotDayStatus(DAY_ONE);
    expect(status).toEqual({
      day: DAY_ONE,
      entry: null,
      payloadMatches: null,
      headLinked: null,
      previousDay: null,
    });
  });

  test("readSnapshotDayStatus: bản chụp sạch khớp payload + nối đúng head bản trước", async () => {
    const { first, second } = await sealTwoDays();

    const dayTwo = await readSnapshotDayStatus(DAY_TWO);
    expect(dayTwo.entry?.headHash).toBe(second.entry.headHash);
    expect(dayTwo.payloadMatches).toBe(true);
    expect(dayTwo.headLinked).toBe(true);
    expect(dayTwo.previousDay).toBe(DAY_ONE);

    // Bản đầu neo từ genesis.
    const dayOne = await readSnapshotDayStatus(DAY_ONE);
    expect(dayOne.headLinked).toBe(true);
    expect(dayOne.previousDay).toBeNull();
    expect(dayOne.entry?.headHash).toBe(first.entry.headHash);
  });

  test("readSnapshotDayStatus: payload bị sửa → payloadMatches false, head vẫn nối", async () => {
    await sealTwoDays();
    await client.query(
      `UPDATE track_record_snapshots SET payload = $2::jsonb WHERE day = $1`,
      [DAY_TWO, JSON.stringify(otherPayload)]
    );

    const status = await readSnapshotDayStatus(DAY_TWO);
    expect(status.payloadMatches).toBe(false);
    expect(status.headLinked).toBe(true);
  });

  test("readSnapshotDayStatus: head_hash bị sửa → headLinked false", async () => {
    await sealTwoDays();
    await client.query(
      `UPDATE track_record_snapshots SET head_hash = repeat('f', 64) WHERE day = $1`,
      [DAY_TWO]
    );

    const status = await readSnapshotDayStatus(DAY_TWO);
    expect(status.payloadMatches).toBe(true);
    expect(status.headLinked).toBe(false);
    expect(status.previousDay).toBe(DAY_ONE);
  });

  test("giới hạn có chủ ý: sửa head_hash trong DB thì app không tự phát hiện", async () => {
    const { first } = await sealTwoDays();

    await client.query(
      `UPDATE track_record_snapshots SET head_hash = repeat('f', 64) WHERE day = $1`,
      [DAY_ONE]
    );

    // Không còn kiểm chuỗi nội bộ: payload vẫn khớp payload_hash nên verification
    // sạch. Sửa head chỉ bị phát hiện khi so với head đã in ra ngoài — đây là
    // tradeoff của bản rút gọn, không phải bug bị che.
    const chain = await readVerifiedSnapshotChain();
    expect(chain.verification.ok).toBe(true);
    expect(chain.entries[0].headHash).toBe("f".repeat(64));
    expect(chain.entries[0].headHash).not.toBe(first.entry.headHash);
  });
});

describe("SNAPSHOT-02 — báo ngày đã đóng còn thiếu (không chốt bù)", () => {
  const TODAY = "2026-11-24";

  test("bảng trống: không báo gì vì chưa có mốc neo nào", async () => {
    const gaps = await listSnapshotGaps({ today: TODAY });

    // Deployment mới không bị coi là "đang thiếu 31 ngày".
    expect(gaps).toEqual({ missing: [], windowDays: 31, tip: null });
  });

  test("refresh chết 5 ngày: báo đủ 5 ngày và KHÔNG ghi thêm dòng nào", async () => {
    await publishDailySnapshot(payloadOne, "2026-11-18", METRICS_VERSION);

    const gaps = await listSnapshotGaps({ today: TODAY });

    expect(gaps.tip).toBe("2026-11-18");
    expect(gaps.missing).toEqual([
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
    ]);
    // Không có chốt bù: bảng vẫn đúng 1 dòng, ngày thiếu vẫn thiếu.
    expect(await readSnapshotEntries()).toHaveLength(1);
    expect(await readSnapshotDayStatus("2026-11-20")).toMatchObject({ entry: null });
  });

  test("lỗ chen giữa hai bản đã chốt cũng được báo, chuỗi vẫn nối đúng", async () => {
    await publishDailySnapshot(payloadOne, "2026-11-21", METRICS_VERSION);
    await publishDailySnapshot(payloadTwo, "2026-11-23", METRICS_VERSION);

    const gaps = await listSnapshotGaps({ today: TODAY });

    expect(gaps.tip).toBe("2026-11-23");
    expect(gaps.missing).toEqual(["2026-11-22"]);
    // Ngày sau vẫn neo vào bản liền trước nó (11-21), không bị chen.
    expect((await readSnapshotDayStatus("2026-11-23")).headLinked).toBe(true);
  });

  test("ngày trước bản chụp đầu tiên không bị tính là thiếu", async () => {
    await publishDailySnapshot(payloadOne, "2026-11-20", METRICS_VERSION);

    const gaps = await listSnapshotGaps({ today: TODAY });
    expect(gaps.missing).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
    // Không có 2026-10-24..2026-11-19 (trước khi chuỗi bắt đầu).
    expect(gaps.missing).not.toContain("2026-11-19");
  });

  test("cửa sổ báo cáo bị kẹp theo tham số, không quét vô hạn", async () => {
    await publishDailySnapshot(payloadOne, "2026-09-25", METRICS_VERSION);

    const gaps = await listSnapshotGaps({ today: TODAY, windowDays: 3 });
    expect(gaps.windowDays).toBe(3);
    expect(gaps.missing).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
  });

  test("mọi ngày đã đóng đều có bản chụp → không báo gì", async () => {
    await publishDailySnapshot(payloadOne, "2026-11-21", METRICS_VERSION);
    await publishDailySnapshot(payloadTwo, "2026-11-22", METRICS_VERSION);
    await publishDailySnapshot({ ...payloadOne, sealed: "23" }, "2026-11-23", METRICS_VERSION);

    const gaps = await listSnapshotGaps({ today: TODAY });
    expect(gaps).toEqual({ missing: [], windowDays: 31, tip: "2026-11-23" });
  });
});

describe("SNAPSHOT-02 — 0041 chạy lại được", () => {
  test("backfill từ `hash` ở lần đầu; lần thứ hai không lỗi và không đổi head_hash", async () => {
    const db = new PGlite();
    try {
      await db.exec(MIGRATION_0040);
      // Dòng do SNAPSHOT-01 ghi: có sequence/prev_hash/hash, chưa có head_hash.
      await db.query(
        `INSERT INTO track_record_snapshots
           (day, sequence, payload_hash, prev_hash, hash, metrics_version, payload)
         VALUES ($1, 1, $2, $3, $4, $5, $6::jsonb)`,
        [
          "2026-11-20",
          "p".repeat(64),
          SNAPSHOT_GENESIS_HASH,
          "h".repeat(64),
          METRICS_VERSION,
          JSON.stringify(payloadOne),
        ]
      );

      await db.exec(MIGRATION_0041);
      const first = await db.query<{ head_hash: string }>(
        "SELECT head_hash FROM track_record_snapshots"
      );
      // Backfill giữ nguyên giá trị `hash` cũ.
      expect(first.rows[0].head_hash).toBe("h".repeat(64));

      // Lần thứ hai: trước đây chết ở `UPDATE ... = hash` vì 0041 đã drop cột đó.
      await db.exec(MIGRATION_0041);

      const cols = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'track_record_snapshots'
          ORDER BY ordinal_position`
      );
      expect(cols.rows.map((row) => row.column_name)).toEqual([
        "day",
        "payload_hash",
        "metrics_version",
        "payload",
        "created_at",
        "head_hash",
      ]);
      const again = await db.query<{ head_hash: string }>(
        "SELECT head_hash FROM track_record_snapshots"
      );
      expect(again.rows[0].head_hash).toBe("h".repeat(64));
    } finally {
      await db.close();
    }
  });
});
