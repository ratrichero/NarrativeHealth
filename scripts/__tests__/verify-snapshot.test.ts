// SNAPSHOT-02-VERIFY — test script verify như NGƯỜI NGOÀI chạy: một tiến trình
// `node` riêng, chỉ nói chuyện với server qua HTTP, không import repo.
//
// Test dựng một server giả phục vụ đúng hai endpoint công khai rồi gọi script.
// Điều cần khoá: (a) chain hợp lệ → exit 0; (b) payload bị đổi → exit 1 và chỉ
// đúng ngày; (c) head neo ngoài lệch → exit 1; (d) dòng `[SNAPSHOT-ANCHOR]`
// lệch cũng bị bắt.

import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import {
  SNAPSHOT_GENESIS_HASH,
  SNAPSHOT_SCHEMA_VERSION,
  buildSnapshotPayload,
  computeHeadHash,
  snapshotPayloadHash,
  snapshotPayloadHashAtVersion,
} from "@/lib/backtest/snapshot";

jest.setTimeout(30_000);

const run = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts/verify-snapshot.mjs");

const DAY_ONE = "2026-11-22";
const DAY_TWO = "2026-11-23";
const payloadOne = { summary: { totals: { picks: 2 } }, meta: { dataAsOf: DAY_ONE } };
const payloadTwo = { summary: { totals: { picks: 3 } }, meta: { dataAsOf: DAY_TWO } };

interface DayFixture {
  payload: unknown;
  payloadHash: string;
  prevHead: string;
  headHash: string;
  /** Luật băm của dòng (1 = chốt trước SNAPSHOT-02, không có capturedAt). */
  schemaVersion: number;
}

function fixture(day: string, payload: object, prevHead: string): DayFixture {
  // Bản chụp thật mang `snapshot.capturedAt` ngay trong payload; hash tính trên
  // payload đã đóng gói, không phải payload trần.
  const sealed = buildSnapshotPayload(payload, { capturedAt: `${day}T23:59:00.000Z` });
  const payloadHash = snapshotPayloadHash(sealed);
  return {
    payload: sealed,
    payloadHash,
    prevHead,
    headHash: computeHeadHash({ day, payloadHash, prevHead }),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  };
}

/**
 * Dòng chốt TRƯỚC SNAPSHOT-02: payload trần, băm bằng tiền tố `v1|`. Những dòng
 * này hợp lệ — verify phải đọc `schemaVersion` của chính dòng, nếu băm bằng v2
 * thì mọi dòng cũ bị báo nhầm là đã bị sửa.
 */
function legacyFixture(day: string, payload: object, prevHead: string): DayFixture {
  const payloadHash = snapshotPayloadHashAtVersion(payload, 1);
  return {
    payload,
    payloadHash,
    prevHead,
    headHash: computeHeadHash({ day, payloadHash, prevHead }),
    schemaVersion: 1,
  };
}

let server: Server;
let baseUrl: string;
/** Test được sửa trực tiếp để mô phỏng DB/API bị sửa sau khi đã công bố. */
let days: Record<string, DayFixture>;

function entries() {
  return Object.entries(days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, fixture]) => ({
      day,
      payloadHash: fixture.payloadHash,
      headHash: fixture.headHash,
      metricsVersion: "track-record-v11",
      createdAt: `${day}T23:59:00.000Z`,
      schemaVersion: fixture.schemaVersion,
    }));
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    if (url.pathname === "/api/track-record/snapshots") {
      const all = entries();
      return json(200, { success: true, data: { entries: all, head: all.at(-1)?.headHash ?? SNAPSHOT_GENESIS_HASH } });
    }

    const match = /^\/api\/track-record\/snapshots\/(\d{4}-\d{2}-\d{2})$/.exec(url.pathname);
    if (match) {
      const day = match[1];
      const fixture = days[day];
      if (!fixture) return json(404, { success: false, error: `Ngày ${day} chưa có bản chụp nào.` });
      return json(200, {
        success: true,
        data: {
          day,
          payloadHash: fixture.payloadHash,
          headHash: fixture.headHash,
          prevHead: fixture.prevHead,
          schemaVersion: fixture.schemaVersion,
          metricsVersion: "track-record-v11",
          createdAt: `${day}T23:59:00.000Z`,
          payload: fixture.payload,
          hashRules: { algorithm: "sha256", schemaVersion: SNAPSHOT_SCHEMA_VERSION },
        },
      });
    }

    json(404, { success: false, error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("server không có cổng");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const one = fixture(DAY_ONE, payloadOne, SNAPSHOT_GENESIS_HASH);
  const two = fixture(DAY_TWO, payloadTwo, one.headHash);
  days = { [DAY_ONE]: one, [DAY_TWO]: two };
});

