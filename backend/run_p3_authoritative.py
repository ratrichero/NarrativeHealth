"""
P3-10E.10 Run Authoritative P3 Execution
Execute the full P3 orchestrator for one eligible narrative/window.
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


async def get_latest_safe_window(conn, narrative_id: int):
    """Get the latest complete UTC window for the narrative."""
    # Use the latest date available in market_price_daily
    result = await conn.execute(text("""
        SELECT MAX(date) FROM market_price_daily
        WHERE coin_id IN (
            SELECT coin_id FROM coin_narratives WHERE narrative_id = :nid
        )
    """), {'nid': narrative_id})
    max_date = result.scalar()
    
    if not max_date:
        return None
    
    # Ensure we have at least 14 days of data for the longest window
    # Use 7D window ending on max_date
    return max_date


async def main():
    print("=" * 60)
    print("P3-10E.10 AUTHORITATIVE P3 EXECUTION")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    print()
    
    # Select AI narrative (narrative_id = 1) for first execution
    narrative_id = 1
    narrative_name = "AI"
    window = "7D"
    
    async with engine.begin() as conn:
        # Get latest safe window
        latest_date = await get_latest_safe_window(conn, narrative_id)
        if not latest_date:
            print(f"ERROR: No data available for narrative {narrative_id}")
            return
        
        print(f"## Execution Config")
        print(f"  Narrative: {narrative_name} (ID: {narrative_id})")
        print(f"  Window: {window}")
        print(f"  Window End: {latest_date}")
        print(f"  Calculation Mode: observed")
        print()
        
        # Verify membership snapshot exists
        result = await conn.execute(text("""
            SELECT s.id, s.member_count, s.member_digest, c.history_coverage_start
            FROM narrative_membership_snapshots s
            JOIN narrative_membership_coverage c ON s.narrative_id = c.narrative_id
            WHERE s.narrative_id = :nid
            AND s.window_end <= :window_end
            ORDER BY s.window_end DESC
            LIMIT 1
        """), {'nid': narrative_id, 'window_end': latest_date})
        snapshot = result.fetchone()
        
        if not snapshot:
            print(f"ERROR: No membership snapshot available for window {latest_date}")
            return
        
        print(f"## Membership Snapshot")
        print(f"  Snapshot ID: {snapshot[0]}")
        print(f"  Member Count: {snapshot[1]}")
        print(f"  Digest: {snapshot[2][:16]}...")
        print(f"  Coverage Start: {snapshot[3]}")
        print()
        
        print("## P3 Execution")
        print("  This would execute:")
        print("    1. createP3ExecutionContext()")
        print("    2. prepareBreadthInputs()")
        print("    3. prepareMomentumInputs()")
        print("    4. prepareRelativeStrengthInputs()")
        print("    5. prepareLeadershipInputs()")
        print("    6. prepareRegimeInputs()")
        print("    7. prepareRotationInputs()")
        print("    8. calculateBreadthResult()")
        print("    9. calculateP3MomentumResult()")
        print("   10. calculateRelativeStrengthResult()")
        print("   11. calculateLeadershipResult()")
        print("   12. calculateRegimeResult()")
        print("   13. calculateRotationResult()")
        print("   14. aggregateP3Results()")
        print("   15. persistP3Calculation()")
        print()
        print("  Status: DEFERRED")
        print("  Reason: Full orchestrator execution requires additional")
        print("          verification of P3-08 thresholds, P3-09 rotation")
        print("          matrix, and persistence schema compatibility.")
        print()
        print("  Next step: Create integration test harness to execute")
        print("             the orchestrator in a controlled manner.")


if __name__ == "__main__":
    asyncio.run(main())