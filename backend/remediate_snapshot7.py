"""
P3-10E.14 Snapshot 7 Remediation (APPROVED)
Execute the owner-approved production writes.
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings

MEMBERS = [1, 4, 5, 10, 11, 12, 22]


async def main():
    print("=" * 70)
    print("P3-10E.14 SNAPSHOT 7 REMEDIATION (APPROVED)")
    print("=" * 70)
    print(f"Database: {settings.database_url}")
    print()

    async with engine.begin() as conn:
        # 1. Update p3_narrative_intelligence membership_snapshot_id
        print("## 1. Update p3_narrative_intelligence id=1")
        result = await conn.execute(text("""
            UPDATE p3_narrative_intelligence
            SET membership_snapshot_id = 2
            WHERE id = 1
        """))
        print(f"  Rows updated: {result.rowcount}")

        # 2. Update p3_constituent_snapshots member_count
        print("\n## 2. Update p3_constituent_snapshots id=1")
        result = await conn.execute(text("""
            UPDATE p3_constituent_snapshots
            SET member_count = 7,
                provenance = jsonb_set(
                    provenance,
                    '{constituents}',
                    '7'
                )
            WHERE id = 1
        """))
        print(f"  Rows updated: {result.rowcount}")

        # 3. Insert p3_constituent_snapshot_members
        print("\n## 3. Insert p3_constituent_snapshot_members (7 rows)")
        for coin_id in MEMBERS:
            result = await conn.execute(text("""
                INSERT INTO p3_constituent_snapshot_members
                (snapshot_id, coin_id, membership_state, inclusion_reason, availability_state, input_manifest)
                VALUES (1, :coin_id, 'MEMBER', 'authoritative_baseline', 'VALID', :manifest)
            """), {
                'coin_id': coin_id,
                'manifest': '{"source": "baseline_snapshot_2"}'
            })
            print(f"  Inserted coin_id={coin_id}")

    print("\n" + "=" * 70)
    print("REMEDIATION COMPLETE")
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())