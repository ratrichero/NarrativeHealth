import type { NextRequest } from "next/server";

// `jose` là package ESM-only nên Jest (ts-jest/CJS) không parse được; mock lớp
// session là đủ cho logic phân quyền ở đây.
jest.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "nhd_session",
  verifySession: jest.fn(),
}));

import { verifySession } from "@/lib/auth/session";
import {
  authorizeSchedulerRequest,
  SCHEDULER_CATALYST_TOKEN_VAR,
  SCHEDULER_MOVERS_TOKEN_VAR,
  SCHEDULER_REFRESH_TOKEN_VAR,
  schedulerTokensMatch,
} from "../scheduler-token";

const verifySessionMock = verifySession as unknown as jest.Mock;

function requestWith(headers: Record<string, string>, cookie?: string): NextRequest {
  return {
    headers: new Headers(headers),
    cookies: {
      get: (name: string) => (cookie && name === "nhd_session" ? { value: cookie } : undefined),
    },
  } as unknown as NextRequest;
}

const ENV_KEYS = [
  SCHEDULER_REFRESH_TOKEN_VAR,
  SCHEDULER_MOVERS_TOKEN_VAR,
  SCHEDULER_CATALYST_TOKEN_VAR,
  "APP_ENV",
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  verifySessionMock.mockReset();
  verifySessionMock.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("schedulerTokensMatch", () => {
  it("khớp chính xác, false khi thiếu/khác/khác độ dài", () => {
    expect(schedulerTokensMatch("abc123", "abc123")).toBe(true);
    expect(schedulerTokensMatch("abc123", null)).toBe(false);
    expect(schedulerTokensMatch("abc123", "abc124")).toBe(false);
    expect(schedulerTokensMatch("abc123", "abc1234")).toBe(false);
    expect(schedulerTokensMatch("abc123", "")).toBe(false);
  });
});

describe("authorizeSchedulerRequest", () => {
  it("cho qua khi header token khớp", async () => {
    process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "secret-token";
    delete process.env.APP_ENV;

    const result = await authorizeSchedulerRequest(
      requestWith({ "x-scheduler-token": "secret-token" })
    );
    expect(result).toEqual({ ok: true, via: "token" });
  });

  it("401 khi production thiếu token hoặc token sai", async () => {
    process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "secret-token";
    process.env.APP_ENV = "production";

    const missing = await authorizeSchedulerRequest(requestWith({ "host": "example.com" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("X-Scheduler-Token");

    const wrong = await authorizeSchedulerRequest(
      requestWith({ "x-scheduler-token": "nope" })
    );
    expect(wrong.ok).toBe(false);
  });

  it("401 khi production chưa set token (fail-closed, không có ngoại lệ loopback)", async () => {
    delete process.env[SCHEDULER_REFRESH_TOKEN_VAR];
    process.env.APP_ENV = "production";

    const result = await authorizeSchedulerRequest(requestWith({ host: "localhost:3000" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(SCHEDULER_REFRESH_TOKEN_VAR);
  });

  it("admin session được qua (nút Refresh Data của admin)", async () => {
    delete process.env[SCHEDULER_REFRESH_TOKEN_VAR];
    process.env.APP_ENV = "production";
    verifySessionMock.mockResolvedValue({ sub: "admin" });

    const result = await authorizeSchedulerRequest(requestWith({}, "cookie-value"));
    expect(result).toEqual({ ok: true, via: "admin-session" });
  });

  it("phiên user thường không được qua dù APP_ENV=production (chỉ admin)", async () => {
    process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "secret-token";
    process.env.APP_ENV = "production";
    verifySessionMock.mockResolvedValue({ sub: "user" });

    const result = await authorizeSchedulerRequest(requestWith({}, "user-cookie"));
    expect(result.ok).toBe(false);
  });

  it("không dùng chéo token giữa các scheduler", async () => {
    process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "refresh-secret";
    process.env[SCHEDULER_CATALYST_TOKEN_VAR] = "catalyst-secret";
    process.env.APP_ENV = "production";

    const cross = await authorizeSchedulerRequest(
      requestWith({ "x-scheduler-token": "refresh-secret" }),
      SCHEDULER_CATALYST_TOKEN_VAR
    );
    expect(cross.ok).toBe(false);
  });

  it("development được qua để workflow máy dev không cần token", async () => {
    delete process.env[SCHEDULER_REFRESH_TOKEN_VAR];
    process.env.APP_ENV = "development";

    const result = await authorizeSchedulerRequest(requestWith({}));
    expect(result).toEqual({ ok: true, via: "development" });
  });

  it("dùng đúng biến token của endpoint movers", async () => {
    process.env[SCHEDULER_MOVERS_TOKEN_VAR] = "movers-secret";
    process.env.APP_ENV = "production";

    const result = await authorizeSchedulerRequest(
      requestWith({ "x-scheduler-token": "movers-secret" }),
      SCHEDULER_MOVERS_TOKEN_VAR
    );
    expect(result).toEqual({ ok: true, via: "token" });
  });
});
