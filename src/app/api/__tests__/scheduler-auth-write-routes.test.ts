import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { NextRequest } from "next/server";

// Các route ghi (refresh/coin, refresh/narrative, refresh/cleanup, catalyst/sync,
// radar bias-outcomes, radar cohort) trước đây chỉ dựa vào ENV-GUARD theo Host.
// Test này chốt lớp thứ hai: thiếu token/admin session → 401 và không chạm DB.

jest.mock("@/db", () => {
  const schema = jest.requireActual("@/db/schema") as object;
  return {
    db: {
      select: jest.fn(),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      execute: jest.fn(),
    },
    pool: {},
    ...schema,
  };
});

jest.mock("@/lib/env/route-guard", () => ({
  runtimeGuardResponse: jest.fn(() => null),
}));

jest.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "nhd_session",
  verifySession: jest.fn(async () => null),
}));

// Chỉ cần lớp xác thực: chặn các module nặng/DB-backed của từng route.
jest.mock("@/lib/catalyst/sync", () => ({
  parseCatalystSyncScope: jest.fn(() => "all"),
  syncCatalysts: jest.fn(),
}));

jest.mock("@/lib/settings/radar-config", () => ({
  readRadarRuntimeConfig: jest.fn(),
}));

jest.mock("@/lib/market/bias-log", () => ({
  recordBiasOutcomes: jest.fn(),
}));

jest.mock("@/lib/market/track-record", () => ({
  cohortIntervalMinutes: jest.fn((value: number) => value),
  recordAllRadarCohorts: jest.fn(),
}));

jest.mock("@/lib/market/alert-outbox", () => ({
  drainRadarAlertOutbox: jest.fn(),
}));

import { db } from "@/db";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import {
  SCHEDULER_CATALYST_TOKEN_VAR,
  SCHEDULER_REFRESH_TOKEN_VAR,
  SCHEDULER_TOKEN_HEADER,
} from "@/lib/env/scheduler-token";
import { POST as cleanupPOST } from "../refresh/cleanup/route";
import { POST as coinPOST } from "../refresh/coin/[id]/route";
import { POST as narrativePOST } from "../refresh/narrative/[id]/route";
import { POST as catalystSyncPOST } from "../catalyst/sync/route";
import { POST as biasOutcomesPOST } from "../market/radar/bias-outcomes/route";
import { POST as cohortPOST } from "../market/radar/cohort/route";
import { POST as outboxPOST } from "../market/radar/outbox/route";

const guardMock = runtimeGuardResponse as unknown as jest.Mock;
const dbMock = db as unknown as Record<string, jest.Mock>;

type RoutePost = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

const ROUTES: Array<{
  name: string;
  tokenVar: string;
  url: string;
  post: RoutePost;
}> = [
  {
    name: "POST /api/refresh/cleanup",
    tokenVar: SCHEDULER_REFRESH_TOKEN_VAR,
    url: "http://production.example.com/api/refresh/cleanup",
    post: (request) => cleanupPOST(request),
  },
  {
    name: "POST /api/refresh/coin/[id]",
    tokenVar: SCHEDULER_REFRESH_TOKEN_VAR,
    url: "http://production.example.com/api/refresh/coin/1",
    post: (request, context) => coinPOST(request, context),
  },
  {
    name: "POST /api/refresh/narrative/[id]",
    tokenVar: SCHEDULER_REFRESH_TOKEN_VAR,
    url: "http://production.example.com/api/refresh/narrative/1",
    post: (request, context) => narrativePOST(request, context),
  },
  {
    name: "POST /api/catalyst/sync",
    tokenVar: SCHEDULER_CATALYST_TOKEN_VAR,
    url: "http://production.example.com/api/catalyst/sync",
    post: (request) => catalystSyncPOST(request),
  },
  {
    name: "POST /api/market/radar/bias-outcomes",
    tokenVar: SCHEDULER_CATALYST_TOKEN_VAR,
    url: "http://production.example.com/api/market/radar/bias-outcomes",
    post: (request) => biasOutcomesPOST(request),
  },
  {
    name: "POST /api/market/radar/cohort",
    tokenVar: SCHEDULER_CATALYST_TOKEN_VAR,
    url: "http://production.example.com/api/market/radar/cohort",
    post: (request) => cohortPOST(request),
  },
  {
    name: "POST /api/market/radar/outbox",
    tokenVar: SCHEDULER_CATALYST_TOKEN_VAR,
    url: "http://production.example.com/api/market/radar/outbox",
    post: (request) => outboxPOST(request),
  },
];

const ENV_KEYS = [
  SCHEDULER_REFRESH_TOKEN_VAR,
  SCHEDULER_CATALYST_TOKEN_VAR,
  "APP_ENV",
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const context = { params: Promise.resolve({ id: "1" }) };

function requestFor(route: (typeof ROUTES)[number], headers: Record<string, string> = {}) {
  return new NextRequest(route.url, {
    method: "POST",
    headers: { host: "production.example.com", ...headers },
  });
}

function expectNoDbWrites() {
  for (const [name, fn] of Object.entries(dbMock)) {
    expect({ method: name, calls: fn.mock.calls }).toEqual({ method: name, calls: [] });
  }
}

beforeEach(() => {
  guardMock.mockClear();
  guardMock.mockReturnValue(null);
  for (const fn of Object.values(dbMock)) fn.mockClear();
  // ENV-GUARD đã mock cho qua — lớp token phải tự chặn.
  process.env.APP_ENV = "production";
  process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "refresh-secret";
  process.env[SCHEDULER_CATALYST_TOKEN_VAR] = "catalyst-secret";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe.each(ROUTES)("$name — SCHEDULER-AUTH", (route) => {
  it("401 khi thiếu token (Host hợp lệ không còn đủ) và không ghi DB", async () => {
    const response = await route.post(requestFor(route), context);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { success: boolean; code: string; error: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toContain("X-Scheduler-Token");
    expect(guardMock).toHaveBeenCalled();
    expectNoDbWrites();
  });

  it("401 khi token sai và không ghi DB", async () => {
    const response = await route.post(
      requestFor(route, { [SCHEDULER_TOKEN_HEADER]: "wrong-token" }),
      context
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe("UNAUTHORIZED");
    expectNoDbWrites();
  });

  it("401 khi dùng token của scheduler khác và không ghi DB", async () => {
    const otherToken =
      route.tokenVar === SCHEDULER_REFRESH_TOKEN_VAR ? "catalyst-secret" : "refresh-secret";

    const response = await route.post(
      requestFor(route, { [SCHEDULER_TOKEN_HEADER]: otherToken }),
      context
    );

    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe("UNAUTHORIZED");
    expectNoDbWrites();
  });

  it("401 fail-closed khi chưa set token, kể cả Host localhost, và không ghi DB", async () => {
    delete process.env[route.tokenVar];

    const response = await route.post(
      requestFor(route, { host: "localhost:3000" }),
      context
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toContain(route.tokenVar);
    expectNoDbWrites();
  });
});
