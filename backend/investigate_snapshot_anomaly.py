"""
P3-10E.12 Investigate Membership Snapshot Anomaly
Document why snapshot_id=7 (0 members) exists when snapshot_id=2 (7 members) was the baseline.
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
    print("P3-10E.12 SNAPSHOT ANOMALY INVESTIGATION")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print()

    async with engine.begin() as conn:
        # 1. List all snapshots for narrative 1
        print("## 1. All membership snapshots for narrative 1")
        res = await conn.execute(text("""
            SELECT id, window_end, membership_mode, membership_source, member_count, captured_at
            FROM narrative_membership_snapshots
            WHERE narrative_id = 1
            ORDER BY window_end
        """))
        for row in res.fetchall():
            print(f"  id={row[0]}, window_end={row[1]}, mode={row[2]}, source={row[3]}, members={row[4]}, captured_at={row[5]}")

        # 2. Members of snapshot 2
        print("\n## 2. Members of snapshot 2")
        res = await conn.execute(text("""
            SELECT coin_id, is_primary, membership_state
            FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 2
            ORDER BY coin_id
        """))
        members = res.fetchall()
        for m in members:
            print(f"  coin_id={m[0]}, is_primary={m[1]}, state={m[2]}")
        print(f"  Total: {len(members)}")

        # 3. Members of snapshot 7
        print("\n## 3. Members of snapshot 7")
        res = await conn.execute(text("""
            SELECT coin_id, is_primary, membership_state
            FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 7
            ORDER BY coin_id
        """))
        members7 = res.fetchall()
        for m in members7:
            print(f"  coin_id={m[0]}, is_primary={m[1]}, state={m[2]}")
        print(f"  Total: {len(members7)}")

        # 4. Coverage records
        print("\n## 4. Coverage records for narrative 1")
        res = await conn.execute(text("""
            SELECT history_coverage_start, source, verified_by
            FROM narrative_membership_coverage
            WHERE narrative_id = 1
            ORDER BY history_coverage_start
        """))
        for row in res.fetchall():
            print(f"  coverage_start={row[0]}, source={row[1]}, verified_by={row[2]}")

        # 5. Membership events
        print("\n## 5. Membership events (any captured mutations)")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_events
        """))
        count = res.scalar()
        print(f"  Total events: {count}")
        if count > 0:
            res = await conn.execute(text("""
                SELECT id, narrative_id, coin_id, change_type, effective_date, provenance
                FROM narrative_membership_events
                ORDER BY effective_date
                LIMIT 20
            """))
            for row in res.fetchall():
                print(f"  id={row[0]}, narrative={row[1]}, coin={row[2]}, change={row[3]}, date={row[4]}, provenance={row[5]}")

        # 6. Check coin_narratives current state
        print("\n## 6. Current coin_narratives for AI (narrative 1)")
        res = await conn.execute(text("""
            SELECT coin_id, is_primary FROM coin_narratives
            WHERE narrative_id = 1
            ORDER BY coin_id
        """))
        rows = res.fetchall()
        print(f"  Current coin_narratives count: {len(rows)}")
        for r in rows:
            print(f"  coin_id={r[0]}, is_primary={r[1]}")

    print("\n" + "=" * 60)
    print("INVESTIGATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())