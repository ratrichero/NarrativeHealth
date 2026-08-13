import asyncio
import sys
from pathlib import Path
from sqlalchemy import text
import hashlib
import json

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine

async def main():
    async with engine.begin() as conn:
        print('=== Snapshot 2 members ===')
        res = await conn.execute(text("""
            SELECT snapshot_id, coin_id, is_primary, membership_state, source_event_id
            FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 2
            ORDER BY coin_id
        """))
        rows = res.fetchall()
        print(f"Count: {len(rows)}")
        for row in rows:
            print(row)
        
        # Compute digest
        members = []
        for row in rows:
            members.append({
                "coinId": row[1],
                "isPrimary": row[2],
                "membershipState": row[3] or "MEMBER",
            })
        
        members.sort(key=lambda m: m["coinId"])
        canonical = json.dumps(members, separators=(',', ':'))
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        print(f"\nCanonical JSON: {canonical}")
        print(f"Computed digest: {digest}")
        
        # Get stored snapshot info
        res = await conn.execute(text("""
            SELECT id, member_count, member_digest
            FROM narrative_membership_snapshots
            WHERE id = 2
        """))
        snap = res.fetchone()
        print(f"\nStored: member_count={snap[1]}, digest={snap[2]}")
        print(f"Match: {snap[1] == len(rows) and snap[2] == digest}")

asyncio.run(main())
