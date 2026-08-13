"""
P3-10E.8 Apply Migration 0019 and Verify
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text
from datetime import datetime

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def execute_sql(conn, sql):
    try:
        await conn.execute(text(sql))
    except Exception as e:
        print(f"[ERROR] Failed: {e}")
        raise


async def main():
    print("=" * 60)
    print("P3-10E.8 APPLY MIGRATION 0019")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    print()

    async with engine.begin() as conn:
        print("## Executing Migration 0019...")
        try:
            # Tables + indexes
            await execute_sql(conn, """
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
);""")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS narrative_membership_events_narrative_effective_idx ON narrative_membership_events(narrative_id, effective_at, id);")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS narrative_membership_events_narrative_coin_effective_idx ON narrative_membership_events(narrative_id, coin_id, effective_at, id);")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS narrative_membership_events_coin_effective_idx ON narrative_membership_events(coin_id, effective_at);")

            await execute_sql(conn, """
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
);""")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS narrative_membership_coverage_narrative_start_idx ON narrative_membership_coverage(narrative_id, history_coverage_start);")

            await execute_sql(conn, """
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
);""")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS narrative_membership_snapshots_narrative_window_idx ON narrative_membership_snapshots(narrative_id, window_end);")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS narrative_membership_snapshots_window_idx ON narrative_membership_snapshots(window_end);")

            await execute_sql(conn, """
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
);""")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS narrative_membership_snapshot_members_coin_snapshot_idx ON narrative_membership_snapshot_members(coin_id, snapshot_id);")

            # Functions and triggers
            await execute_sql(conn, """
CREATE OR REPLACE FUNCTION prevent_membership_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'P3 historical membership records are immutable';
END;
$$ LANGUAGE plpgsql;""")

            await execute_sql(conn, "DROP TRIGGER IF EXISTS narrative_membership_events_immutable ON narrative_membership_events;")
            await execute_sql(conn, "CREATE TRIGGER narrative_membership_events_immutable BEFORE UPDATE OR DELETE ON narrative_membership_events FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();")
            await execute_sql(conn, "DROP TRIGGER IF EXISTS narrative_membership_coverage_immutable ON narrative_membership_coverage;")
            await execute_sql(conn, "CREATE TRIGGER narrative_membership_coverage_immutable BEFORE UPDATE OR DELETE ON narrative_membership_coverage FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();")
            await execute_sql(conn, "DROP TRIGGER IF EXISTS narrative_membership_snapshots_immutable ON narrative_membership_snapshots;")
            await execute_sql(conn, "CREATE TRIGGER narrative_membership_snapshots_immutable BEFORE UPDATE OR DELETE ON narrative_membership_snapshots FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();")
            await execute_sql(conn, "DROP TRIGGER IF EXISTS narrative_membership_snapshot_members_immutable ON narrative_membership_snapshot_members;")
            await execute_sql(conn, "CREATE TRIGGER narrative_membership_snapshot_members_immutable BEFORE UPDATE OR DELETE ON narrative_membership_snapshot_members FOR EACH ROW EXECUTE FUNCTION prevent_membership_history_mutation();")

            await execute_sql(conn, """
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
$$ LANGUAGE plpgsql;""")
            await execute_sql(conn, "DROP TRIGGER IF EXISTS coin_narratives_membership_history_capture ON coin_narratives;")
            await execute_sql(conn, "CREATE TRIGGER coin_narratives_membership_history_capture AFTER INSERT OR UPDATE OR DELETE ON coin_narratives FOR EACH ROW EXECUTE FUNCTION capture_coin_narrative_membership();")

            # P3 intelligence column + FK + index
            await execute_sql(conn, "ALTER TABLE p3_narrative_intelligence ADD COLUMN IF NOT EXISTS membership_snapshot_id BIGINT;")
            await execute_sql(conn, """
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'p3_narrative_intelligence_membership_snapshot_fk') THEN
    ALTER TABLE p3_narrative_intelligence
      ADD CONSTRAINT p3_narrative_intelligence_membership_snapshot_fk
      FOREIGN KEY (membership_snapshot_id) REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT;
  END IF;
