"""
P3-10E.13 Snapshot 7 Read-Only Forensics
Determine if snapshot 7 is orphaned or referenced.
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
    print("=" * 60)
    print("P3-10E.13 SNAPSHOT 7 FORENSICS (READ-ONLY)")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print()

    async with engine.begin() as conn:
        # 1. Snapshot 7 details
        print("## 1. Snapshot 7 Details")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, snapshot_revision, membership_mode,
                   membership_source, ledger_cutoff_event_id, member_count, member_digest,
                   captured_at, provenance
            FROM narrative_membership_snapshots
            WHERE id = 7
        """))
        row = res.fetchone()
        if row:
            print(f"  id={row[0]}")
            print(f"  narrative_id={row[1]}")
            print(f"  window_end={row[2]}")
            print(f"  snapshot_revision={row[3]}")
            print(f"  membership_mode={row[4]}")
            print(f"  membership_source={row[5]}")
            print(f"  ledger_cutoff_event_id={row[6]}")
            print(f"  member_count={row[7]}")
            print(f"  member_digest={row[8]}")
            print(f"  captured_at={row[9]}")
            print(f"  provenance={row[10]}")
        else:
            print("  NOT FOUND")

        # 2. Snapshot 7 members
        print("\n## 2. Snapshot 7 Members")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 7
        """))
        count = res.scalar()
        print(f"  Member count: {count}")

        # 3. References from p3_narrative_intelligence
        print("\n## 3. References from p3_narrative_intelligence")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, algorithm_key, algorithm_version, membership_snapshot_id
            FROM p3_narrative_intelligence
            WHERE membership_snapshot_id = 7
        """))
        refs = res.fetchall()
        print(f"  References: {len(refs)}")
        for r in refs:
            print(f"  intelligence_id={r[0]}, narrative={r[1]}, window_end={r[2]}, algo={r[3]}/{r[4]}, snapshot={r[5]}")

        # 4. References from p3_constituent_snapshots
        print("\n## 4. References from p3_constituent_snapshots")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM p3_constituent_snapshots
            WHERE membership_source = 'authoritative_membership_snapshot'
        """))
        count = res.scalar()
        print(f"  Constituent snapshots with authoritative source: {count}")

        # 5. Check if any other table references snapshot 7
        print("\n## 5. Cross-table reference check")
        # Check p3_narrative_intelligence FK
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM p3_narrative_intelligence
            WHERE membership_snapshot_id = 7
        """))
        p3ni = res.scalar()
        print(f"  p3_narrative_intelligence references: {p3ni}")

        # 6. All snapshots for narrative 1
        print("\n## 6. All snapshots for narrative 1 (context)")
        res = await conn.execute(text("""
            SELECT id, window_end, member_count, captured_at
            FROM narrative_membership_snapshots
            WHERE narrative_id = 1
            ORDER BY window_end
        """))
        for r in res.fetchall():
            print(f"  id={r[0]}, window_end={r[1]}, members={r[2]}, captured_at={r[3]}")

        # 7. Check if snapshot 7 is referenced by any p3 record
        print("\n## 7. All p3_narrative_intelligence records")
        res = await conn.execute(text("""
            SELECT id, narrative_id, window_end, membership_snapshot_id, algorithm_key
            FROM p3_narrative_intelligence
            ORDER BY id
        """))
        for r in res.fetchall():
            print(f"  id={r[0]}, narrative={r[1]}, window_end={r[2]}, membership_snapshot_id={r[3]}, algo={r[4]}")

    print("\n" + "=" * 60)
    print("FORENSICS COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())