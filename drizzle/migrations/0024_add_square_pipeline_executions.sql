-- Migration 0024: SQ-AN-02 — Square Pipeline Executions for Analytics
-- Persists per-cycle pipeline metrics for analytics queries

CREATE TABLE IF NOT EXISTS square_pipeline_executions (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  trigger_type VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
  -- trigger_type values: SCHEDULED, MANUAL, RETRY
  
  -- Pipeline counts
  evaluated INTEGER NOT NULL DEFAULT 0,
  qualified INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  deduplicated INTEGER NOT NULL DEFAULT 0,
  quota_blocked INTEGER NOT NULL DEFAULT 0,
  retry_pending INTEGER NOT NULL DEFAULT 0,
  content_generation_failed INTEGER NOT NULL DEFAULT 0,
  
  -- LLM usage
  llm_used_count INTEGER NOT NULL DEFAULT 0,
  template_fallback_count INTEGER NOT NULL DEFAULT 0,
  
  -- Duration
  duration_ms INTEGER,
  
  -- Quota snapshot at start
  quota_remaining_start INTEGER,
  quota_remaining_end INTEGER,
  quota_warning BOOLEAN DEFAULT FALSE,
  
  -- Error summary
  error_summary JSONB,  -- { errors: string[], error_count: number }
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_square_pipeline_executions_started 
  ON square_pipeline_executions(started_at);
CREATE INDEX IF NOT EXISTS idx_square_pipeline_executions_trigger 
  ON square_pipeline_executions(trigger_type);
