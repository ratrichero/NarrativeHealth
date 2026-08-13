"""
P3-10E.8 Production Read-Only Audit
Inspect production database state before applying migration 0019.
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

# Add project root to path so 'backend' package is importable
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def main():
    print("=" * 60)
    print("P3-10E.8 PRODUCTION READ-ONLY AUDIT")
    print("=" * 60)
    print(f"Database URL: {settings.database_url}")
    print()

    async with engine.begin() as conn:
        # 1. Existing tables
        print("## 1. Existing Tables")
        result = await conn.execute(text("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """))
        tables = [r[0] for r in result.fetchall()]
        print(f"Total tables: {len(tables)}")
        for t in tables:
            print(f"  - {t}")
        print()

        # 2. Check for existing membership tables
        print("## 2. Membership Tables Status")
        membership_tables = [
            'narrative_membership_events',
            'narrative_membership_coverage',
            'narrative_membership_snapshots',
            'narrative_membership_snapshot_members'
        ]
        for mt in membership_tables:
            exists = await conn.execute(text(f"""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = '{mt}'
                )
            """))
            print(f"  {mt}: {'EXISTS' if exists.scalar() else 'MISSING'}")
        print()

        # 3. Existing triggers on coin_narratives
        print("## 3. Existing Triggers on coin_narratives")
        result = await conn.execute(text("""
            SELECT tgname, tgfoid::regprocedure, tgtype::int
            FROM pg_trigger
            WHERE tgrelid = 'coin_narratives'::regclass
            AND tgisinternal = false
        """))
        triggers = result.fetchall()
        if triggers:
            for t in triggers:
                print(f"  - {t[0]} (function: {t[1]})")
        else:
            print("  No external triggers found on coin_narratives")
        print()

        # 4. Counts of key tables
        print("## 4. Key Table Counts")
        for tbl in ['narratives', 'coins', 'coin_narratives', 'narrative_health',
                    'p3_narrative_intelligence', 'p3_constituent_snapshots',
                    'p3_constituent_snapshot_members']:
            if tbl in tables:
                res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
                count = res.scalar()
                print(f"  {tbl}: {count}")
        print()

        # 5. coin_narratives sample
        print("## 5. coin_narratives Sample (first 5)")
        if 'coin_narratives' in tables:
            result = await conn.execute(text("""
                SELECT coin_id, narrative_id, is_primary, created_at
                FROM coin_narratives
                LIMIT 5
            """))
            for row in result.fetchall():
                print(f"  coin_id={row[0]}, narrative_id={row[1]}, is_primary={row[2]}, created_at={row[3]}")
        print()

        # 6. Check p3_narrative_intelligence for membership_snapshot_id
        print("## 6. P3 Intelligence membership_snapshot_id Column")
        result = await conn.execute(text("""
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'p3_narrative_intelligence'
            AND column_name = 'membership_snapshot_id'
        """))
        col = result.fetchone()
        if col:
            print(f"  Column exists: {col[0]}, type={col[1]}, nullable={col[2]}")
        else:
            print("  Column MISSING (expected before migration)")
        print()

        # 7. Check for existing foreign keys
        print("## 7. Existing Foreign Keys to p3_narrative_intelligence")
        result = await conn.execute(text("""
            SELECT conname, confrelid::regclass
            FROM pg_constraint
            WHERE conrelid = 'p3_narrative_intelligence'::regclass
            AND contype = 'f'
        """))
        fks = result.fetchall()
        if fks:
            for fk in fks:
                print(f"  - {fk[0]} -> {fk[1]}")
        else:
            print("  No foreign keys found (expected before migration)")
        print()

    print("=" * 60)
    print("AUDIT COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())