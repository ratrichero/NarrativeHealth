import { describe, expect, it, jest } from "@jest/globals";
import {
  P3_DEFAULT_CALCULATION_MODE,
  P3_DEFAULT_WINDOW,
  P3_ORCHESTRATOR_ALGORITHM_KEY,
  P3_ORCHESTRATOR_ALGORITHM_VERSION,
  runP3ExecutionLoop,
  type P3NarrativeExecutionOutcome,
} from "@/lib/p3/execution-loop";
import { P3InsufficientDataError } from "@/lib/p3/orchestrator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ExecutorResult {
  persistence: { intelligenceId: number; identity: string; inserted: boolean };
}

function validExecutorResult(id: number): ExecutorResult {
  return { persistence: { intelligenceId: id, identity: `1|2026-08-11T00:00:00.000Z|p3-orchestrator|1|observed`, inserted: true } };
}

interface Harness {
  listNarratives: jest.Mock<() => Promise<{ id: number; name: string | null }[]>>;
  checkArtifactExists: jest.Mock<(identity: {
    narrativeId: number;
    windowEnd: Date;
    algorithmKey: string;
    algorithmVersion: string;
    calculationMode: string;
  }) => Promise<boolean>>;
  executor: jest.Mock<(config: {
    narrativeId: number;
    window: string;
    windowEnd: Date;
    calculationMode: string;
  }) => Promise<ExecutorResult>>;
}

function makeHarness(): Harness {
  return {
    listNarratives: jest.fn(async () => [
      { id: 1, name: "AI" },
      { id: 2, name: "RWA" },
    ]),
    checkArtifactExists: jest.fn(async () => false),
    executor: jest.fn(async () => validExecutorResult(10)),
  };
}

function outcomeByNarrative(outcomes: P3NarrativeExecutionOutcome[], narrativeId: number) {
  const found = outcomes.find((o) => o.narrativeId === narrativeId);
  if (!found) throw new Error(`No outcome for narrative ${narrativeId}`);
  return found;
}

