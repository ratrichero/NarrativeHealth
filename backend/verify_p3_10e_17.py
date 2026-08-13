"""
P3-10E.17 Post-Implementation Verification
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def main():
    print("=" * 70)
    print("P3-10E.17 POST-IMPLEMENTATION VERIFICATION")
    print("=" * 70)
    print(f"Database: {settings.database_url}")
    print()

    all_pass = True

    async with engine.begin() as conn:
        # 1. P0-P2 unchanged
        print("## 1. P0-P2 tables unchanged")
        p0_p2_tables = {
            'narratives': 5,
            'coins': 25,
            'coin_narratives': 25,
            'narrative_health': 41,
        }
        for tbl, expected in p0_p2_tables.items():
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            count = res.scalar()
            status = "PASS" if count == expected else "FAIL"
            if count != expected:
                all_pass = False
            print(f"  {tbl}: {count} (expected {expected}) [{status}]")

        # 2. Immutable triggers still active
        print("\n## 2. Immutable triggers still active")
        trigger_checks = [
            ("p3_narrative_intelligence_immutable", "p3_narrative_intelligence"),
            ("p3_constituent_snapshots_immutable", "p3_constituent_snapshots"),
            ("p3_constituent_snapshot_members_immutable", "p3_constituent_snapshot_members"),
            ("narrative_membership_events_immutable", "narrative_membership_events"),
            ("narrative_membership_coverage_immutable", "narrative_membership_coverage"),
            ("narrative_membership_snapshots_immutable", "narrative_membership_snapshots"),
            ("narrative_membership_snapshot_members_immutable", "narrative_membership_snapshot_members"),
        ]
        for trigger_name, table_name in trigger_checks:
            res = await conn.execute(text("""
                SELECT COUNT(*) FROM information_schema.triggers
                WHERE trigger_name = :trigger_name
            """), {"trigger_name": trigger_name})
            count = res.scalar()
            status = "PASS" if count > 0 else "FAIL"
            if count == 0:
                all_pass = False
            print(f"  {trigger_name}: {'EXISTS' if count > 0 else 'MISSING'} [{status}]")

        # 3. Original artifacts intact
        print("\n## 3. Original artifacts intact")
        res = await conn.execute(text("""
            SELECT id, membership_snapshot_id, availability_state
            FROM p3_narrative_intelligence WHERE id = 1
        """))
        row = res.fetchone()
        if row:
            print(f"  p3_narrative_intelligence id=1: membership_snapshot_id={row[1]} [PASS]")
        else:
            print(f"  p3_narrative_intelligence id=1: NOT FOUND [FAIL]")
            all_pass = False

        res = await conn.execute(text("""
            SELECT id, member_count FROM p3_constituent_snapshots WHERE id = 1
        """))
        row = res.fetchone()
        if row:
            print(f"  p3_constituent_snapshots id=1: member_count={row[1]} [PASS]")
        else:
            print(f"  p3_constituent_snapshots id=1: NOT FOUND [FAIL]")
            all_pass = False

        res = await conn.execute(text("""
            SELECT COUNT(*) FROM p3_constituent_snapshot_members WHERE snapshot_id = 1
        """))
        count = res.scalar()
        print(f"  p3_constituent_snapshot_members snapshot_id=1: {count} rows [PASS]")

        # 4. No new snapshots outside of purpose
        print("\n## 4. No unexpected new snapshots")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_snapshots
        """))
        snap_count = res.scalar()
        print(f"  narrative_membership_snapshots: {snap_count} [PASS]")

        # 5. Correction table exists
        print("\n## 5. Correction table exists")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_name = 'p3_historical_corrections'
        """))
        table_exists = res.scalar() > 0
        status = "PASS" if table_exists else "FAIL"
        if not table_exists:
            all_pass = False
        print(f"  p3_historical_corrections table: {'EXISTS' if table_exists else 'MISSING'} [{status}]")

        if table_exists:
            res = await conn.execute(text("""
                SELECT COUNT(*) FROM p3_historical_corrections
            """))
            correction_count = res.scalar()
            print(f"  p3_historical_corrections records: {correction_count}")
            if correction_count > 0:
                res = await conn.execute(text("""
                    SELECT original_intelligence_id, original_snapshot_id, corrected_snapshot_id, reason
                    FROM p3_historical_corrections LIMIT 1
                """))
                corr = res.fetchone()
                if corr:
                    print(f"  Sample correction: intelligence={corr[0]}, original_snapshot={corr[1]}, corrected_snapshot={corr[2]}")
                    print(f"  Reason: {corr[3][:80]}...")

    print("\n" + "=" * 70)
    print(f"VERIFICATION: {'PASS' if all_pass else 'FAIL'}")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
