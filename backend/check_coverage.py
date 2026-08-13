import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine

async def main():
    async with engine.begin() as conn:
        print('=== Coverage ===')
        res = await conn.execute(text('SELECT id, narrative_id, history_coverage_start, source FROM narrative_membership_coverage WHERE narrative_id = 1'))
        for row in res.fetchall():
            print(row)
        
        print('\n=== Snapshots for narrative 1 ===')
        res = await conn.execute(text('SELECT id, narrative_id, window_end, snapshot_revision, membership_mode, member_count FROM narrative_membership_snapshots WHERE narrative_id = 1 ORDER BY id'))
        for row in res.fetchall():
            print(row)

asyncio.run(main())