END $$;""")
            await execute_sql(conn, "CREATE INDEX IF NOT EXISTS p3_narrative_intelligence_membership_snapshot_idx ON p3_narrative_intelligence(membership_snapshot_id);")

            print("[OK] Migration executed successfully")
        except Exception as e:
            print(f"[ERROR] Migration failed: {e}")
            raise

        # Verification
        print("\n## Verification")

        print("\n### 1. Tables")
        result = await conn.execute(text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%membership%' ORDER BY table_name"))
        tables = [r[0] for r in result.fetchall()]
        expected_tables = ['narrative_membership_events', 'narrative_membership_coverage', 'narrative_membership_snapshots', 'narrative_membership_snapshot_members']
        for t in expected_tables:
            status = "[OK]" if t in tables else "[MISSING]"
            print(f"  {status} {t}")

        print("\n### 2. Indexes")
        result = await conn.execute(text("SELECT indexname FROM pg_indexes WHERE indexname LIKE '%membership%' ORDER BY indexname"))
        indexes = [r[0] for r in result.fetchall()]
        expected_indexes = [
            'narrative_membership_events_narrative_effective_idx',
            'narrative_membership_events_narrative_coin_effective_idx',
            'narrative_membership_events_coin_effective_idx',
            'narrative_membership_coverage_narrative_start_idx',
            'narrative_membership_snapshots_narrative_window_idx',
            'narrative_membership_snapshots_window_idx',
            'narrative_membership_snapshot_members_coin_snapshot_idx',
            'p3_narrative_intelligence_membership_snapshot_idx'
        ]
        for idx in expected_indexes:
            status = "[OK]" if idx in indexes else "[MISSING]"
            print(f"  {status} {idx}")

        print("\n### 3. Triggers")
        result = await conn.execute(text("SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE '%membership%' AND tgisinternal = false"))
        triggers = result.fetchall()
        expected_triggers = {
            'narrative_membership_events_immutable': 'narrative_membership_events',
            'narrative_membership_coverage_immutable': 'narrative_membership_coverage',
            'narrative_membership_snapshots_immutable': 'narrative_membership_snapshots',
            'narrative_membership_snapshot_members_immutable': 'narrative_membership_snapshot_members',
            'coin_narratives_membership_history_capture': 'coin_narratives'
        }
        trigger_map = {t[0]: str(t[1]) for t in triggers}
        for name, table in expected_triggers.items():
            if name in trigger_map and trigger_map[name] == table:
                print(f"  [OK] {name} on {table}")
            else:
                print(f"  [MISSING] {name} on {table}")

        print("\n### 4. p3_narrative_intelligence.membership_snapshot_id")
        result = await conn.execute(text("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'p3_narrative_intelligence' AND column_name = 'membership_snapshot_id'"))
        col = result.fetchone()
        if col:
            print(f"  [OK] Column exists: {col[0]}, type={col[1]}, nullable={col[2]}")
        else:
            print(f"  [MISSING] Column")

        print("\n### 5. P0-P2 Integrity")
        for tbl in ['narratives', 'coins', 'coin_narratives', 'narrative_health']:
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            count = res.scalar()
            print(f"  {tbl}: {count}")

        print("\n### 6. Historical Coverage")
        result = await conn.execute(text("SELECT n.id, n.name, COUNT(e.id) as event_count FROM narratives n LEFT JOIN narrative_membership_events e ON n.id = e.narrative_id GROUP BY n.id, n.name ORDER BY n.id"))
        for row in result.fetchall():
            print(f"  Narrative {row[0]} ({row[1]}): {row[2]} events")

    print("\n" + "=" * 60)
    print("[SUCCESS] MIGRATION 0019 APPLIED")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())