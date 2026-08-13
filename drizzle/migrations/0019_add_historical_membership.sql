-- P3-10E.7: append-only historical membership ledger and authoritative snapshots.
-- This migration is additive. It does not alter current membership or P0-P2 tables.

CREATE TABLE IF NOT EXISTS narrative_membership_events (
  id BIGSERIAL PRIMARY KEY,
  narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE RESTRICT,
  coin_id INTEGER NOT NULL REFERENCES coins(id) ON DELETE RESTRICT,
  event_type VARCHAR(30) NOT NULL,
  is_primary BOOLEAN,
  effective_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(50) NOT NULL,
  source_ref VARCHAR(200),
  actor VARCHAR(100),
  idempotency_key VARCHAR(200) NOT NULL UNIQUE,
  provenance JSONB NOT NULL,
  CONSTRAINT narrative_membership_events_type_check
    CHECK (event_type IN ('ADDED', 'REMOVED', 'PRIMARY_SET')),
  CONSTRAINT narrative_membership_events_primary_check
    CHECK (event_type = 'REMOVED' OR is_primary IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS narrative_membership_events_narrative_effective_idx
  ON narrative_membership_events(narrative_id, effective_at, id);
CREATE INDEX IF NOT EXISTS narrative_membership_events_narrative_coin_effective_idx
  ON narrative_membership_events(narrative_id, coin_id, effective_at, id);
CREATE INDEX IF NOT EXISTS narrative_membership_events_coin_effective_idx
  ON narrative_membership_events(coin_id, effective_at);

-- Coverage is append-only. The earliest verified row is the beginning of a
-- trustworthy history interval for that narrative.
CREATE TABLE IF NOT EXISTS narrative_membership_coverage (
  id BIGSERIAL PRIMARY KEY,
  narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE RESTRICT,
  history_coverage_start TIMESTAMPTZ NOT NULL,
  source VARCHAR(50) NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by VARCHAR(100),
  provenance JSONB NOT NULL,
  CONSTRAINT narrative_membership_coverage_unique
    UNIQUE (narrative_id, history_coverage_start)
);

CREATE INDEX IF NOT EXISTS narrative_membership_coverage_narrative_start_idx
  ON narrative_membership_coverage(narrative_id, history_coverage_start);

CREATE TABLE IF NOT EXISTS narrative_membership_snapshots (
  id BIGSERIAL PRIMARY KEY,
  narrative_id INTEGER NOT NULL REFERENCES narratives(id) ON DELETE RESTRICT,
  window_end TIMESTAMPTZ NOT NULL,
  snapshot_revision INTEGER NOT NULL DEFAULT 1,
  membership_mode VARCHAR(30) NOT NULL,
  membership_source VARCHAR(50) NOT NULL,
  ledger_cutoff_event_id BIGINT REFERENCES narrative_membership_events(id) ON DELETE RESTRICT,
  member_count INTEGER NOT NULL,
  member_digest VARCHAR(128) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provenance JSONB NOT NULL,
  CONSTRAINT narrative_membership_snapshots_identity_unique
    UNIQUE (narrative_id, window_end, snapshot_revision, membership_mode),
  CONSTRAINT narrative_membership_snapshots_revision_check
    CHECK (snapshot_revision > 0),
  CONSTRAINT narrative_membership_snapshots_count_check
    CHECK (member_count >= 0)
);

CREATE INDEX IF NOT EXISTS narrative_membership_snapshots_narrative_window_idx
  ON narrative_membership_snapshots(narrative_id, window_end);
CREATE INDEX IF NOT EXISTS narrative_membership_snapshots_window_idx
  ON narrative_membership_snapshots(window_end);

CREATE TABLE IF NOT EXISTS narrative_membership_snapshot_members (
  snapshot_id BIGINT NOT NULL REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  coin_id INTEGER NOT NULL REFERENCES coins(id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL,
  membership_state VARCHAR(30) NOT NULL DEFAULT 'MEMBER',
  source_event_id BIGINT REFERENCES narrative_membership_events(id) ON DELETE RESTRICT,
  provenance JSONB,
  CONSTRAINT narrative_membership_snapshot_members_pk PRIMARY KEY (snapshot_id, coin_id),
  CONSTRAINT narrative_membership_snapshot_members_state_check
    CHECK (membership_state = 'MEMBER')
);

CREATE INDEX IF NOT EXISTS narrative_membership_snapshot_members_coin_snapshot_idx
  ON narrative_membership_snapshot_members(coin_id, snapshot_id);

CREATE OR REPLACE FUNCTION prevent_membership_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'P3 historical membership records are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS narrative_membership_events_immutable ON narrative_membership_events;
CREATE TRIGGER narrative_membership_events_immutable
BEFORE UPDATE OR DELETE ON narrative_membership_events
FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();

DROP TRIGGER IF EXISTS narrative_membership_coverage_immutable ON narrative_membership_coverage;
CREATE TRIGGER narrative_membership_coverage_immutable
BEFORE UPDATE OR DELETE ON narrative_membership_coverage
FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();

DROP TRIGGER IF EXISTS narrative_membership_snapshots_immutable ON narrative_membership_snapshots;
CREATE TRIGGER narrative_membership_snapshots_immutable
BEFORE UPDATE OR DELETE ON narrative_membership_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();

DROP TRIGGER IF EXISTS narrative_membership_snapshot_members_immutable ON narrative_membership_snapshot_members;
CREATE TRIGGER narrative_membership_snapshot_members_immutable
BEFORE UPDATE OR DELETE ON narrative_membership_snapshot_members
FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();

-- Capture all direct changes to the current membership projection. A future
-- application writer may provide a business-effective timestamp through the
-- approved database procedure; direct writes use transaction time.
CREATE OR REPLACE FUNCTION capture_coin_narrative_membership()
RETURNS TRIGGER AS $$
DECLARE
  event_key TEXT;
BEGIN
  event_key := md5(
    txid_current()::TEXT || ':' || TG_OP || ':' ||
    COALESCE(NEW.coin_id, OLD.coin_id)::TEXT || ':' ||
    COALESCE(NEW.narrative_id, OLD.narrative_id)::TEXT || ':' ||
    clock_timestamp()::TEXT || ':' || random()::TEXT
  );

  IF TG_OP = 'INSERT' THEN
    INSERT INTO narrative_membership_events
      (narrative_id, coin_id, event_type, is_primary, effective_at, source, idempotency_key, provenance)
    VALUES
      (NEW.narrative_id, NEW.coin_id, 'ADDED', NEW.is_primary, transaction_timestamp(), 'coin_narratives_trigger', event_key,
       jsonb_build_object('trigger_operation', TG_OP));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO narrative_membership_events
      (narrative_id, coin_id, event_type, is_primary, effective_at, source, idempotency_key, provenance)
    VALUES
      (OLD.narrative_id, OLD.coin_id, 'REMOVED', OLD.is_primary, transaction_timestamp(), 'coin_narratives_trigger', event_key,
       jsonb_build_object('trigger_operation', TG_OP));
    RETURN OLD;
  ELSE
    IF NEW.is_primary IS DISTINCT FROM OLD.is_primary THEN
      INSERT INTO narrative_membership_events
        (narrative_id, coin_id, event_type, is_primary, effective_at, source, idempotency_key, provenance)
      VALUES
        (NEW.narrative_id, NEW.coin_id, 'PRIMARY_SET', NEW.is_primary, transaction_timestamp(), 'coin_narratives_trigger', event_key,
         jsonb_build_object('trigger_operation', TG_OP));
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coin_narratives_membership_history_capture ON coin_narratives;
CREATE TRIGGER coin_narratives_membership_history_capture
AFTER INSERT OR UPDATE OR DELETE ON coin_narratives
FOR EACH ROW EXECUTE FUNCTION capture_coin_narrative_membership();

ALTER TABLE p3_narrative_intelligence
  ADD COLUMN IF NOT EXISTS membership_snapshot_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'p3_narrative_intelligence_membership_snapshot_fk'
  ) THEN
    ALTER TABLE p3_narrative_intelligence
      ADD CONSTRAINT p3_narrative_intelligence_membership_snapshot_fk
      FOREIGN KEY (membership_snapshot_id)
      REFERENCES narrative_membership_snapshots(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS p3_narrative_intelligence_membership_snapshot_idx
  ON p3_narrative_intelligence(membership_snapshot_id);
