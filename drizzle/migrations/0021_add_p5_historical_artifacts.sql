-- P5-08: historical artifact persistence for P5-07 replay validation.
-- Additive only; does not alter any existing table.
--
-- Artifacts are stored verbatim as jsonb payloads; identity/version columns
-- enable exact reference resolution (P5-07 §5, RP-003). identity_key is the
-- canonical exact-identity key (unique) — the store resolves FOUND only on an
-- exact key, and version mismatch is detected against the identity columns.
-- Append-only: a DB trigger rejects UPDATE/DELETE on every P5 artifact table
-- (historical truth is never rewritten; corrections are new artifacts/events).

CREATE TABLE IF NOT EXISTS p5_decision_records (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(255) NOT NULL UNIQUE,
  decision_id VARCHAR(100) NOT NULL,
  narrative_id INTEGER NOT NULL,
  outcome VARCHAR(30) NOT NULL,
  suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  blocker_source VARCHAR(20),
  blocker_ref VARCHAR(255),
  action_type VARCHAR(40),
  decision_state VARCHAR(30) NOT NULL,
  approval_state VARCHAR(30) NOT NULL,
  execution_state VARCHAR(30) NOT NULL,
  permission_result VARCHAR(30) NOT NULL,
  record JSONB NOT NULL,
  decision_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS p5_decision_records_narrative_idx
  ON p5_decision_records(narrative_id);

CREATE TABLE IF NOT EXISTS p5_p4_snapshots (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(255) NOT NULL UNIQUE,
  narrative_id INTEGER NOT NULL,
  "window" VARCHAR(20) NOT NULL,
  algorithm_key VARCHAR(100) NOT NULL,
  algorithm_version VARCHAR(50) NOT NULL,
  calculation_mode VARCHAR(30) NOT NULL,
  semantic_version VARCHAR(50),
  as_of TIMESTAMPTZ,
  status VARCHAR(30),
  content_hash VARCHAR(128),
  snapshot JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS p5_p4_snapshots_narrative_window_idx
  ON p5_p4_snapshots(narrative_id, "window");

CREATE TABLE IF NOT EXISTS p5_policies (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(255) NOT NULL UNIQUE,
  policy_id VARCHAR(100) NOT NULL,
  policy_version VARCHAR(50) NOT NULL,
  effective_at TIMESTAMPTZ,
  evaluation_at TIMESTAMPTZ,
  policy JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS p5_policies_policy_id_idx
  ON p5_policies(policy_id);

CREATE TABLE IF NOT EXISTS p5_guardrails (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(255) NOT NULL UNIQUE,
  guardrail_id VARCHAR(100) NOT NULL,
  version VARCHAR(50),
  outcome VARCHAR(30),
  evaluated_at TIMESTAMPTZ,
  guardrail JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS p5_guardrails_guardrail_id_idx
  ON p5_guardrails(guardrail_id);

CREATE TABLE IF NOT EXISTS p5_approvals (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(255) NOT NULL UNIQUE,
  approval_id VARCHAR(100) NOT NULL,
  decision_id_ref VARCHAR(100),
  state VARCHAR(30),
  authority_ref VARCHAR(100),
  actor VARCHAR(100),
  approved_at TIMESTAMPTZ,
  approval_policy_version VARCHAR(50),
  approval JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS p5_approvals_decision_id_ref_idx
  ON p5_approvals(decision_id_ref);

CREATE TABLE IF NOT EXISTS p5_permissions (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(255) NOT NULL UNIQUE,
  ref VARCHAR(255) NOT NULL,
  result VARCHAR(30),
  evaluated_at TIMESTAMPTZ,
  permission JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS p5_permissions_ref_idx
  ON p5_permissions(ref);

CREATE TABLE IF NOT EXISTS p5_audit_events (
  id SERIAL PRIMARY KEY,
  identity_key VARCHAR(255) NOT NULL UNIQUE,
  event_id VARCHAR(100) NOT NULL,
  decision_id_ref VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_at TIMESTAMPTZ,
  actor VARCHAR(100),
  previous_state VARCHAR(30),
  new_state VARCHAR(30),
  reason TEXT,
  policy_version_ref VARCHAR(50),
  guardrail_ref VARCHAR(100),
  approval_ref VARCHAR(100),
  event JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS p5_audit_events_decision_id_ref_idx
  ON p5_audit_events(decision_id_ref);
CREATE INDEX IF NOT EXISTS p5_audit_events_type_idx
  ON p5_audit_events(event_type);

-- Immutability: historical artifacts are append-only. Corrections are new
-- artifacts/events, never in-place rewrites (P5-05 §17, P5-07 RP-012).
CREATE OR REPLACE FUNCTION prevent_p5_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'P5 historical artifacts are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER p5_decision_records_immutable
BEFORE UPDATE OR DELETE ON p5_decision_records
FOR EACH ROW EXECUTE FUNCTION prevent_p5_history_mutation();

CREATE TRIGGER p5_p4_snapshots_immutable
BEFORE UPDATE OR DELETE ON p5_p4_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_p5_history_mutation();

CREATE TRIGGER p5_policies_immutable
BEFORE UPDATE OR DELETE ON p5_policies
FOR EACH ROW EXECUTE FUNCTION prevent_p5_history_mutation();

CREATE TRIGGER p5_guardrails_immutable
BEFORE UPDATE OR DELETE ON p5_guardrails
FOR EACH ROW EXECUTE FUNCTION prevent_p5_history_mutation();

CREATE TRIGGER p5_approvals_immutable
BEFORE UPDATE OR DELETE ON p5_approvals
FOR EACH ROW EXECUTE FUNCTION prevent_p5_history_mutation();

CREATE TRIGGER p5_permissions_immutable
BEFORE UPDATE OR DELETE ON p5_permissions
FOR EACH ROW EXECUTE FUNCTION prevent_p5_history_mutation();

CREATE TRIGGER p5_audit_events_immutable
BEFORE UPDATE OR DELETE ON p5_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_p5_history_mutation();
