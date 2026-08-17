import { describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

jest.mock("@/lib/p5/read/action-read.service", () => ({
  actionReadService: { getDecisionByDecisionId: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { actionReadService } = require("@/lib/p5/read/action-read.service") as {
  actionReadService: { getDecisionByDecisionId: jest.Mock<() => Promise<unknown>> };
};

import { GET } from "../[decisionId]/route";

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    decisionPresence: "PRESENT",
    decision: {
      decisionId: "dec-1",
      outcome: "SELECTED",
      actionType: "MONITOR",
      decisionState: "DECIDED",
      approvalState: "NOT_REQUIRED",
      executionState: "NOT_APPLICABLE",
      permissionResult: "NOT_GRANTED",
    },
    context: null,
    availability: "OK",
    displayState: "SELECTED",
    error: null,
    ...overrides,
  };
}

describe("GET /api/actions/[decisionId]", () => {
  it("returns a found decision with availability OK", async () => {
    const view = makeView();
    (actionReadService.getDecisionByDecisionId as jest.Mock<() => Promise<unknown>>).mockResolvedValue(view);

    const response = await GET(new NextRequest("http://localhost/api/actions/dec-1"), {
      params: Promise.resolve({ decisionId: "dec-1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.p5ActionDecision.decision.decisionId).toBe("dec-1");
    expect(body.data.p5ActionDecision.availability).toBe("OK");
  });

  it("404 for an unknown decisionId carries DECISION_NOT_FOUND — never NO_ACTION", async () => {
    (actionReadService.getDecisionByDecisionId as jest.Mock<() => Promise<unknown>>).mockResolvedValue(
      makeView({ decisionPresence: "ABSENT", decision: null, availability: "DECISION_NOT_FOUND", displayState: "ABSENT" })
    );

    const response = await GET(new NextRequest("http://localhost/api/actions/nope"), {
      params: Promise.resolve({ decisionId: "nope" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.availability).toBe("DECISION_NOT_FOUND");
    expect(body.error).toBe("Decision not found");
    // A lookup miss is an availability fact — the body never claims NO_ACTION.
    expect(JSON.stringify(body)).not.toContain("NO_ACTION");
  });

  it("rejects empty decisionId with 400", async () => {
    const response = await GET(new NextRequest("http://localhost/api/actions/"), {
      params: Promise.resolve({ decisionId: " " }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("guards unexpected service failures with a 500", async () => {
    (actionReadService.getDecisionByDecisionId as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
      new Error("unexpected")
    );
    const response = await GET(new NextRequest("http://localhost/api/actions/dec-1"), {
      params: Promise.resolve({ decisionId: "dec-1" }),
    });
    expect(response.status).toBe(500);
  });
});
