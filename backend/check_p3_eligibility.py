"""
P3-10E.10 Check P3 Execution Eligibility
Determine which narratives/windows have sufficient data for authoritative execution.
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


async def check_narrative_eligibility(conn, narrative_id: int, narrative_name: str):
    """Check data availability for a specific narrative."""
    print(f"\n  Narrative {narrative_id} ({narrative_name}):")
    
    # 1. Membership availability
    result = await conn.execute(text("""
        SELECT COUNT(*) FROM narrative_membership_coverage
        WHERE narrative_id = :nid
    """), {'nid': narrative_id})
    coverage = result.scalar()
    membership_status = "AVAILABLE" if coverage > 0 else "NO_SNAPSHOT"
    print(f"    Membership: {membership_status}")
    
    # 2. Check market_price_daily availability
    result = await conn.execute(text("""
        SELECT MAX(date), MIN(date), COUNT(*)
        FROM market_price_daily
        WHERE coin_id IN (
            SELECT coin_id FROM coin_narratives WHERE narrative_id = :nid
        )
    """), {'nid': narrative_id})
    price_row = result.fetchone()
    if price_row and price_row[0]:
        print(f"    Price data: {price_row[2]} rows, {price_row[1]} to {price_row[0]}")
        breadth_status = "AVAILABLE"
    else:
        print(f"    Price data: MISSING")
        breadth_status = "MISSING"
    
    # 3. Check indicators availability
    result = await conn.execute(text("""
        SELECT MAX(date), MIN(date), COUNT(*)
        FROM indicators
        WHERE coin_id IN (
            SELECT coin_id FROM coin_narratives WHERE narrative_id = :nid
        )
    """), {'nid': narrative_id})
    indicator_row = result.fetchone()
    if indicator_row and indicator_row[0]:
        print(f"    Indicators: {indicator_row[2]} rows, {indicator_row[1]} to {indicator_row[0]}")
        momentum_status = "AVAILABLE"
    else:
        print(f"    Indicators: MISSING")
        momentum_status = "MISSING"
    
    # 4. Check BTC benchmark (coin_id = 17)
    result = await conn.execute(text("""
        SELECT MAX(date), MIN(date), COUNT(*)
        FROM market_price_daily
        WHERE coin_id = 17
    """))
    btc_row = result.fetchone()
    if btc_row and btc_row[0]:
        print(f"    BTC benchmark: {btc_row[2]} rows, {btc_row[1]} to {btc_row[0]}")
        rs_status = "AVAILABLE"
    else:
        print(f"    BTC benchmark: MISSING")
        rs_status = "MISSING"
    
    # 5. Check narrative_health availability
    result = await conn.execute(text("""
        SELECT MAX(date), MIN(date), COUNT(*)
        FROM narrative_health
        WHERE narrative_id = :nid
    """), {'nid': narrative_id})
    health_row = result.fetchone()
    if health_row and health_row[0]:
        print(f"    Narrative health: {health_row[2]} rows, {health_row[1]} to {health_row[0]}")
        leadership_status = "AVAILABLE"
        regime_status = "AVAILABLE"
    else:
        print(f"    Narrative health: MISSING")
        leadership_status = "MISSING"
        regime_status = "MISSING"
    
    # 6. Check coin_metrics for volume/OI
    result = await conn.execute(text("""
        SELECT COUNT(*) FROM coin_metrics
        WHERE coin_id IN (
            SELECT coin_id FROM coin_narratives WHERE narrative_id = :nid
        )
    """), {'nid': narrative_id})
    metrics_count = result.scalar()
    rotation_status = "AVAILABLE" if metrics_count > 0 else "MISSING"
    print(f"    Coin metrics: {metrics_count} rows")
    
    # Determine overall eligibility
    all_status = [membership_status, breadth_status, momentum_status, rs_status, 
                  leadership_status, regime_status, rotation_status]
    overall = "ELIGIBLE" if all(s == "AVAILABLE" for s in all_status) else "DATA LIMITED"
    
    print(f"    Overall: {overall}")
    
    return {
        'narrative_id': narrative_id,
        'narrative_name': narrative_name,
        'membership': membership_status,
        'breadth': breadth_status,
        'momentum': momentum_status,
        'rs': rs_status,
        'leadership': leadership_status,
        'regime': regime_status,
        'rotation': rotation_status,
        'overall': overall,
        'latest_price_date': price_row[0] if price_row else None,
        'latest_indicator_date': indicator_row[0] if indicator_row else None,
        'latest_health_date': health_row[0] if health_row else None,
    }


async def main():
    print("=" * 60)
    print("P3-10E.10 EXECUTION ELIGIBILITY CHECK")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    print()
    
    narratives = [
        (1, 'AI'),
        (2, 'RWA'),
        (3, 'TOPMC'),
        (4, 'FAVORITE'),
        (6, 'RESTAKING'),
    ]
    
    async with engine.begin() as conn:
        print("## Checking data availability per narrative...")
        results = []
        for nid, name in narratives:
            result = await check_narrative_eligibility(conn, nid, name)
            results.append(result)
    
    print("\n" + "=" * 60)
    print("ELIGIBILITY SUMMARY")
    print("=" * 60)
    for r in results:
        status_mark = "[OK]" if r['overall'] == "ELIGIBLE" else "[FAIL]"
        print(f"{status_mark} {r['narrative_name']}: {r['overall']}")
        if r['overall'] == "ELIGIBLE":
            print(f"   Latest price date: {r['latest_price_date']}")
            print(f"   Latest indicator date: {r['latest_indicator_date']}")
            print(f"   Latest health date: {r['latest_health_date']}")
    
    eligible_count = sum(1 for r in results if r['overall'] == "ELIGIBLE")
    print(f"\nEligible narratives: {eligible_count}/{len(results)}")
    
    if eligible_count == 0:
        print("\nP3-10E.10 STATUS: DATA LIMITED")
        print("No narrative has sufficient data for complete P3 execution.")
    else:
        print("\nP3-10E.10 STATUS: READY")
        print(f"{eligible_count} narrative(s) eligible for authoritative execution.")


if __name__ == "__main__":
    asyncio.run(main())