async function verify(args: string[] = []) {
  try {
    const result = await run(process.execPath, [SCRIPT, "--base-url", baseUrl, ...args]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("scripts/verify-snapshot.mjs", () => {
  it("chain hợp lệ: tự băm payload khớp payload_hash, head nối liền, exit 0", async () => {
    const result = await verify(["--days", "10"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`OK ${DAY_ONE}`);
    expect(result.stdout).toContain(`OK ${DAY_TWO}`);
    expect(result.stdout).toContain("TẤT CẢ KHỚP");
    // Không có head neo ngoài thì phải nói rõ là chưa chứng minh được lịch sử.
    expect(result.stderr).toContain("Không có head neo ngoài");
  });

  it("payload bị đổi sau khi chốt → exit 1, chỉ đúng ngày và hash lệch", async () => {
    // Sửa số liệu nhưng giữ nguyên dấu chụp → chỉ hash mới phát hiện được.
    days[DAY_TWO].payload = {
      ...(days[DAY_TWO].payload as Record<string, unknown>),
      summary: { totals: { picks: 99 } },
    };

    const result = await verify();

    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain("TẤT CẢ KHỚP");
    expect(result.stderr).toContain(`✗ ${DAY_TWO}: payloadHash lệch`);
    expect(result.stderr).toContain(days[DAY_TWO].payloadHash);
    // Ngày còn lại vẫn sạch — script không báo lây.
    expect(result.stdout).toContain(`OK ${DAY_ONE}`);
  });

  it("dòng chốt trước v2 (payload trần, băm v1) vẫn verify được → exit 0", async () => {
    const legacy = legacyFixture(DAY_ONE, payloadOne, SNAPSHOT_GENESIS_HASH);
    const two = fixture(DAY_TWO, payloadTwo, legacy.headHash);
    days = { [DAY_ONE]: legacy, [DAY_TWO]: two };

    const result = await verify();

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`OK ${DAY_ONE}`);
    expect(result.stdout).toContain("TẤT CẢ KHỚP");
  });

  it("payload bị bỏ snapshot.capturedAt → exit 1, nêu rõ field thiếu", async () => {
    const { snapshot: _seal, ...withoutSeal } = days[DAY_TWO].payload as Record<string, unknown>;
    days[DAY_TWO].payload = withoutSeal;

    const result = await verify();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("snapshot.capturedAt");
  });

  it("head neo ngoài lệch (--head) → exit 1", async () => {
    const result = await verify(["--head", "f".repeat(64)]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("head cuối");
    expect(result.stderr).toContain("khác head đã neo");
  });

  it("head neo ngoài khớp (--head) → exit 0", async () => {
    const result = await verify(["--head", days[DAY_TWO].headHash]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("head cuối khớp head đã neo");
  });

  it("dòng [SNAPSHOT-ANCHOR] bị sửa/không còn khớp → exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snapshot-anchor-"));
    try {
      const logPath = join(dir, "anchors.log");
      await writeFile(
        logPath,
        [
          `[SNAPSHOT-ANCHOR] day=${DAY_ONE} payloadHash=${days[DAY_ONE].payloadHash} head=${days[DAY_ONE].headHash}`,
          `[SNAPSHOT-ANCHOR] day=${DAY_TWO} payloadHash=${days[DAY_TWO].payloadHash} head=${"e".repeat(64)}`,
        ].join("\n"),
        "utf8"
      );

      const result = await verify(["--anchor-file", logPath]);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`${DAY_TWO}: headHash khác bản đã neo`);
      expect(result.stdout).toContain(`[đã đối chiếu neo]`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("anchor-file khớp đúng cả hai ngày → exit 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snapshot-anchor-"));
    try {
      const logPath = join(dir, "anchors.log");
      await writeFile(
        logPath,
        Object.entries(days)
          .map(
            ([day, fixture]) =>
              `[SNAPSHOT-ANCHOR] day=${day} payloadHash=${fixture.payloadHash} head=${fixture.headHash}`
          )
          .join("\n"),
        "utf8"
      );

      const result = await verify(["--anchor-file", logPath]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("TẤT CẢ KHỚP");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--require-anchor mà không có neo ngoài → exit 1 (kiểm ngoài VPS phải đối chiếu được)", async () => {
    const result = await verify(["--require-anchor"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Không có head neo ngoài");
  });

  it("--require-anchor + --head khớp → exit 0", async () => {
    const result = await verify(["--require-anchor", "--head", days[DAY_TWO].headHash]);

    expect(result.code).toBe(0);
  });

  it("ngày không có bản chụp (--day) → exit 1 với lỗi tải payload", async () => {
    const result = await verify(["--day", "2026-11-01"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("không tải được payload");
  });
});
