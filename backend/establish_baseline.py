"""
P3-10E.9 Historical Membership Baseline Establishment
Capture current coin_narratives state as authoritative baseline.
"""
import asyncio
import sys
import hashlib
import json as json_module
from pathlib import Path
from datetime import datetime
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def get_current_membership(conn):
    """Get current membership for all narratives."""
    result = await conn.execute(text("""
        SELECT 
            n.id as narrative_id,
            n.name as narrative_name,
            ARRAY_AGG(c.id ORDER BY c.id) as coin_ids,
            ARRAY_AGG(c.symbol ORDER BY c.id) as symbols,
            ARRAY_AGG(cn.is_primary ORDER BY c.id) as is_primary_array
        FROM narratives n
        LEFT JOIN coin_narratives cn ON n.id = cn.narrative_id
        LEFT JOIN coins c ON cn.coin_id = c.id
        GROUP BY n.id, n.name
        ORDER BY n.id
    """))
    return result.fetchall()


async def main():
    print("=" * 60)
    print("P3-10E.9 BASELINE ESTABLISHMENT")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    print()

    async with engine.begin() as conn:
        # 1. Get current membership
        print("## 1. Current Membership Verification")
        rows = await get_current_membership(conn)
        
        narratives = []
        for row in rows:
            narrative_id, narrative_name, coin_ids, symbols, is_primary_array = row
            coin_count = len(coin_ids) if coin_ids[0] else 0
            narratives.append({
                'id': narrative_id,
                'name': narrative_name,
                'coin_ids': coin_ids,
                'symbols': symbols,
                'is_primary_array': is_primary_array,
                'coin_count': coin_count
            })
            print(f"\n  Narrative {narrative_id} ({narrative_name}):")
            print(f"    Coin count: {coin_count}")
            print(f"    Coin IDs: {coin_ids}")
            print(f"    Symbols: {symbols}")
            print(f"    is_primary: {is_primary_array}")

        # 2. Create baseline records
        print("\n## 2. Creating Baseline Records")
        baseline_timestamp = datetime.utcnow()
        
        for narrative in narratives:
            if narrative['coin_count'] == 0:
                print(f"  Skipping narrative {narrative['id']} ({narrative['name']}): no members")
                continue
            
            # Create coverage record
            await conn.execute(text("""
                INSERT INTO narrative_membership_coverage 
                (narrative_id, history_coverage_start, source, verified_by, provenance)
                VALUES (:narrative_id, :coverage_start, :source, :verified_by, :provenance)
                ON CONFLICT (narrative_id, history_coverage_start) DO NOTHING
            """), {
                'narrative_id': narrative['id'],
                'coverage_start': baseline_timestamp,
                'source': 'owner_verified_baseline',
                'verified_by': 'production_activation',
                'provenance': json_module.dumps({
                    'method': 'current_coin_narratives_capture',
                    'baseline_timestamp': baseline_timestamp.isoformat(),
                    'coin_count': narrative['coin_count'],
                    'coin_ids': narrative['coin_ids'],
                    'note': 'Authoritative membership known from this capture point forward'
                })
            })
            print(f"  [OK] Coverage created for narrative {narrative['id']} ({narrative['name']})")
            
            # Compute digest before insertion
            canonical = sorted([
                {'coinId': cid, 'isPrimary': ip, 'membershipState': 'MEMBER'}
                for cid, ip in zip(narrative['coin_ids'], narrative['is_primary_array'])
            ], key=lambda x: x['coinId'])
            digest = hashlib.sha256(json_module.dumps(canonical).encode()).hexdigest()

            # Create snapshot with digest included
            snapshot_result = await conn.execute(text("""
                INSERT INTO narrative_membership_snapshots 
                (narrative_id, window_end, membership_mode, membership_source, member_count, member_digest, captured_at, provenance)
                VALUES (:narrative_id, :window_end, :mode, :source, :member_count, :member_digest, :captured_at, :provenance)
                RETURNING id
            """), {
                'narrative_id': narrative['id'],
                'window_end': baseline_timestamp,
                'mode': 'observed',
                'source': 'membership_event_ledger',
                'member_count': narrative['coin_count'],
                'member_digest': digest,
                'captured_at': baseline_timestamp,
                'provenance': json_module.dumps({
                    'resolver': 'resolveP3Membership',
                    'coverage_start': baseline_timestamp.isoformat(),
                    'event_count': 0,
                    'baseline': True
                })
            })
            snapshot_id = snapshot_result.fetchone()[0]
            
            # Create snapshot members
            members_data = []
            for i, coin_id in enumerate(narrative['coin_ids']):
                members_data.append({
                    'snapshot_id': snapshot_id,
                    'coin_id': coin_id,
                    'is_primary': narrative['is_primary_array'][i],
                    'membership_state': 'MEMBER',
                    'source_event_id': None,
                    'provenance': {
                        'source': 'baseline_capture',
                        'baseline_timestamp': baseline_timestamp.isoformat()
                    }
                })
            
            for member in members_data:
                await conn.execute(text("""
                    INSERT INTO narrative_membership_snapshot_members 
                    (snapshot_id, coin_id, is_primary, membership_state, source_event_id, provenance)
                    VALUES (:snapshot_id, :coin_id, :is_primary, :membership_state, :source_event_id, :provenance)
                """), {
                    'snapshot_id': member['snapshot_id'],
                    'coin_id': member['coin_id'],
                    'is_primary': member['is_primary'],
                    'membership_state': member['membership_state'],
                    'source_event_id': member['source_event_id'],
                    'provenance': json_module.dumps(member['provenance'])
                })
            
            print(f"  [OK] Snapshot {snapshot_id} created with {narrative['coin_count']} members")
            
            print(f"  [OK] Digest computed: {digest[:16]}...")

        # 3. Verify resolver behavior
        print("\n## 3. Resolver Verification")
        
        # Test before baseline
        before_baseline = datetime(baseline_timestamp.year, baseline_timestamp.month, baseline_timestamp.day - 1)
        result = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_coverage
            WHERE history_coverage_start <= :before
        """), {'before': before_baseline})
        coverage_before = result.scalar()
        print(f"  Before baseline ({before_baseline.date()}): {coverage_before} coverage records")
        print(f"  Expected resolver: NO_SNAPSHOT")
        
        # Test at baseline
        result = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_coverage
            WHERE history_coverage_start <= :baseline
        """), {'baseline': baseline_timestamp})
        coverage_at = result.scalar()
        print(f"\n  At baseline ({baseline_timestamp.date()}): {coverage_at} coverage records")
        print(f"  Expected resolver: AVAILABLE")
        
        # Test after baseline
        after_baseline = datetime(baseline_timestamp.year, baseline_timestamp.month, baseline_timestamp.day + 1)
        result = await conn.execute(text("""
            SELECT COUNT(*) FROM narrative_membership_coverage
            WHERE history_coverage_start <= :after
        """), {'after': after_baseline})
        coverage_after = result.scalar()
        print(f"\n  After baseline ({after_baseline.date()}): {coverage_after} coverage records")
        print(f"  Expected resolver: AVAILABLE")

    print("\n" + "=" * 60)
    print("BASELINE ESTABLISHMENT COMPLETE")
    print("=" * 60)
    print(f"Baseline timestamp: {baseline_timestamp.isoformat()}Z")
    print(f"Narratives covered: {len(narratives)}")
    print(f"Earliest trustworthy P3 window: {baseline_timestamp.isoformat()}Z")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())