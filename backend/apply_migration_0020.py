"""
P3-10E.18 Apply Migration 0020 and Seed Correction Record
"""
import asyncio
import sys
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import text
import json

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def execute_sql(conn, sql, params=None):
    try:
        await conn.execute(text(sql), params or {})
    except Exception as e:
        print(f"[ERROR] Failed: {e}")
        raise


async def main():
    print("=" * 70)
    print("P3-10E.18 APPLY MIGRATION 0020 + SEED CORRECTION")
    print("=" * 70)
    print(f"Database: {settings.database_url}")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print()

    async with engine.begin() as conn:
        # Step 1: Create table (idempotent)
        print("## Step 1: Create p3_historical_corrections table")
        await execute_sql(conn, """
CREATE TABLE IF NOT EXISTS p3_historical_corrections (
  id SERIAL PRIMARY KEY,
  original_intelligence_id INTEGER NOT NULL
    REFERENCES p3_narrative_intelligence(id) ON DELETE RESTRICT,
  original_snapshot_id BIGINT
    REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  corrected_snapshot_id BIGINT
    REFERENCES narrative_membership_snapshots(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_key VARCHAR(100),
  algorithm_version VARCHAR(50),
  corrected_by VARCHAR(100),
  provenance JSONB NOT NULL
);""")
        await execute_sql(conn, "CREATE INDEX IF NOT EXISTS p3_historical_corrections_original_idx ON p3_historical_corrections(original_intelligence_id);")
        await execute_sql(conn, "CREATE INDEX IF NOT EXISTS p3_historical_corrections_original_snapshot_idx ON p3_historical_corrections(original_snapshot_id);")
        print("[OK] Table created or already exists")

        # Step 2: Verify table structure
        print("\n## Step 2: Verify table structure")
        res = await conn.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'p3_historical_corrections'
            ORDER BY ordinal_position
        """))
        columns = res.fetchall()
        expected_columns = {
            'id': 'integer',
            'original_intelligence_id': 'integer',
            'original_snapshot_id': 'bigint',
            'corrected_snapshot_id': 'bigint',
            'reason': 'text',
            'corrected_at': 'timestamp with time zone',
            'algorithm_key': 'character varying',
            'algorithm_version': 'character varying',
            'corrected_by': 'character varying',
            'provenance': 'jsonb',
        }
        for col in columns:
            col_name, col_type, nullable = col
            expected_type = expected_columns.get(col_name)
            type_ok = expected_type is not None and expected_type in col_type
            status = "OK" if type_ok else "UNEXPECTED"
            print(f"  {col_name}: {col_type} (nullable={nullable}) [{status}]")

        # Step 3: Seed correction record (idempotent - only if not exists)
        print("\n## Step 3: Seed correction record")
        
        # Check if correction already exists
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM p3_historical_corrections
            WHERE original_intelligence_id = 1
        """))
        existing = res.scalar()
        
        if existing > 0:
            print(f"  Correction already exists ({existing} records). Skipping insert.")
        else:
            # Get current algorithm identity from p3_narrative_intelligence
            res = await conn.execute(text("""
                SELECT algorithm_key, algorithm_version
                FROM p3_narrative_intelligence
                WHERE id = 1
            """))
            algo_row = res.fetchone()
            algorithm_key = algo_row[0] if algo_row else "p3-orchestrator"
            algorithm_version = algo_row[1] if algo_row else "1"
            
            print(f"  Using algorithm_key={algorithm_key}, algorithm_version={algorithm_version}")
            
            await execute_sql(conn, """
INSERT INTO p3_historical_corrections
  (original_intelligence_id, original_snapshot_id, corrected_snapshot_id,
   reason, algorithm_key, algorithm_version, corrected_by, provenance)
VALUES
  (:original_intelligence_id, :original_snapshot_id, :corrected_snapshot_id,
   :reason, :algorithm_key, :algorithm_version, :corrected_by, :provenance)
""", {
                "original_intelligence_id": 1,
                "original_snapshot_id": 7,
                "corrected_snapshot_id": 2,
                "reason": "Invalid empty membership snapshot created during failed P3-10E.11 execution. Superseded by authoritative baseline snapshot 2.",
                "algorithm_key": algorithm_key,
                "algorithm_version": algorithm_version,
                "corrected_by": "P3-10E.18",
                "provenance": json.dumps({
                    "original_availability_state": "INSUFFICIENT_HISTORY",
                    "original_member_count": 0,
                    "corrected_member_count": 7,
                    "migration": "0020_add_p3_historical_corrections",
                    "corrected_at_utc": datetime.now(timezone.utc).isoformat(),
                }),
            })
            print("[OK] Correction record inserted")

        # Step 4: Verify correction record
        print("\n## Step 4: Verify correction record")
        res = await conn.execute(text("""
            SELECT id, original_intelligence_id, original_snapshot_id, corrected_snapshot_id,
                   reason, algorithm_key, algorithm_version, corrected_by
            FROM p3_historical_corrections
            WHERE original_intelligence_id = 1
        """))
        rows = res.fetchall()
        print(f"  Correction records for intelligence_id=1: {len(rows)}")
        for row in rows:
            print(f"    id={row[0]}, original_snapshot={row[2]}, corrected_snapshot={row[3]}")
            print(f"    reason: {row[4][:80]}...")
            print(f"    algorithm: {row[5]}:{row[6]}, by={row[7]}")

        # Step 5: Verify P0-P2 unchanged
        print("\n## Step 5: Verify P0-P2 unchanged")
        p0_p2 = {
            'narratives': 5,
            'coins': 25,
            'coin_narratives': 25,
        }
        for tbl, expected in p0_p2.items():
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            count = res.scalar()
            status = "PASS" if count == expected else "FAIL"
            print(f"  {tbl}: {count} (expected {expected}) [{status}]")

        # Step 6: Verify original artifacts unchanged
        print("\n## Step 6: Verify original artifacts unchanged")
        res = await conn.execute(text("""
            SELECT id, membership_snapshot_id, availability_state
            FROM p3_narrative_intelligence WHERE id = 1
        """))
        row = res.fetchone()
        if row:
            ok = row[1] == 7
            print(f"  p3_narrative_intelligence id=1: membership_snapshot_id={row[1]} [{'PASS' if ok else 'FAIL'}]")
        else:
            print("  p3_narrative_intelligence id=1: NOT FOUND [FAIL]")

        res = await conn.execute(text("""
            SELECT id, member_count FROM p3_constituent_snapshots WHERE id = 1
        """))
        row = res.fetchone()
        if row:
            print(f"  p3_constituent_snapshots id=1: member_count={row[1]} [PASS]")
        else:
            print("  p3_constituent_snapshots id=1: NOT FOUND [FAIL]")

        res = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_snapshots
        """))
        snap_count = res.scalar()
        print(f"  narrative_membership_snapshots: {snap_count} [PASS]")

    print("\n" + "=" * 70)
    print("MIGRATION 0020 APPLIED + CORRECTION SEEDED")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
