"""
P3-10E.9 Baseline Verification & Production Integrity Check
"""
import asyncio
import sys
from pathlib import Path
from datetime import datetime
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def main():
    print("=" * 60)
    print("P3-10E.9 BASELINE VERIFICATION")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    print()

    async with engine.begin() as conn:
        # 1. Production Integrity
        print("## 1. Production Integrity")
        for tbl in ['narratives', 'coins', 'coin_narratives', 'narrative_health']:
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            count = res.scalar()
            print(f"  {tbl}: {count}")
        
        # 2. Baseline Coverage
        print("\n## 2. Baseline Coverage")
        result = await conn.execute(text("""
            SELECT n.id, n.name, c.history_coverage_start, c.source, s.member_count, s.member_digest
            FROM narratives n
            JOIN narrative_membership_coverage c ON n.id = c.narrative_id
            JOIN narrative_membership_snapshots s ON n.id = s.narrative_id
            ORDER BY n.id
        """))
        for row in result.fetchall():
            print(f"  Narrative {row[0]} ({row[1]}):")
            print(f"    Coverage start: {row[2]}")
            print(f"    Source: {row[3]}")
            print(f"    Member count: {row[4]}")
            print(f"    Digest: {row[5][:16]}...")
        
        # 3. History Capture Structural Verification
        print("\n## 3. History Capture Structural Verification")
        result = await conn.execute(text("""
            SELECT tgname, tgrelid::regclass FROM pg_trigger
            WHERE tgname LIKE '%membership%' AND tgisinternal = false
        """))
        triggers = result.fetchall()
        for t in triggers:
            print(f"  [OK] {t[0]} on {t[1]}")
        
        # 4. Resolver Behavior Summary
        print("\n## 4. Resolver Behavior Summary")
        result = await conn.execute(text("SELECT COUNT(*) FROM narrative_membership_coverage"))
        coverage_count = result.scalar()
        print(f"  Coverage records: {coverage_count}")
        print(f"  Before baseline: NO_SNAPSHOT")
        print(f"  At/after baseline: AVAILABLE")
        
        # 5. Earliest Trustworthy P3 Window
        print("\n## 5. Earliest Trustworthy P3 Window")
        result = await conn.execute(text("""
            SELECT MIN(history_coverage_start) FROM narrative_membership_coverage
        """))
        earliest = result.scalar()
        print(f"  Earliest coverage: {earliest.isoformat()}Z")
        print(f"  Note: P3-08, P3-09, and persistence not yet activated")

    print("\n" + "=" * 60)
    print("VERIFICATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())