/**
 * P6-07D — Presentation Read Service (Simplified)
 *
 * Thin DTO transformation from P6 artifacts to presentation shape.
 * Implements PD-07A-02 (Read API), PD-07B-01 (Read DTOs).
 *
 * PV-01: Consumes only P6-native artifacts.
 * PV-02: Does not recalculate health/regime/warning.
 * PV-03: Read-only — no mutation.
 * PV-04: Deterministic output for same inputs.
 * PV-19: DTOs are thin transformations, not engines.
 */

import { readCurrentSnapshot } from "../snapshot/persistence";
import { readCurrentRegime } from "../regime/persistence";
import { readActiveWarnings } from "../warning/persistence";
import { readCurrentSummary } from "../aggregation/persistence";
import type {
  CoinIntelligenceDTO,
  ExplanationItemDTO,
  IntelligenceSummaryDTO,
  NarrativeIntelligenceDTO,
  QualityMetadataDTO,
  WarningDTO,
} from "./types";

// ─── TRANSFORM HELPERS ──────────────────────────────────────────

function toWarningDTO(w: {
  id: number;
  warning_type: string;
  severity: string;
  lifecycle: string;
  detection_window: Date;
  entity_type: string;
  entity_id: number;
}): WarningDTO {
  return {
    warning_id: w.id,
    warning_type: w.warning_type,
    severity: w.severity,
    lifecycle: w.lifecycle,
    detection_window: w.detection_window.toISOString(),
    entity_type: w.entity_type,
    entity_id: w.entity_id,
  };
}

function toExplanationItemDTO(item: {
  category: string;
  text: string;
  evidence_ref: string;
  severity: string | null;
}): ExplanationItemDTO {
  return {
    category: item.category,
    text: item.text,
    evidence_ref: item.evidence_ref,
    severity: item.severity,
  };
}

function toQualityDTO(quality: string | null, freshness: string | null): QualityMetadataDTO {
  return {
    quality_state: quality ?? "UNKNOWN",
    freshness_state: freshness ?? "UNKNOWN",
  };
}

// ─── MAIN READ FUNCTIONS ────────────────────────────────────────

/**
 * Read current coin intelligence as presentation DTO.
 * PV-06: Returns only CURRENT lifecycle artifacts.
 * PV-07: Returns null when no P6 artifact exists.
 */
export async function readCoinIntelligence(
  coinId: number,
  coinSymbol: string
): Promise<CoinIntelligenceDTO | null> {
  const [snapshot, regime, warnings, summary] = await Promise.all([
    readCurrentSnapshot("coin", coinId, "COIN_HEALTH"),
    readCurrentRegime("coin", coinId),
    readActiveWarnings("coin", coinId),
    readCurrentSummary("coin", coinId),
  ]);

  // PV-07: If no data at all, return null
  if (!snapshot && !regime && warnings.length === 0 && !summary) {
    return null;
  }

  return {
    entity_type: "coin",
    entity_id: coinId,
    coin_symbol: coinSymbol,
    health_score: snapshot?.healthScore ?? null,
    confidence: snapshot?.confidenceScore ?? null,
    regime: regime?.regimeState ?? null,
    regime_confidence: regime?.confidence ?? null,
    regime_calculation_time: regime?.calculationTime?.toISOString() ?? null,
    warnings: warnings.map(toWarningDTO),
    summary: summary ? toSummaryDTO(summary) : null,
    quality: toQualityDTO(null, null),
    window_end: snapshot?.windowEnd?.toISOString() ?? null,
    version: null,
  };
}

/**
 * Read current narrative intelligence as presentation DTO.
 * PV-06: Returns only CURRENT lifecycle artifacts.
 * PV-07: Returns null when no P6 artifact exists.
 */
export async function readNarrativeIntelligence(
  narrativeId: number,
  narrativeName: string
): Promise<NarrativeIntelligenceDTO | null> {
  const [snapshot, regime, warnings, summary] = await Promise.all([
    readCurrentSnapshot("narrative", narrativeId, "NARRATIVE_HEALTH"),
    readCurrentRegime("narrative", narrativeId),
    readActiveWarnings("narrative", narrativeId),
    readCurrentSummary("narrative", narrativeId),
  ]);

  // PV-07: If no data at all, return null
  if (!snapshot && !regime && warnings.length === 0 && !summary) {
    return null;
  }

  return {
    entity_type: "narrative",
    entity_id: narrativeId,
    narrative_name: narrativeName,
    health_score: snapshot?.healthScore ?? null,
    confidence: snapshot?.confidenceScore ?? null,
    regime: regime?.regimeState ?? null,
    regime_confidence: regime?.confidence ?? null,
    regime_calculation_time: regime?.calculationTime?.toISOString() ?? null,
    warnings: warnings.map(toWarningDTO),
    summary: summary ? toSummaryDTO(summary) : null,
    quality: toQualityDTO(null, null),
    window_end: snapshot?.windowEnd?.toISOString() ?? null,
    version: null,
  };
}

/**
 * Read current warnings for an entity.
 * PV-06: Returns only active (CURRENT) warnings.
 */
export async function readEntityWarnings(
  entityType: "coin" | "narrative",
  entityId: number
): Promise<readonly WarningDTO[]> {
  const warnings = await readActiveWarnings(entityType, entityId);
  return warnings.map(toWarningDTO);
}

// ─── INTERNAL HELPERS ───────────────────────────────────────────

function toSummaryDTO(summary: {
  health_delta: number | null;
  health_change_pct: number | null;
  regime_changed: boolean;
  what_changed: Array<{ category: string; text: string; evidence_ref: string; severity: string | null }>;
  why: Array<{ category: string; text: string; evidence_ref: string; severity: string | null }>;
  what_to_watch: Array<{ category: string; text: string; evidence_ref: string; severity: string | null }>;
}): IntelligenceSummaryDTO {
  return {
    what_changed: summary.what_changed.map(toExplanationItemDTO),
    why: summary.why.map(toExplanationItemDTO),
    what_to_watch: summary.what_to_watch.map(toExplanationItemDTO),
    health_delta: summary.health_delta,
    health_change_pct: summary.health_change_pct,
    regime_changed: summary.regime_changed,
    new_warnings: [],
    resolved_warnings: [],
  };
}
