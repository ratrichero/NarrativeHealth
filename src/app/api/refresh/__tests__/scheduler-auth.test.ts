import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { NextRequest } from "next/server";

// Route thật kéo theo db + collector; chỉ cần lớp xác thực ở đây.
jest.mock("@/db", () => {
  const schema = jest.requireActual("@/db/schema");
  return { db: {}, pool: {}, ...(schema as object) };
});

jest.mock("@/lib/env/route-guard", () => ({
  runtimeGuardResponse: jest.fn(() => null),
}));

jest.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "nhd_session",
  verifySession: jest.fn(async () => null),
}));

import { POST } from "../route";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import {
  SCHEDULER_REFRESH_TOKEN_VAR,
  SCHEDULER_TOKEN_HEADER,
} from "@/lib/env/scheduler-token";

const guardMock = runtimeGuardResponse as unknown as jest.Mock;

const ENV_KEYS = [SCHEDULER_REFRESH_TOKEN_VAR, "APP_ENV"] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function refreshRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://production.example.com/api/refresh", {
    method: "POST",
    headers: { host: "production.example.com", ...headers },
  });
}

beforeEach(() => {
  guardMock.mockReturnValue(null);
  // ENV-GUARD là lớp hai (đã mock cho qua); lớp token phải tự chặn.
  process.env.APP_ENV = "production";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("POST /api/refresh — SCHEDULER-AUTH", () => {
  it("401 khi production thiếu token (Host hợp lệ không còn đủ)", async () => {
    process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "refresh-secret";

    const response = await POST(refreshRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toContain("X-Scheduler-Token");
    expect(guardMock).toHaveBeenCalled();
  });

  it("401 khi chưa set SCHEDULER_REFRESH_TOKEN (fail-closed, không loopback exception)", async () => {
    delete process.env[SCHEDULER_REFRESH_TOKEN_VAR];

    const response = await POST(
      refreshRequest({ host: "localhost:3000" })
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toContain(SCHEDULER_REFRESH_TOKEN_VAR);
  });

  it("401 khi token sai", async () => {
    process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "refresh-secret";

    const response = await POST(
      refreshRequest({ [SCHEDULER_TOKEN_HEADER]: "wrong-token" })
    );

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("UNAUTHORIZED");
  });

  it("ENV-GUARD vẫn chặn trước lớp token khi runtime không được phép", async () => {
    process.env[SCHEDULER_REFRESH_TOKEN_VAR] = "refresh-secret";
    guardMock.mockReturnValue(
      new Response(JSON.stringify({ code: "ENV_NOT_PRODUCTION" }), { status: 403 })
    );

    const response = await POST(refreshRequest());

    expect(response.status).toBe(403);
    // Guard chặn thì token không được kiểm tra nữa — hai lớp độc lập.
  });
});
