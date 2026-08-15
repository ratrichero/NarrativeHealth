/**
 * P3-15 — Historical Execution Loop & Scheduler
 *
 * Read-only scheduler/execution loop for P3 authoritative executions.
 *
 * DESIGN PRINCIPLES
 * - Reuses `runP3AuthoritativeExecution` as the ONLY execution path. This module
 *   contains zero calculation logic; it only decides WHEN to execute.
 * - Idempotency is enforced on the persisted artifact identity BEFORE execution:
 *   `(narrative_id, window_end, algorithm_key, algorithm_version, calculation_mode)`.
 *   If an artifact already exists for the identity, the window is SKIPPED and the
 *   orchestrator is never invoked (a second execution would otherwise re-persist
 *   via onConflictDoUpdate or hit the DB immutability trigger).
 * - Only the CURRENT completed window is eligible. Missed/intermediate windows are
 *   NOT backfilled — no artificial historical artifacts.
 * - One narrative failure never stops other narratives (per-narrative isolation).
 * - Non-VALID outcomes (INSUFFICIENT_HISTORY, MISSING, NOT_APPLICABLE, ...) are
 *   surfaced through the orchestrator throwing (persistence gate) and are logged
 *   as `failed` WITHOUT retry. The loop attempts each eligible window exactly once.
 * - `dryRun: true` performs read-only checks only: no orchestrator call, no
 *   scheduler log, no writes of any kind.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { narratives, p3NarrativeIntelligence } from "@/db/schema";
import type { P3Window } from "./availability";
import { runP3AuthoritativeExecution, type P3ExecutionConfig } from "./orchestrator";
import type { P3PersistenceOutcome } from "./persistence";
import { utcDayStart } from "./windows";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** scheduler_logs job name used by the P3 execution loop trigger. */
export const P3_EXECUTION_JOB_NAME = "p3_execution_loop";

/** Persisted orchestrator identity (matches runP3AuthoritativeExecution). */
export const P3_ORCHESTRATOR_ALGORITHM_KEY = "p3-orchestrator";
export const P3_ORCHESTRATOR_ALGORITHM_VERSION = "1";

/** P3-15 scope: fixed 7D observed windows. */
export const P3_DEFAULT_WINDOW: P3Window = "7D";
export const P3_DEFAULT_CALCULATION_MODE: "observed" | "projected" = "observed";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type P3ExecutionAction =
  /** Orchestrator ran and persisted a new artifact (VALID by persistence gate). */
  | "executed"
  /** Dry-run only: window is eligible but nothing was executed. */
  | "would_execute"
  /** Artifact already exists for this identity — skipped, orchestrator NOT called. */
  | "skipped_existing"
  /** Window not yet complete (windowEnd in the future) — not executed. */
  | "not_eligible"
  /** Orchestrator threw (incl. INSUFFICIENT_HISTORY / NOT_APPLICABLE / persistence). Logged, NOT retried. */
  | "failed";

export interface P3NarrativeExecutionOutcome {
  narrativeId: number;
  narrativeName?: string;
  window: P3Window;
  windowEnd: string; // ISO-8601
  identity: string;
  action: P3ExecutionAction;
  availabilityState?: string;
  intelligenceId?: number;
  inserted?: boolean;
  error?: string;
  durationMs?: number;
}

export interface P3ExecutionLoopResult {
  dryRun: boolean;
  window: P3Window;
  windowEnd: string; // ISO-8601
  calculationMode: string;
  now: string; // ISO-8601
  outcomes: P3NarrativeExecutionOutcome[];
  executed: number;
  wouldExecute: number;
  skipped: number;
  notEligible: number;
  failed: number;
}

export interface P3ExecutionIdentity {
  narrativeId: number;
  windowEnd: Date;
  algorithmKey: string;
  algorithmVersion: string;
  calculationMode: string;
}

export interface P3ExecutionLoopOptions {
  /** Restrict to specific narrative ids (default: all active narratives). */
  narratives?: number[];
  /** Window to schedule (default "7D"). */
  window?: P3Window;
  /** Explicit window end. Default: latest UTC day boundary at/before now. */
  windowEnd?: Date;
  /** Calculation mode (default "observed"). */
  calculationMode?: "observed" | "projected";
  /** Injectable clock for tests. */
  now?: Date;
  /** Read-only mode: no orchestrator calls, no writes. */
  dryRun?: boolean;
  /** Injectable narrative listing (default: active narratives from DB). */
  listNarratives?: () => Promise<{ id: number; name: string | null }[]>;
  /** Injectable artifact existence check (default: DB query on persisted identity). */
  checkArtifactExists?: (identity: P3ExecutionIdentity) => Promise<boolean>;
  /** Injectable executor (default: the authoritative orchestrator). */
  executor?: (config: P3ExecutionConfig) => Promise<{ persistence: P3PersistenceOutcome }>;
}

// ---------------------------------------------------------------------------
// Default dependencies (production wiring)
// ---------------------------------------------------------------------------

