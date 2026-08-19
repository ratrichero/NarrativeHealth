/**
 * P5-10 — production wiring for the decision producer.
 *
 * Binds the producer to the frozen P5ArtifactRecorder so a future
 * production caller has a ready singleton:
 *
 *     P5 pipeline (P5-03 → P5-04 → P5-05 → P5-10)
 *             ↓
 *     pgDecisionProducer   (this module)
 *             ↓
 *     P5ArtifactRecorder (frozen, insert-only, idempotent)
 *             ↓
 *     PgHistoricalArtifactWriter (frozen)
 *             ↓
 *     PostgreSQL p5_* tables (migration 0021)
 *
 * Like `production.ts` in record/, this module imports `@/db` (requires
 * DATABASE_URL) and is therefore NOT imported by unit tests.
 */

import { P5DecisionProducer } from "./p5-decision-producer";
import { pgHistoricalArtifactRecorder } from "../record/production";
import type { P5Recorder } from "./p5-decision-producer";

/** Production producer bound to the real Postgres recorder. */
export const pgDecisionProducer = new P5DecisionProducer(
  pgHistoricalArtifactRecorder as P5Recorder,
);
