"""
P3-10E.11 Post-Execution Production Integrity Verification
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings

EXPECTED_COUNTS = {
    'narratives': 5,
    'coins': 25,
    'coin_narratives': 25,
    'narrative_health': 41,
}

async def main():
    print("=" * 60)
    print("P3-10E.11 POST-EXECUTION PRODUCTION INTEGRITY")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print()
    
    async with engine.begin() as conn:
        all_pass = True
        for tbl, expected in EXPECTED_COUNTS.items():
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
            count = res.scalar()
            status = "PASS" if count == expected else "FAIL"
            if count != expected:
                all_pass = False
            print(f"  {tbl}: {count} (expected {expected}) [{status}]")
        
        # Also check P3 tables
        print("\n  P3 tables (expected to be empty or unchanged):")
        for tbl in ['p3_narrative_intelligence', 'p3_constituent_snapshots', 'p3_constituent_snapshot_members']:
            try:
                res = await conn.execute(text(f"SELECT COUNT(*) FROM {tbl}"))
                count = res.scalar()
                print(f"  {tbl}: {count}")
            except Exception as e:
                print(f"  {tbl}: ERROR - {e}")
    
    print("\n" + "=" * 60)
    print(f"PRODUCTION INTEGRITY: {'PASS' if all_pass else 'FAIL'}")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())