const WINDOW_END_AUG_11 = new Date("2026-08-11T00:00:00.000Z");
const WINDOW_END_AUG_12 = new Date("2026-08-12T00:00:00.000Z");
const NOW_AUG_11 = new Date("2026-08-11T12:00:00.000Z");
const NOW_AUG_12 = new Date("2026-08-12T12:00:00.000Z");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runP3ExecutionLoop", () => {
  it("first execution: no artifact exists → orchestrator runs once per narrative and persists", async () => {
    const h = makeHarness();
    const result = await runP3ExecutionLoop({
      now: NOW_AUG_11,
      windowEnd: WINDOW_END_AUG_11,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.executed).toBe(2);
    expect(h.executor).toHaveBeenCalledTimes(2);

    const ai = outcomeByNarrative(result.outcomes, 1);
    expect(ai.action).toBe("executed");
    expect(ai.availabilityState).toBe("VALID");
    expect(ai.intelligenceId).toBe(10);
    expect(ai.identity).toBe(
      `1|2026-08-11T00:00:00.000Z|${P3_ORCHESTRATOR_ALGORITHM_KEY}|${P3_ORCHESTRATOR_ALGORITHM_VERSION}|${P3_DEFAULT_CALCULATION_MODE}`
    );
    expect(h.executor).toHaveBeenCalledWith({
      narrativeId: 1,
      window: P3_DEFAULT_WINDOW,
      windowEnd: WINDOW_END_AUG_11,
      calculationMode: P3_DEFAULT_CALCULATION_MODE,
    });
  });

  it("second window: a new window_end becomes eligible and is executed", async () => {
    const h = makeHarness();
    // Artifact exists for Aug 11, but not for Aug 12.
    h.checkArtifactExists.mockImplementation(async ({ windowEnd }) =>
      windowEnd.getTime() === WINDOW_END_AUG_11.getTime()
    );

    const result = await runP3ExecutionLoop({
      now: NOW_AUG_12,
      windowEnd: WINDOW_END_AUG_12,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.executed).toBe(2);
    expect(outcomeByNarrative(result.outcomes, 1).windowEnd).toBe("2026-08-12T00:00:00.000Z");
    expect(h.executor).toHaveBeenCalledWith(expect.objectContaining({ windowEnd: WINDOW_END_AUG_12 }));
  });

  it("duplicate execution: same identity persisted → skipped, orchestrator NEVER called", async () => {
    const h = makeHarness();
    h.checkArtifactExists.mockImplementation(async () => true);

    const result = await runP3ExecutionLoop({
      now: NOW_AUG_11,
      windowEnd: WINDOW_END_AUG_11,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.skipped).toBe(2);
    expect(result.executed).toBe(0);
    expect(h.executor).not.toHaveBeenCalled();
    expect(outcomeByNarrative(result.outcomes, 1).action).toBe("skipped_existing");
  });

  it("failed narrative isolation: one narrative failing does not stop the others", async () => {
    const h = makeHarness();
    h.executor.mockImplementation(async (config) => {
      if (config.narrativeId === 1) {
        throw new Error("boom: upstream data source unavailable");
      }
      return validExecutorResult(20);
    });

    const result = await runP3ExecutionLoop({
      now: NOW_AUG_11,
      windowEnd: WINDOW_END_AUG_11,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.failed).toBe(1);
    expect(result.executed).toBe(1);
    expect(h.executor).toHaveBeenCalledTimes(2); // both narratives attempted

    const failed = outcomeByNarrative(result.outcomes, 1);
    expect(failed.action).toBe("failed");
    expect(failed.error).toContain("boom");

    const ok = outcomeByNarrative(result.outcomes, 2);
    expect(ok.action).toBe("executed");
  });

  it("non-VALID result (INSUFFICIENT_HISTORY): logged as failed, exactly ONE attempt, no retry", async () => {
    const h = makeHarness();
    h.executor.mockImplementation(async (config) => {
      if (config.narrativeId === 1) {
        throw new P3InsufficientDataError(
          "P3 calculation cannot be persisted: mandatory stages not VALID: P3-04 Breadth=INSUFFICIENT_HISTORY"
        );
      }
      return validExecutorResult(30);
    });

    const result = await runP3ExecutionLoop({
      now: NOW_AUG_11,
      windowEnd: WINDOW_END_AUG_11,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.failed).toBe(1);
    // Each eligible narrative was attempted exactly once — no retry loop.
    expect(h.executor).toHaveBeenCalledTimes(2);

    const insufficient = outcomeByNarrative(result.outcomes, 1);
    expect(insufficient.action).toBe("failed");
    expect(insufficient.error).toContain("INSUFFICIENT_HISTORY");
    expect(insufficient.intelligenceId).toBeUndefined();
  });

  it("scheduler restart / idempotency: running the loop twice persists once, then skips", async () => {
    const h = makeHarness();
    const options = {
      now: NOW_AUG_11,
      windowEnd: WINDOW_END_AUG_11,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    };

    // Pass 1: nothing exists → executes both.
    const first = await runP3ExecutionLoop(options);
    expect(first.executed).toBe(2);

    // Pass 2 (e.g. after scheduler restart): both identities now exist → skip all.
    h.checkArtifactExists.mockImplementation(async () => true);
    const second = await runP3ExecutionLoop(options);

    expect(second.skipped).toBe(2);
    expect(second.executed).toBe(0);
    expect(h.executor).toHaveBeenCalledTimes(2); // no new orchestrator calls
  });

  it("no eligible window: windowEnd in the future → not_eligible for every narrative", async () => {
    const h = makeHarness();
    const futureEnd = new Date("2026-08-13T00:00:00.000Z");

    const result = await runP3ExecutionLoop({
      now: NOW_AUG_11,
      windowEnd: futureEnd,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.notEligible).toBe(2);
    expect(result.executed).toBe(0);
    expect(h.executor).not.toHaveBeenCalled();
    expect(h.checkArtifactExists).not.toHaveBeenCalled(); // eligibility short-circuits before the existence check
    expect(outcomeByNarrative(result.outcomes, 1).action).toBe("not_eligible");
  });

  it("dry-run: reports would_execute, never calls the orchestrator", async () => {
    const h = makeHarness();
    const result = await runP3ExecutionLoop({
      now: NOW_AUG_11,
      windowEnd: WINDOW_END_AUG_11,
      dryRun: true,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.dryRun).toBe(true);
    expect(result.wouldExecute).toBe(2);
    expect(result.executed).toBe(0);
    expect(h.executor).not.toHaveBeenCalled();
  });

  it("defaults windowEnd to the latest UTC day boundary at/before now", async () => {
    const h = makeHarness();
    const result = await runP3ExecutionLoop({
      now: NOW_AUG_11,
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    });

    expect(result.windowEnd).toBe("2026-08-11T00:00:00.000Z");
    expect(h.executor).toHaveBeenCalledWith(
      expect.objectContaining({ windowEnd: WINDOW_END_AUG_11 })
    );
  });

  it("P3-16: scheduler produces artifact #2 for the second eligible window, artifact #1 never re-executed, re-run is idempotent", async () => {
    const h = makeHarness();
    const persistedWindowEnds = new Set<string>();
    h.checkArtifactExists.mockImplementation(async ({ windowEnd }) =>
      persistedWindowEnds.has(windowEnd.toISOString())
    );
    h.executor.mockImplementation(async (config) => {
      persistedWindowEnds.add(config.windowEnd.toISOString());
      return validExecutorResult(42);
    });

    const aug13 = new Date("2026-08-13T00:00:00.000Z");
    const base = {
      narratives: [1],
      listNarratives: h.listNarratives,
      checkArtifactExists: h.checkArtifactExists,
      executor: h.executor,
    };

    // Pass 1: first eligible window → artifact #1.
    const p1 = await runP3ExecutionLoop({ ...base, now: NOW_AUG_11, windowEnd: WINDOW_END_AUG_11 });
    expect(p1.executed).toBe(1);
    expect(persistedWindowEnds.has("2026-08-11T00:00:00.000Z")).toBe(true);

    // Pass 2: second eligible window (window_end = 2026-08-13) → artifact #2;
    // artifact #1's window is skipped, never re-executed.
    const p2 = await runP3ExecutionLoop({ ...base, now: new Date("2026-08-13T12:00:00.000Z"), windowEnd: aug13 });
    expect(p2.executed).toBe(1);
    expect(p2.skipped).toBe(0);
    expect(persistedWindowEnds.has("2026-08-13T00:00:00.000Z")).toBe(true);
    expect(h.executor).toHaveBeenCalledTimes(2); // only the two unique windows

    // Pass 3: re-running artifact #2's window → idempotent skip, no mutation.
    const p3 = await runP3ExecutionLoop({ ...base, now: new Date("2026-08-13T13:00:00.000Z"), windowEnd: aug13 });
    expect(p3.skipped).toBe(1);
    expect(p3.executed).toBe(0);
    expect(h.executor).toHaveBeenCalledTimes(2); // no new orchestrator calls
  });
});
