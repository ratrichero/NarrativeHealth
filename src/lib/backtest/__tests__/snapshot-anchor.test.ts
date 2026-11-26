// SNAPSHOT-02-ANCHOR — test thuần: nội dung tin nhắn neo + hành vi khi gửi.
//
// Điều cần khoá: tin nhắn phải mang đủ `day`/`payloadHash`/`head` để người nhận
// đối chiếu được về sau, và việc gửi không bao giờ được ném lỗi hay chặn chốt.
// Test này không chạm mạng: dispatcher được truyền vào.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshotAnchorText, emitSnapshotAnchor, SNAPSHOT_ANCHOR_LOG_PREFIX } from "../snapshot-anchor";
import type { SnapshotEntry } from "../snapshot";

const entry: SnapshotEntry = {
  day: "2026-11-23",
  payloadHash: "a".repeat(64),
  headHash: "b".repeat(64),
  metricsVersion: "track-record-v11",
  createdAt: "2026-11-24T00:10:00.000Z",
  schemaVersion: 2,
};

describe("buildSnapshotAnchorText", () => {
  test("mang đủ day + payloadHash + head + metricsVersion", () => {
    const text = buildSnapshotAnchorText(entry);
    expect(text).toContain("Track record snapshot — 2026-11-23");
    expect(text).toContain(`day: ${entry.day}`);
    expect(text).toContain(`payloadHash: ${entry.payloadHash}`);
    expect(text).toContain(`head: ${entry.headHash}`);
    expect(text).toContain(`metricsVersion: ${entry.metricsVersion}`);
    expect(text).toContain(`createdAt: ${entry.createdAt}`);
    // Giải thích để người nhận biết phải làm gì với con số này.
    expect(text).toContain("head = băm(head ngày trước · ngày · payloadHash)");
  });

  test("không lẫn nội dung khác của payload (chỉ hash, không phải số liệu)", () => {
    const text = buildSnapshotAnchorText(entry);
    expect(text).not.toContain("totalRNet");
    expect(text).not.toContain("picks");
  });
});

describe("emitSnapshotAnchor", () => {
  const originalEnabled = process.env.SNAPSHOT_ANCHOR_ENABLED;
  const originalFile = process.env.SNAPSHOT_ANCHOR_FILE;
  let info: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.SNAPSHOT_ANCHOR_ENABLED;
    delete process.env.SNAPSHOT_ANCHOR_FILE;
    info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    info.mockRestore();
    warn.mockRestore();
    if (originalEnabled === undefined) delete process.env.SNAPSHOT_ANCHOR_ENABLED;
    else process.env.SNAPSHOT_ANCHOR_ENABLED = originalEnabled;
    if (originalFile === undefined) delete process.env.SNAPSHOT_ANCHOR_FILE;
    else process.env.SNAPSHOT_ANCHOR_FILE = originalFile;
  });

  test("log day/payloadHash/head trước khi gửi, kể cả khi gửi thành công", async () => {
    const dispatch = jest.fn(async () => 2);

    const outcome = await emitSnapshotAnchor(entry, dispatch);

    expect(outcome).toEqual({
      delivered: 2,
      anchored: true,
      skipped: null,
      fileAnchor: "not-configured",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [label, text] = dispatch.mock.calls[0] as unknown as [string, string];
    expect(label).toContain(entry.day);
    expect(text).toContain(entry.headHash);

    const logLines = info.mock.calls.map((call) => String(call[0]));
    expect(logLines[0]).toBe(
      `${SNAPSHOT_ANCHOR_LOG_PREFIX} day=${entry.day} payloadHash=${entry.payloadHash} head=${entry.headHash}`
    );
    expect(logLines.some((line) => line.includes("delivered=2"))).toBe(true);
  });

  test("không kênh nào cấu hình → anchored=false và cảnh báo head chỉ còn trong log", async () => {
    const outcome = await emitSnapshotAnchor(entry, async () => 0);

    expect(outcome).toEqual({
      delivered: 0,
      anchored: false,
      skipped: null,
      fileAnchor: "not-configured",
    });
    expect(warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes("không kênh nào nhận"))).toBe(
      true
    );
  });

  test("dispatcher ném lỗi → không ném ra ngoài, anchored=false", async () => {
    const outcome = await emitSnapshotAnchor(entry, async () => {
      throw new Error("telegram down");
    });

    expect(outcome).toEqual({
      delivered: 0,
      anchored: false,
      skipped: "error",
      fileAnchor: "not-configured",
    });
    expect(warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes("gửi neo lỗi"))).toBe(true);
  });

  test("SNAPSHOT_ANCHOR_ENABLED=0 → không gọi kênh nào, vẫn log neọ", async () => {
    process.env.SNAPSHOT_ANCHOR_ENABLED = "0";
    const dispatch = jest.fn(async () => 1);

    const outcome = await emitSnapshotAnchor(entry, dispatch);

    expect(outcome).toEqual({
      delivered: 0,
      anchored: false,
      skipped: "disabled",
      fileAnchor: "not-configured",
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(info.mock.calls.map((call) => String(call[0]))[0]).toContain(`head=${entry.headHash}`);
  });

  test("SNAPSHOT_ANCHOR_FILE → ghi thêm một dòng neo đọc được bởi verify --anchor-file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snapshot-anchor-file-"));
    try {
      const file = join(dir, "anchors.log");
      process.env.SNAPSHOT_ANCHOR_FILE = file;

      const first = await emitSnapshotAnchor(entry, async () => 0);
      const second = await emitSnapshotAnchor(
        { ...entry, day: "2026-11-24", headHash: "c".repeat(64) },
        async () => 0
      );

      expect(first.fileAnchor).toBe("appended");
      expect(second.fileAnchor).toBe("appended");

      const lines = (await readFile(file, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);
      // Cùng định dạng dòng log → parser của script verify đọc được.
      expect(lines[0]).toBe(
        `${SNAPSHOT_ANCHOR_LOG_PREFIX} day=${entry.day} payloadHash=${entry.payloadHash} head=${entry.headHash} metricsVersion=${entry.metricsVersion} createdAt=${entry.createdAt}`
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("ghi file lỗi (thư mục không tồn tại) → vẫn chốt, chỉ báo fileAnchor=error", async () => {
    process.env.SNAPSHOT_ANCHOR_FILE = "/nonexistent/dir/anchors.log";

    const outcome = await emitSnapshotAnchor(entry, async () => 1);

    expect(outcome).toMatchObject({ delivered: 1, anchored: true, fileAnchor: "error" });
    expect(warn.mock.calls.map((call) => String(call[0])).some((line) => line.includes("neo file"))).toBe(
      true
    );
  });
});
