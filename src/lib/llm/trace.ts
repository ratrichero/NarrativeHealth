// LLM-TRACE-01 — one trace per LLM turn, kept for 24h.
//
// Telemetry counts outcomes per hour, which answers "how many failed" but not
// "why did THIS answer take 12s and land on fallback2". A turn touches up to
// four tiers, retries, tool calls and a validation/repair loop; without a
// correlated record, diagnosing an incident means grepping unstructured logs.
//
// A trace stores metadata only — tier, model, status, latency, token count,
// failure kind and an optional payload fingerprint. Never prompts, answers or
// keys. The trace id is safe to show to a user ("mã tra cứu: …"): it maps to
// nothing but this metadata.
//
// Storage: bounded in-memory ring + `app_settings.llm.traces` (last 25, 24h).
// Writes happen once per finished turn, debounced, and never block the answer.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { LlmFailureKind } from "./errors";
import { llmPersistenceDisabled } from "./persistence";

export const LLM_TRACE_KEY = "llm.traces";
const MEMORY_LIMIT = 40;
const STORED_LIMIT = 25;
const RETENTION_HOURS = 24;
const FLUSH_DEBOUNCE_MS = 4_000;

export type LlmTraceFeature = "chat" | "square" | "movers" | "catalyst" | "canary";

export interface LlmTraceStep {
  /** Tier name (google | primary | fallback1 | fallback2). */
  tier: string;
  model?: string;
  /** HTTP status, or 0 for transport/timeout. */
  status: number;
  kind?: "timeout" | LlmFailureKind;
  ms: number;
  tokens?: number;
  /** Short machine label, e.g. "validation:too_long" or "grounding". */
  note?: string;
}

export interface LlmTraceRecord {
  id: string;
  at: string;
  feature: LlmTraceFeature;
  /** Chat session id (never a user id or IP). */
  sessionId?: string;
  /** Stable hash of the request payload; groups identical request-shape bugs. */
  fingerprint?: string;
  ok: boolean;
  provider?: string;
  totalMs: number;
  steps: LlmTraceStep[];
  error?: string;
}

interface TraceStore {
  version: 1;
  traces: LlmTraceRecord[];
}

const memory: LlmTraceRecord[] = [];
let pendingWrite: LlmTraceRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> | null = null;
let warned = false;

export function newTraceId(at = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `t${at.toString(36)}${rand}`;
}

export interface LlmTraceHandle {
  id: string;
  step: (step: LlmTraceStep) => void;
  finish: (outcome: {
    ok: boolean;
    provider?: string;
    error?: string;
    fingerprint?: string;
  }) => LlmTraceRecord;
}

/**
 * Start a turn trace. Steps are collected in memory and the finished record is
 * pushed to the ring buffer plus a debounced DB write.
 */
export function startLlmTrace(
  feature: LlmTraceFeature,
  options: { sessionId?: string; fingerprint?: string; at?: number } = {}
): LlmTraceHandle {
  const startedAt = options.at ?? Date.now();
  const id = newTraceId(startedAt);
  const steps: LlmTraceStep[] = [];
  let finished = false;

  return {
    id,
    step(step) {
      if (finished) return;
      steps.push({ ...step, ms: Math.max(0, Math.round(step.ms)) });
    },
    finish(outcome) {
      finished = true;
      const record: LlmTraceRecord = {
        id,
        at: new Date(startedAt).toISOString(),
        feature,
        sessionId: options.sessionId,
        fingerprint: outcome.fingerprint ?? options.fingerprint,
        ok: outcome.ok,
        provider: outcome.provider,
        totalMs: Math.max(0, Date.now() - startedAt),
        steps: [...steps],
        error: outcome.error?.slice(0, 200),
      };
      remember(record);
      return record;
    },
  };
}

function remember(record: LlmTraceRecord): void {
  memory.unshift(record);
  if (memory.length > MEMORY_LIMIT) memory.length = MEMORY_LIMIT;
  pendingWrite.push(record);
  if (pendingWrite.length > STORED_LIMIT) pendingWrite = pendingWrite.slice(-STORED_LIMIT);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (timer || llmPersistenceDisabled()) return;
  timer = setTimeout(() => {
    timer = null;
    void flushLlmTraces();
  }, FLUSH_DEBOUNCE_MS);
  timer.unref?.();
}

/** Persist pending traces (bounded, best effort, never throws). */
export async function flushLlmTraces(): Promise<void> {
  if (llmPersistenceDisabled() || pendingWrite.length === 0) return;
  if (writing) return writing;
  const batch = pendingWrite;
  pendingWrite = [];

  writing = (async () => {
    try {
      const [row] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.key, LLM_TRACE_KEY))
        .limit(1);
      const stored = row?.value as TraceStore | undefined;
      const cutoff = Date.now() - RETENTION_HOURS * 3600_000;
      const merged = [...batch, ...(stored?.version === 1 ? stored.traces : [])]
        .filter((trace) => new Date(trace.at).getTime() >= cutoff)
        .slice(0, STORED_LIMIT);
      await db
        .insert(appSettings)
        .values({ key: LLM_TRACE_KEY, value: { version: 1, traces: merged }, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: { version: 1, traces: merged }, updatedAt: new Date() },
        });
    } catch (error) {
      pendingWrite = [...batch, ...pendingWrite].slice(-STORED_LIMIT);
      if (!warned) {
        warned = true;
        console.warn("[LLM-TRACE] cannot persist traces:", (error as Error).message);
      }
    } finally {
      writing = null;
    }
  })();

  return writing;
}

/** Memory view (newest first); falls back to the persisted ring when empty. */
export async function recentLlmTraces(limit = 20): Promise<LlmTraceRecord[]> {
  if (memory.length > 0 || llmPersistenceDisabled()) return memory.slice(0, limit);
  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, LLM_TRACE_KEY))
      .limit(1);
    const stored = row?.value as TraceStore | undefined;
    return (stored?.version === 1 ? stored.traces : []).slice(0, limit);
  } catch {
    return [];
  }
}

export async function getLlmTrace(id: string): Promise<LlmTraceRecord | null> {
  const local = memory.find((trace) => trace.id === id);
  if (local) return local;
  return (await recentLlmTraces(MEMORY_LIMIT)).find((trace) => trace.id === id) ?? null;
}

/** Short suffix appended to a user-facing error message. */
export function traceRef(handle: LlmTraceHandle | undefined): string {
  return handle ? ` (mã tra cứu: ${handle.id})` : "";
}

/** Test-only. */
export function _resetLlmTraces(): void {
  memory.length = 0;
  pendingWrite = [];
  if (timer) clearTimeout(timer);
  timer = null;
  writing = null;
  warned = false;
}
