import { NextRequest } from "next/server";
import { db } from "@/db";
import { invalidateRadarConfigCache } from "@/lib/settings/radar-config";
import { GET, PUT } from "../route";

jest.mock("@/db", () => ({ db: { select: jest.fn(), insert: jest.fn() } }));
jest.mock("@/lib/market/radar", () => ({ invalidateRadarSnapshotCache: jest.fn() }));

const selectMock = db.select as unknown as jest.Mock;
const insertMock = db.insert as unknown as jest.Mock;
const onConflictDoUpdate = jest.fn(async () => undefined);
let valuesMock: jest.Mock;
let storedValue: unknown;

function put(body: unknown) {
  return new NextRequest("http://localhost/api/admin/radar/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  storedValue = undefined;
  onConflictDoUpdate.mockClear();
  insertMock.mockClear();
  invalidateRadarConfigCache();
  selectMock.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => (storedValue === undefined ? [] : [{ value: storedValue }]),
      }),
    }),
  });
  valuesMock = jest.fn(() => ({ onConflictDoUpdate }));
  insertMock.mockReturnValue({ values: valuesMock });
});

describe("PUT /api/admin/radar/config", () => {
  it("unpin xoá field khỏi DB để quay lại env fallback", async () => {
    storedValue = { values: { clusterMaxSize: 12, enrichPerSide: 8 } };

    const res = await PUT(put({ values: { clusterMaxSize: 12 }, unpin: ["enrichPerSide"] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.stored).toEqual({ clusterMaxSize: 12 });
    expect(json.data.applied).not.toContain("enrichPerSide");
    expect(valuesMock.mock.calls[0][0].value.values).toEqual({ clusterMaxSize: 12 });
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("chỉ gửi unpin (không có values) vẫn bỏ pin được", async () => {
    storedValue = { values: { alertMinScore: 80 } };

    const res = await PUT(put({ unpin: ["alertMinScore"] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.stored).toEqual({});
    expect(json.data.applied).toEqual([]);
  });

  it("unpin tên field lạ bị từ chối, không ghi DB", async () => {
    const res = await PUT(put({ unpin: ["khongCoFieldNay"] }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("unpin không phải mảng tên field bị từ chối", async () => {
    const res = await PUT(put({ values: { clusterMaxSize: 12 }, unpin: "clusterMaxSize" }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("payload rỗng (không values, không unpin) bị từ chối", async () => {
    const res = await PUT(put({}));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("GET trả stored + env để form biết field nào đang pin", async () => {
    storedValue = { values: { clusterMaxSize: 12 } };

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.stored).toEqual({ clusterMaxSize: 12 });
    expect(json.data.applied).toEqual(["clusterMaxSize"]);
    expect(json.data.env).toHaveProperty("clusterMaxSize");
    expect(json.data.fields.length).toBeGreaterThan(0);
  });
});
