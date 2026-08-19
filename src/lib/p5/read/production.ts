/**
 * P5-06 — Production wiring for the Action Read Service.
 *
 * Wires the PgHistoricalArtifactStore (P5-08) into the ActionReadService
 * so the UI reads persisted P5 decision artifacts from PostgreSQL:
 *
 *     GET /api/narratives/[id]/action-decision
 *         ↓
 *     ActionReadService.getNarrativeActionReadView()
 *         ↓
 *     PgHistoricalArtifactStore.findDecisionByNarrativeId()
 *         ↓
 *     PostgreSQL p5_decision_records
 *
 * This module imports @/db (requires DATABASE_URL) and is therefore
 * NOT imported by unit tests — tests inject in-memory stores.
 */

import { pgHistoricalArtifactStore } from "../replay/production";
import { ActionReadService } from "./action-read.service";
import type { P5DecisionStore } from "./action-read.service";
import type { P5DecisionRecord } from "../types";

/**
 * P5-06 store adapter bridging PgHistoricalArtifactStore to the
 * ActionReadService's P5DecisionStore interface.
 *
 * findByDecisionId: direct lookup by decisionId (identity_key).
 * findBySubject: lookup by narrativeId using the indexed column.
 */
class PgP5DecisionStoreAdapter implements P5DecisionStore {
  async findByDecisionId(decisionId: string): Promise<P5DecisionRecord | null> {
    return pgHistoricalArtifactStore.findDecision(decisionId);
  }

  async findBySubject(subject: { narrativeId: number }): Promise<P5DecisionRecord | null> {
    return pgHistoricalArtifactStore.findDecisionByNarrativeId(subject.narrativeId);
  }
}

/**
 * Production ActionReadService bound to PostgreSQL.
 *
 * When a decision record exists for the narrative, it is read from
 * p5_decision_records. When no record exists, the view shows ABSENT
 * with live P4 context (if available).
 */
export const productionActionReadService = new ActionReadService({
  store: new PgP5DecisionStoreAdapter(),
});