async function defaultListNarratives(): Promise<{ id: number; name: string | null }[]> {
  return db
    .select({ id: narratives.id, name: narratives.name })
    .from(narratives)
    .where(eq(narratives.isActive, true));
}

async function defaultCheckArtifactExists(identity: P3ExecutionIdentity): Promise<boolean> {
  const [row] = await db
    .select({ id: p3NarrativeIntelligence.id })
    .from(p3NarrativeIntelligence)
    .where(and(
      eq(p3NarrativeIntelligence.narrativeId, identity.narrativeId),
      eq(p3NarrativeIntelligence.windowEnd, identity.windowEnd),
      eq(p3NarrativeIntelligence.algorithmKey, identity.algorithmKey),
      eq(p3NarrativeIntelligence.algorithmVersion, identity.algorithmVersion),
      eq(p3NarrativeIntelligence.calculationMode, identity.calculationMode),
    ))
    .limit(1);
  return row != null;
}

export function buildP3ExecutionIdentity(
  narrativeId: number,
  windowEnd: Date,
  calculationMode: string
): P3ExecutionIdentity {
  return {
    narrativeId,
    windowEnd,
    algorithmKey: P3_ORCHESTRATOR_ALGORITHM_KEY,
    algorithmVersion: P3_ORCHESTRATOR_ALGORITHM_VERSION,
    calculationMode,
  };
}

// ---------------------------------------------------------------------------
// Execution loop
// ---------------------------------------------------------------------------

/**
 * Runs one scheduling pass over the target narratives for the current window.
 *
 * Per narrative: not_eligible → skipped_existing → (dry-run? would_execute : executed/failed).
 * Exactly one attempt per eligible window per narrative — no retry loops.
 */
export async function runP3ExecutionLoop(
  options: P3ExecutionLoopOptions = {}
): Promise<P3ExecutionLoopResult> {
  const now = options.now ?? new Date();
  const window: P3Window = options.window ?? P3_DEFAULT_WINDOW;
  const calculationMode = options.calculationMode ?? P3_DEFAULT_CALCULATION_MODE;
  const dryRun = options.dryRun ?? false;
  const listNarratives = options.listNarratives ?? defaultListNarratives;
  const checkArtifactExists = options.checkArtifactExists ?? defaultCheckArtifactExists;
  const executor = options.executor ?? runP3AuthoritativeExecution;

  // Candidate window end: explicit, or the latest completed UTC day boundary.
  const windowEnd = options.windowEnd ?? utcDayStart(now);

  const allNarratives = await listNarratives();
  const targetNarratives =
    options.narratives && options.narratives.length > 0
      ? allNarratives.filter((n) => options.narratives!.includes(n.id))
      : allNarratives;

  const outcomes: P3NarrativeExecutionOutcome[] = [];

  for (const narrative of targetNarratives) {
    const startMs = Date.now();
    const identity = buildP3ExecutionIdentity(narrative.id, windowEnd, calculationMode);
    const identityString = [
      identity.narrativeId,
      identity.windowEnd.toISOString(),
      identity.algorithmKey,
      identity.algorithmVersion,
      identity.calculationMode,
    ].join("|");

    const base: Omit<P3NarrativeExecutionOutcome, "action"> = {
      narrativeId: narrative.id,
      narrativeName: narrative.name ?? undefined,
      window,
      windowEnd: identity.windowEnd.toISOString(),
      identity: identityString,
    };

    try {
      // A window is only eligible once it has completed (windowEnd <= now).
      if (identity.windowEnd.getTime() > now.getTime()) {
        outcomes.push({ ...base, action: "not_eligible" });
        continue;
      }

      // Idempotency gate: never re-execute a persisted identity.
      const exists = await checkArtifactExists(identity);
      if (exists) {
        outcomes.push({ ...base, action: "skipped_existing" });
        continue;
      }

      if (dryRun) {
        outcomes.push({ ...base, action: "would_execute", durationMs: Date.now() - startMs });
        continue;
      }

      // Single authoritative attempt. Non-VALID outcomes surface as thrown errors
      // from the orchestrator (persistence gate) and are logged as failed.
      const result = await executor({
        narrativeId: narrative.id,
        window,
        windowEnd: identity.windowEnd,
        calculationMode,
      });

      outcomes.push({
        ...base,
        action: "executed",
        availabilityState: "VALID",
        intelligenceId: result.persistence.intelligenceId,
        inserted: result.persistence.inserted,
        durationMs: Date.now() - startMs,
      });
    } catch (error) {
      outcomes.push({
        ...base,
        action: "failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startMs,
      });
    }
  }

  return {
    dryRun,
    window,
    windowEnd: windowEnd.toISOString(),
    calculationMode,
    now: now.toISOString(),
    outcomes,
    executed: outcomes.filter((o) => o.action === "executed").length,
    wouldExecute: outcomes.filter((o) => o.action === "would_execute").length,
    skipped: outcomes.filter((o) => o.action === "skipped_existing").length,
    notEligible: outcomes.filter((o) => o.action === "not_eligible").length,
    failed: outcomes.filter((o) => o.action === "failed").length,
  };
}
