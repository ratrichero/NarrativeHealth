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
        # Get members exactly as TypeScript readSnapshotMembers would
        res = await conn.execute(text("""
            SELECT coin_id, is_primary, source_event_id
            FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 2
            ORDER BY coin_id
        """))
        rows = res.fetchall()
        
        # Build resolvedMembers exactly like TypeScript
        resolved_members = []
        for row in rows:
            resolved_members.append({
                "coinId": row[0],
                "isPrimary": row[1],
                "sourceEventId": row[2] if row[2] is not None else 0,
            })
        
        # Compute digest exactly like TypeScript digestMembers()
        canonical = []
        for member in resolved_members:
            canonical.append({
                "coinId": member["coinId"],
                "isPrimary": member["isPrimary"],
                "membershipState": "MEMBER",
            })
        
        canonical_json = json.dumps(canonical, separators=(',', ':'))
        digest = hashlib.sha256(canonical_json.encode()).hexdigest()
        
        print(f"Resolved members: {resolved_members}")
        print(f"Canonical JSON: {canonical_json}")
        print(f"Computed digest: {digest}")
        
        # Get stored digest
        res = await conn.execute(text("""
            SELECT member_count, member_digest
            FROM narrative_membership_snapshots
            WHERE id = 2
        """))
        snap = res.fetchone()
        print(f"Stored: member_count={snap[0]}, digest={snap[1]}")
        print(f"Match count: {snap[0] == len(resolved_members)}")
        print(f"Match digest: {snap[1] == digest}")

asyncio.run(main())
