/**
 * P5-09 — production wiring for the artifact recorder.
 *
 * Binds the insert-only writer (P5-08) to the recorder so a future P5
 * producer (P5-03/04/05 engine implementation) has a ready singleton:
 *
 *     P5 producer (runtime P5DecisionRecord)
 *             ↓
 *     pgHistoricalArtifactRecorder   (this module)
 *             ↓
 *     PgHistoricalArtifactWriter (frozen, insert-only, idempotent)
 *             ↓
 *     PostgreSQL p5_* tables (migration 0021)
 *
 * Like `production.ts` in replay/, this module imports `@/db` (requires
 * DATABASE_URL) and is therefore NOT imported by unit tests.
 */

import { P5ArtifactRecorder } from "./p5-artifact-recorder";
import { pgHistoricalArtifactWriter } from "../replay/production";

/** Production recorder bound to the real Postgres writer. */
export const pgHistoricalArtifactRecorder = new P5ArtifactRecorder(pgHistoricalArtifactWriter);
