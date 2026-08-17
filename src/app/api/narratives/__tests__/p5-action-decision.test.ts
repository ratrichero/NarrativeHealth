import { describe, expect, it, jest } from "@jest/globals";
import { NextRequest } from "next/server";

// P5-06B route tests — the read endpoint must expose explicit availability
// semantics: absence / P4-unavailability / failure are never NO_ACTION and
// never crash into a 500 for a domain reason.

jest.mock("@/db", () => ({ db: {} }));

jest.mock("@/lib/p5/read/action-read.service", () => ({
  actionReadService: { getNarrativeActionReadView: jest.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { db } = require("@/db") as { db: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { actionReadService } = require("@/lib/p5/read/action-read.service") as {
  actionReadService: { getNarrativeActionReadView: jest.Mock<() => Promise<unknown>> };
};

import { GET } from "../[id]/action-decision/route";

function chainReturning<T>(result: T) {
  const chain: Record<string, unknown> = {
    then(resolve: (value: T) => unknown) {
      return Promise.resolve(result).then(resolve);
    },
  };
  const step = jest.fn(() => chain);
  chain.from = step;
  chain.where = step;
  chain.orderBy = step;
  chain.innerJoin = step;
  chain.limit = jest.fn(() => chain);
  return chain;
}

function mockDbWithNarrative() {
  const select = jest
    .fn()
    .mockReturnValueOnce(chainReturning([{ id: 1 }]));
  (db as { select: unknown }).select = select;
}

function makeView(overrides: Record<string, unknown> = {}) {
  return {
    decisionPresence: "ABSENT",
    decision: null,
    context: null,
    availability: "NO_DECISION_RECORD",
    displayState: "ABSENT",
    error: null,
    ...overrides,
  };
}

describe("GET /api/narratives/[id]/action-decision", () => {
  it("returns the read view for a known narrative (ABSENT / NO_DECISION_RECORD)", async () => {
    mockDbWithNarrative();
    const view = makeView();
    (actionReadService.getNarrativeActionReadView as jest.Mock<() => Promise<unknown>>).mockResolvedValue(view);

    const response = await GET(new NextRequest("http://localhost/api/narratives/1/action-decision"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.p5ActionDecision.decisionPresence).toBe("ABSENT");
    expect(body.data.p5ActionDecision.availability).toBe("NO_DECISION_RECORD");
    expect(body.data.p5ActionDecision.displayState).toBe("ABSENT");
    // Absence must never be presented as a NO_ACTION outcome.
    expect(body.data.p5ActionDecision.displayState).not.toBe("NO_ACTION");
  });

  it("preserves P4_CONTEXT_UNAVAILABLE — unavailability is not NO_ACTION and not a 500", async () => {
    mockDbWithNarrative();
    (actionReadService.getNarrativeActionReadView as jest.Mock<() => Promise<unknown>>).mockResolvedValue(
      makeView({
        availability: "P4_CONTEXT_UNAVAILABLE",
        displayState: "UNAVAILABLE",
      })
    );

    const response = await GET(new NextRequest("http://localhost/api/narratives/1/action-decision"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.p5ActionDecision.availability).toBe("P4_CONTEXT_UNAVAILABLE");
    expect(body.data.p5ActionDecision.displayState).toBe("UNAVAILABLE");
    expect(body.data.p5ActionDecision.displayState).not.toBe("NO_ACTION");
  });

  it("propagates SERVICE_ERROR as explicit availability, never NO_ACTION", async () => {
    mockDbWithNarrative();
    (actionReadService.getNarrativeActionReadView as jest.Mock<() => Promise<unknown>>).mockResolvedValue(
      makeView({
        availability: "SERVICE_ERROR",
        displayState: "UNAVAILABLE",
        error: { code: "SERVICE_ERROR", message: "boom" },
      })
    );

    const response = await GET(new NextRequest("http://localhost/api/narratives/1/action-decision"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.p5ActionDecision.availability).toBe("SERVICE_ERROR");
    expect(body.data.p5ActionDecision.error.code).toBe("SERVICE_ERROR");
  });

  it("rejects invalid narrative id with 400", async () => {
    const response = await GET(new NextRequest("http://localhost/api/narratives/abc/action-decision"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("returns 404 for an unknown narrative (subject miss, not NO_ACTION)", async () => {
    const select = jest.fn().mockReturnValueOnce(chainReturning([]));
    (db as { select: unknown }).select = select;

    const response = await GET(new NextRequest("http://localhost/api/narratives/999/action-decision"), {
      params: Promise.resolve({ id: "999" }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Narrative not found");
  });

  it("guards unexpected service failures with a 500 (infrastructure, not domain)", async () => {
    mockDbWithNarrative();
    (actionReadService.getNarrativeActionReadView as jest.Mock<() => Promise<unknown>>).mockRejectedValue(
      new Error("unexpected")
    );

    const response = await GET(new NextRequest("http://localhost/api/narratives/1/action-decision"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});
