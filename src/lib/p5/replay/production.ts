/**
 * P5-08 — production wiring for the historical artifact store.
 *
 * Wires the repository's real drizzle client (`db` from `@/db`) into the
 * P5-07 replay boundary:
 *
 *     PostgreSQL (p5_* tables) → DrizzleP5RowStore → PgHistoricalArtifactStore
 *         → ArtifactResolver → ReplayEngine
 *
 * This module deliberately imports `@/db` (which requires DATABASE_URL) and is
 * therefore NOT imported by unit tests — tests inject an in-memory row store.
 *
 * Replay consumers that want persisted historical artifacts must use
 * `pgHistoricalArtifactResolver` (or construct a ReplayEngine with it). The
 * frozen `historicalArtifactResolver` singleton in artifact-resolver.ts stays
 * on the absence adapter as the safe fallback for environments without
 * persistence.
 */

import { db } from "@/db";
import { ArtifactResolver } from "./artifact-resolver";
import {
  DrizzleP5RowStore,
  PgHistoricalArtifactStore,
  PgHistoricalArtifactWriter,
} from "./pg-artifact-store";

const rowStore = new DrizzleP5RowStore(db);

/** Read-only store over persisted P5 artifacts (P5-07 replay boundary). */
export const pgHistoricalArtifactStore = new PgHistoricalArtifactStore(rowStore);

/** Insert-only writer for P5 producers (P5-03/04/05 engine implementation). */
export const pgHistoricalArtifactWriter = new PgHistoricalArtifactWriter(rowStore);

/** Replay resolver bound to the persisted artifact store. */
export const pgHistoricalArtifactResolver = new ArtifactResolver(pgHistoricalArtifactStore);
