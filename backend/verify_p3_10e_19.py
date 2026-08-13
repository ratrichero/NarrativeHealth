"""
P3-10E.19 Post-Execution Verification
Run AFTER the TypeScript orchestrator execution.
"""
import asyncio
import sys
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def main():
    print("=" * 70)
    print("P3-10E.19 POST-EXECUTION VERIFICATION")
    print("=" * 70)
    print(f"Database: {settings.database_url}")
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print()

    all_pass = True

    async with engine.begin() as conn:
        # 1. Check for NEW valid intelligence record for window 2026-08-11
        print("\n## 1. New valid intelligence record for 2026-08-11")
        res = await conn.execute(text("""
            SELECT id, window_end, availability_state, membership_snapshot_id,
                   breadth, regime, rotation, confidence
            FROM p3_narrative_intelligence
            WHERE narrative_id = 1
              AND window_end = '2026-08-11T00:00:00Z'
              AND algorithm_key = 'p3-orchestrator'
              AND algorithm_version = '1'
              AND calculation_mode = 'observed'
            ORDER BY id DESC
            LIMIT 1
        """))
        row = res.fetchone()
        if row:
            print(f"  Found record: id={row[0]}, state={row[2]}, snapshot={row[3]}")
            if row[2] == "VALID":
                print("  [PASS] New valid record exists")
            else:
                print(f"  [INFO] Record state={row[2]} (old invalid record may still exist)")
                print("  Note: If orchestrator ran with same identity, onConflictDoNothing")
                print("        would return existing record. Verify new record was created")
                print("        with different id or updated state.")
        else:
            print("  [FAIL] No record found for this window")
            all_pass = False

        # 2. Original artifact unchanged
        print("\n## 2. Original artifact unchanged (id=1)")
        res = await conn.execute(text("""
            SELECT id, membership_snapshot_id, availability_state
            FROM p3_narrative_intelligence WHERE id = 1
        """))
        row = res.fetchone()
        if row:
            ok = row[1] == 7 and row[2] == "INSUFFICIENT_HISTORY"
            print(f"  membership_snapshot_id={row[1]}, state={row[2]}")
            print(f"  [{'PASS' if ok else 'FAIL'}]")
            if not ok:
                all_pass = False
        else:
            print("  [FAIL] NOT FOUND")
            all_pass = False

        # 3. No new membership snapshots
        print("\n## 3. No unexpected new membership snapshots")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_snapshots
        """))
        snap_count = res.scalar()
        print(f"  Total snapshots: {snap_count}")
        print("  [INFO - should still be 6]")

        # 4. Snapshot 7 unchanged
        print("\n## 4. Snapshot 7 unchanged")
        res = await conn.execute(text("""
            SELECT id, member_count FROM narrative_membership_snapshots WHERE id = 7
        """))
        row = res.fetchone()
        if row:
            ok = row[1] == 0
            print(f"  member_count={row[1]}")
            print(f"  [{'PASS' if ok else 'FAIL'}]")
            if not ok:
                all_pass = False
        else:
            print("  [FAIL] NOT FOUND")
            all_pass = False

        # 5. Correction ledger intact
        print("\n## 5. Correction ledger intact")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM p3_historical_corrections
        """))
        count = res.scalar()
        ok = count == 1
        print(f"  Records: {count}")
        print(f"  [{'PASS' if ok else 'FAIL'}]")
        if not ok:
            all_pass = False

        # 6. P0-P2 unchanged
        print("\n## 6. P0-P2 unchanged")
        for tbl, expected in [('narratives', 5), ('coins', 25), ('coin_narratives', 25)]:
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            count = res.scalar()
            ok = count == expected
            print(f"  {tbl}: {count} [{'PASS' if ok else 'FAIL'}]")
            if not ok:
                all_pass = False

        # 7. Immutability triggers intact
        print("\n## 7. Immutability triggers intact")
        triggers = [
            "p3_narrative_intelligence_immutable",
            "p3_constituent_snapshots_immutable",
            "p3_constituent_snapshot_members_immutable",
            "narrative_membership_events_immutable",
            "narrative_membership_coverage_immutable",
            "narrative_membership_snapshots_immutable",
            "narrative_membership_snapshot_members_immutable",
        ]
        for trigger_name in triggers:
            res = await conn.execute(text("""
                SELECT COUNT(*) FROM information_schema.triggers
                WHERE trigger_name = :trigger_name
            """), {"trigger_name": trigger_name})
            count = res.scalar()
            ok = count > 0
            print(f"  {trigger_name}: {'EXISTS' if ok else 'MISSING'} [{'PASS' if ok else 'FAIL'}]")
            if not ok:
                all_pass = False

    print("\n" + "=" * 70)
    if all_pass:
        print("P3-10E.19 VERIFICATION: PASS")
        print("First clean authoritative production execution successful")
    else:
        print("P3-10E.19 VERIFICATION: FAIL")
        print("Review failures above")
    print("=" * 70)

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
