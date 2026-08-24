// P6 Data Quality V1 — Persistence Types
// Bridges D2 validator output to DB representation per D1 frozen schema.

import type { QualityEvidence, QualityState, Metric, Timeframe } from "../quality/types";

// ─── DB RECORD TYPES ──────────────────────────────────────────────────

/** Row type for p6_observation_quality (select) */
export interface ObservationQualityRecord {
  id: number;
  entityId: number;
  metric: string;
  source: string;
  observedAt: Date | null;
  timeframe: string;
  qualityStatus: string;
  observationStatus: string;
  qualityConfigVersion: string;
  evidence: QualityEvidence[];
  qualityEvaluatedAt: Date;
  collectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Insert payload for p6_observation_quality */
export interface ObservationQualityInsert {
  entityId: number;
  metric: string;
  source: string;
  observedAt: Date | null;
  timeframe: string;
  qualityStatus: QualityState;
  observationStatus: QualityState;
  qualityConfigVersion: string;
  evidence: QualityEvidence[];
  qualityEvaluatedAt: Date;
  collectedAt?: Date | null;
}

/** Row type for p6_quality_rule_config (select) */
export interface QualityRuleConfigRecord {
  id: number;
  qualityConfigVersion: string;
  checkId: string;
  metric: string | null;
  checkType: string;
  parameters: Record<string, unknown>;
  isEnabled: boolean;
  createdAt: Date;
}

// ─── SEMANTIC IDENTITY ────────────────────────────────────────────────

/** The 5-column P6-01B semantic identity */
export interface ObservationIdentity {
  entityId: number;
  metric: string;
  source: string;
  observedAt: Date | null;
  timeframe: string;
}

/** Identity lookup key — same as ObservationIdentity but used for queries */
export type QualityLookupKey = ObservationIdentity;
