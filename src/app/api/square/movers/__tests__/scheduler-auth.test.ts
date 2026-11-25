import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { NextRequest } from "next/server";

jest.mock("@/lib/env/route-guard", () => ({
  runtimeGuardResponse: jest.fn(() => null),
}));

jest.mock("@/lib/square/movers/trigger", () => ({
  triggerMoversPipeline: jest.fn(async () => new Response("pipeline-ran", { status: 200 })),
}));

jest.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "nhd_session",
  verifySession: jest.fn(async () => null),
}));

import { POST } from "../route";
import { runtimeGuardResponse } from "@/lib/env/route-guard";
import { triggerMoversPipeline } from "@/lib/square/movers/trigger";
import {
  SCHEDULER_MOVERS_TOKEN_VAR,
  SCHEDULER_TOKEN_HEADER,
} from "@/lib/env/scheduler-token";

const guardMock = runtimeGuardResponse as unknown as jest.Mock;
const triggerMock = triggerMoversPipeline as unknown as jest.Mock;

const ENV_KEYS = [SCHEDULER_MOVERS_TOKEN_VAR, "APP_ENV"] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function moversRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://production.example.com/api/square/movers", {
    method: "POST",
    headers: { host: "production.example.com", ...headers },
  });
}

beforeEach(() => {
  guardMock.mockReturnValue(null);
  triggerMock.mockClear();
  process.env.APP_ENV = "production";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("POST /api/square/movers — SCHEDULER-AUTH", () => {
  it("401 và không chạy pipeline khi thiếu token", async () => {
    process.env[SCHEDULER_MOVERS_TOKEN_VAR] = "movers-secret";

    const response = await POST(moversRequest());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toContain("X-Scheduler-Token");
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("401 khi chưa set SCHEDULER_MOVERS_TOKEN (fail-closed)", async () => {
    delete process.env[SCHEDULER_MOVERS_TOKEN_VAR];

    const response = await POST(moversRequest({ host: "localhost:3000" }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toContain(SCHEDULER_MOVERS_TOKEN_VAR);
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("token đúng thì qua lớp auth và chạy pipeline", async () => {
    process.env[SCHEDULER_MOVERS_TOKEN_VAR] = "movers-secret";

    const response = await POST(
      moversRequest({ [SCHEDULER_TOKEN_HEADER]: "movers-secret" })
    );

    expect(triggerMock).toHaveBeenCalledWith({ dryRun: false, trigger: "SCHEDULED" });
    expect(response.status).toBe(200);
  });
});
