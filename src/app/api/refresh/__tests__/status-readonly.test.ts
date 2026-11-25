import { describe, expect, it, jest } from "@jest/globals";

// SCHEDULER-AUTH follow-up: GET /api/refresh/status từng ghi scheduler_logs
// (FAILED cho job stale) dù endpoint public, không token/guard, và trả cả
// errorMessage/details. Test này chốt hai điều:
//   1. GET là read-only (không update/insert/delete).
//   2. Response public chỉ có trường trạng thái tối thiểu — không lộ
//      errorMessage/details/recordsProcessed.
jest.mock("@/db", () => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
  };
  const chain = {
    from: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(async () => state.rows),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);

  return {
    db: {
      select: jest.fn(() => chain),
      update: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
    },
    pool: {},
    __statusState: state,
    ...(jest.requireActual("@/db/schema") as object),
  };
});

import { db } from "@/db";
import { GET } from "../status/route";

const dbMock = db as unknown as Record<string, jest.Mock>;
const statusState = (
  jest.requireMock("@/db") as { __statusState: { rows: Array<Record<string, unknown>> } }
).__statusState;

const MINIMAL_KEYS = [
  "completedAt",
  "duration",
  "isRefreshing",
  "latestJob",
  "startedAt",
  "status",
];

type StatusBody = {
  success: boolean;
  data: Record<string, unknown> & {
    status: string;
    isRefreshing: boolean;
    latestJob: { jobName?: string; id?: number } | null;
  };
};

function logRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    jobName: "manual_refresh",
    status: "STARTED",
    startedAt: new Date(Date.now() - 20 * 60 * 1000),
    completedAt: null,
    duration: null,
    recordsProcessed: 42,
    errorMessage: "connect ECONNREFUSED 10.0.0.5:5432 — password=secret",
    details: { stack: "internal", db: "narrative_health" },
    ...overrides,
  };
}

async function readStatus(): Promise<{ status: number; body: StatusBody }> {
  const response = await GET();
  return { status: response.status, body: (await response.json()) as StatusBody };
}

describe("GET /api/refresh/status — read-only + tối thiểu", () => {
  it("báo job stale là FAILED nhưng không ghi DB", async () => {
    statusState.rows = [logRow()];

    const { status, body } = await readStatus();

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("FAILED");
    expect(body.data.isRefreshing).toBe(false);
    expect(dbMock.select).toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.delete).not.toHaveBeenCalled();
  });

  it("không trả errorMessage/details/recordsProcessed (job stale)", async () => {
    statusState.rows = [logRow()];

    const { body } = await readStatus();

    expect(Object.keys(body.data).sort()).toEqual(MINIMAL_KEYS);
    expect(body.data.errorMessage).toBeUndefined();
    expect(body.data.details).toBeUndefined();
    expect(body.data.recordsProcessed).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(body)).not.toContain("password=secret");
    // latestJob chỉ còn jobName, không lộ id nội bộ.
    expect(body.data.latestJob).toEqual({ jobName: "manual_refresh" });
  });

  it("job COMPLETED có errorMessage cũng không lộ trường nhạy cảm", async () => {
    statusState.rows = [
      logRow({
        status: "COMPLETED",
        completedAt: new Date(),
        duration: 30,
        errorMessage: "partial failure: internal host db-prod-1",
        details: { rows: 120 },
      }),
    ];

    const { body } = await readStatus();

    expect(body.data.status).toBe("COMPLETED");
    expect(body.data.isRefreshing).toBe(false);
    expect(Object.keys(body.data).sort()).toEqual(MINIMAL_KEYS);
    expect(JSON.stringify(body)).not.toContain("db-prod-1");
  });

  it("chưa có log nào → IDLE với đúng bộ trường tối thiểu", async () => {
    statusState.rows = [];

    const { status, body } = await readStatus();

    expect(status).toBe(200);
    expect(body.data).toEqual({
      isRefreshing: false,
      status: "IDLE",
      latestJob: null,
      startedAt: null,
      completedAt: null,
      duration: null,
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
