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
        res = await conn.execute(text("""
            SELECT coin_id, is_primary, source_event_id
            FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 2
            ORDER BY coin_id
        """))
        rows = res.fetchall()
        
        resolved_members = []
        for row in rows:
            resolved_members.append({
                "coinId": row[0],
                "isPrimary": row[1],
                "sourceEventId": row[2] if row[2] is not None else 0,
            })
        
        canonical = []
        for member in resolved_members:
            canonical.append({
                "coinId": member["coinId"],
                "isPrimary": member["isPrimary"],
                "membershipState": "MEMBER",
            })
        
        # Default json.dumps (with spaces)
        default_json = json.dumps(canonical)
        default_digest = hashlib.sha256(default_json.encode()).hexdigest()
        
        # Compact json.dumps (no spaces)
        compact_json = json.dumps(canonical, separators=(',', ':'))
        compact_digest = hashlib.sha256(compact_json.encode()).hexdigest()
        
        print(f"Default JSON: {default_json}")
        print(f"Default digest: {default_digest}")
        print(f"Compact JSON: {compact_json}")
        print(f"Compact digest: {compact_digest}")
        
        res = await conn.execute(text("""
            SELECT member_digest FROM narrative_membership_snapshots WHERE id = 2
        """))
        stored = res.fetchone()[0]
        print(f"\nStored digest: {stored}")
        print(f"Matches default: {stored == default_digest}")
        print(f"Matches compact: {stored == compact_digest}")

asyncio.run(main())
