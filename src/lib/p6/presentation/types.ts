/**
 * P6-07D — Presentation DTO Types
 *
 * Thin transformation layer between P6 artifacts and HTTP/UI.
 * Implements PD-07B-01 (Read DTOs), PD-07B-02 (symmetric coin/narrative).
 *
 * PV-19: DTOs are thin transformations, not intelligence engines.
 * PV-02: No recalculation of health/regime/warning semantics.
 */

import type { Severity } from "../warning/types";

// ─── SHARED DTOs ────────────────────────────────────────────────

export interface P6ApiResponse<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error?: string;
  readonly meta?: {
    readonly entity_type: string;
    readonly entity_id: number;
    readonly window_end?: string;
    readonly version?: Record<string, string>;
  };
}

export interface WarningDTO {
  readonly warning_id: number;
  readonly warning_type: string;
  readonly severity: string;
  readonly lifecycle: string;
  readonly detection_window: string;
  readonly entity_type: string;
  readonly entity_id: number;
}

export interface ExplanationItemDTO {
  readonly category: string;
  readonly text: string;
  readonly evidence_ref: string;
  readonly severity: string | null;
}

export interface IntelligenceSummaryDTO {
  readonly what_changed: ReadonlyArray<ExplanationItemDTO>;
  readonly why: ReadonlyArray<ExplanationItemDTO>;
  readonly what_to_watch: ReadonlyArray<ExplanationItemDTO>;
  readonly health_delta: number | null;
  readonly health_change_pct: number | null;
  readonly regime_changed: boolean;
  readonly new_warnings: ReadonlyArray<WarningDTO>;
  readonly resolved_warnings: ReadonlyArray<WarningDTO>;
}

export interface QualityMetadataDTO {
  readonly quality_state: string;
  readonly freshness_state: string;
}

// ─── ENTITY DTOs ────────────────────────────────────────────────

export interface CoinIntelligenceDTO {
  readonly entity_type: "coin";
  readonly entity_id: number;
  readonly coin_symbol: string;
  readonly health_score: number | null;
  readonly confidence: number | null;
  readonly regime: string | null;
  readonly regime_confidence: number | null;
  readonly regime_calculation_time: string | null;
  readonly warnings: ReadonlyArray<WarningDTO>;
  readonly summary: IntelligenceSummaryDTO | null;
  readonly quality: QualityMetadataDTO;
  readonly window_end: string | null;
  readonly version: Record<string, string> | null;
}

export interface NarrativeIntelligenceDTO {
  readonly entity_type: "narrative";
  readonly entity_id: number;
  readonly narrative_name: string;
  readonly health_score: number | null;
  readonly confidence: number | null;
  readonly regime: string | null;
  readonly regime_confidence: number | null;
  readonly regime_calculation_time: string | null;
  readonly warnings: ReadonlyArray<WarningDTO>;
  readonly summary: IntelligenceSummaryDTO | null;
  readonly quality: QualityMetadataDTO;
  readonly window_end: string | null;
  readonly version: Record<string, string> | null;
}

export type EntityIntelligenceDTO = CoinIntelligenceDTO | NarrativeIntelligenceDTO;
