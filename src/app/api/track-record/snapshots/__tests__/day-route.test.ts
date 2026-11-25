// SNAPSHOT-02-PUBLIC — payload một ngày cho người ngoài kiểm độc lập.
//
// Test khoá đúng những gì làm endpoint này dùng được làm bằng chứng:
//   1. Trả payload + payloadHash + headHash + prevHead + luật băm (đủ để tự tính).
//   2. ETag mạnh = payload_hash và `If-None-Match` → 304 (client verify hàng loạt
//      không tải lại nội dung bất biến).
//   3. Ngày sai định dạng → 400 (không chạm DB), ngày chưa chốt → 404.
//   4. Có trần theo IP → 429 kèm Retry-After.

import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

jest.mock("@/lib/backtest/snapshot-store", () => ({
  readSnapshotPayloadBundle: jest.fn(),
}));

const { readSnapshotPayloadBundle } = require("@/lib/backtest/snapshot-store") as {
  readSnapshotPayloadBundle: jest.Mock<(day: string) => Promise<unknown>>;
};

import { SNAPSHOT_SCHEMA_VERSION } from "@/lib/backtest/snapshot";
import { snapshotPayloadLimiter } from "@/lib/market/rate-limit";
import { GET, etagMatches } from "../[day]/route";

const DAY = "2026-11-23";
const PAYLOAD_HASH = "a".repeat(64);
const HEAD_HASH = "b".repeat(64);
const PREV_HEAD = "c".repeat(64);

function request(headers: Record<string, string> = {}, day = DAY) {
  return new NextRequest(`http://localhost/api/track-record/snapshots/${day}`, { headers });
}

function get(day = DAY, headers: Record<string, string> = {}) {
  return GET(request(headers, day), { params: Promise.resolve({ day }) });
}

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    entry: {
      day: DAY,
      payloadHash: PAYLOAD_HASH,
      headHash: HEAD_HASH,
      metricsVersion: "track-record-v11",
      createdAt: "2026-11-24T00:10:00.000Z",
    },
    payload: { summary: { totals: { picks: 3 } }, meta: { dataAsOf: DAY } },
    prevHead: PREV_HEAD,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  snapshotPayloadLimiter.reset();
  readSnapshotPayloadBundle.mockResolvedValue(bundle());
});

describe("GET /api/track-record/snapshots/[day]", () => {
  it("trả payload + hai hash + prevHead + luật băm, ETag = payload_hash", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${PAYLOAD_HASH}"`);
    expect(response.headers.get("cache-control")).toContain("immutable");

    const body = (await response.json()) as {
      success: boolean;
      data: {
        day: string;
        payloadHash: string;
        headHash: string;
        prevHead: string;
        metricsVersion: string;
        createdAt: string;
        payload: unknown;
        hashRules: { algorithm: string; schemaVersion: number; payloadHash: string; headHash: string };
      };
    };

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      day: DAY,
      payloadHash: PAYLOAD_HASH,
      headHash: HEAD_HASH,
      prevHead: PREV_HEAD,
      metricsVersion: "track-record-v11",
      createdAt: "2026-11-24T00:10:00.000Z",
      payload: bundle().payload,
    });
    // Luật băm phải nói đúng công thức mà server dùng, nếu không người ngoài
    // băm lại sẽ lệch mà không hiểu vì sao.
    expect(body.data.hashRules.algorithm).toBe("sha256");
    expect(body.data.hashRules.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(body.data.hashRules.payloadHash).toContain(`sha256("v${SNAPSHOT_SCHEMA_VERSION}|"`);
    expect(body.data.hashRules.headHash).toContain('"head-v1|"');
    expect(readSnapshotPayloadBundle).toHaveBeenCalledWith(DAY);
  });

  it("If-None-Match khớp ETag → 304, không trả lại payload", async () => {
    const response = await get(DAY, { "if-none-match": `"${PAYLOAD_HASH}"` });
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe(`"${PAYLOAD_HASH}"`);
    expect(await response.text()).toBe("");
  });

  it("If-None-Match dạng yếu/list vẫn khớp", () => {
    expect(etagMatches(`W/"${PAYLOAD_HASH}"`, `"${PAYLOAD_HASH}"`)).toBe(true);
    expect(etagMatches(`"x", "${PAYLOAD_HASH}"`, `"${PAYLOAD_HASH}"`)).toBe(true);
    expect(etagMatches("*", `"${PAYLOAD_HASH}"`)).toBe(true);
    expect(etagMatches(`"khác"`, `"${PAYLOAD_HASH}"`)).toBe(false);
    expect(etagMatches(null, `"${PAYLOAD_HASH}"`)).toBe(false);
  });

  it("ngày sai định dạng → 400, không đọc DB", async () => {
    const response = await get("23-11-2026");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false });
    expect(readSnapshotPayloadBundle).not.toHaveBeenCalled();
  });

  it("ngày chưa chốt → 404", async () => {
    readSnapshotPayloadBundle.mockResolvedValue(null);
    const response = await get("2026-11-01");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ success: false });
  });

  it("vượt trần theo IP → 429 kèm Retry-After", async () => {
    const first = await get();
    const limit = Number(first.headers.get("x-ratelimit-limit") ?? "1");
    expect(first.headers.get("x-ratelimit-remaining")).toBe(String(limit - 1));
    for (let i = 1; i < limit; i += 1) await get();

    const blocked = await get();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(blocked.headers.get("x-ratelimit-remaining")).toBe("0");
  });

  it("lỗi DB → 500 nhưng không lộ chi tiết", async () => {
    readSnapshotPayloadBundle.mockRejectedValue(new Error("relation does not exist"));
    const response = await get();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("relation does not exist");
  });
});
