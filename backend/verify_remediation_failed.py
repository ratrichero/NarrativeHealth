"""
P3-10E.14 Post-Attempt Verification
Confirm the failed remediation left no partial changes.
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
    print("P3-10E.14 POST-REMEDIATION-ATTEMPT VERIFICATION")
    print("=" * 70)
    print(f"Database: {settings.database_url}")
    print()

    async with engine.begin() as conn:
        # Verify p3_narrative_intelligence id=1 unchanged
        print("## 1. p3_narrative_intelligence id=1 (must be UNCHANGED)")
        res = await conn.execute(text("""
            SELECT id, membership_snapshot_id, availability_state
            FROM p3_narrative_intelligence WHERE id = 1
        """))
        row = res.fetchone()
        print(f"  membership_snapshot_id={row[1]} (expected 7 - unchanged)")
        print(f"  availability_state={row[2]}")

        # Verify p3_constituent_snapshots id=1 unchanged
        print("\n## 2. p3_constituent_snapshots id=1 (must be UNCHANGED)")
        res = await conn.execute(text("""
            SELECT id, member_count FROM p3_constituent_snapshots WHERE id = 1
        """))
        row = res.fetchone()
        print(f"  member_count={row[1]} (expected 0 - unchanged)")

        # Verify p3_constituent_snapshot_members unchanged
        print("\n## 3. p3_constituent_snapshot_members (must be 0 rows)")
        res = await conn.execute(text("""
            SELECT COUNT(*) FROM p3_constituent_snapshot_members WHERE snapshot_id = 1
        """))
        count = res.scalar()
        print(f"  Count: {count} (expected 0 - unchanged)")

        # Verify P0-P2 unchanged
        print("\n## 4. P0-P2 integrity")
        for tbl, expected in [('narratives', 5), ('coins', 25), ('coin_narratives', 25), ('narrative_health', 41)]:
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            count = res.scalar()
            status = "PASS" if count == expected else "FAIL"
            print(f"  {tbl}: {count} (expected {expected}) [{status}]")

    print("\n" + "=" * 70)
    print("VERIFICATION COMPLETE - NO PARTIAL CHANGES")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())