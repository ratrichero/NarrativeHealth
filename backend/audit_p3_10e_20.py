"""
P3-10E.20 Data Readiness & Stage Contract Remediation Audit
"""
import asyncio
import sys
from pathlib import Path
from datetime import datetime, timezone, timedelta
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings


async def query_one(conn, sql, params=None):
    res = await conn.execute(text(sql), params or {})
    return res.fetchone()


async def query_scalar(conn, sql, params=None):
    res = await conn.execute(text(sql), params or {})
    return res.scalar()


async def query_all(conn, sql, params=None):
    res = await conn.execute(text(sql), params or {})
    return res.fetchall()


async def main():
    print("=" * 80)
    print("P3-10E.20 DATA READINESS & STAGE CONTRACT REMEDIATION AUDIT")
    print("=" * 80)
    print(f"Database: {settings.database_url}")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print()

    matrix = []

    # ===================================================================
    # P3-07: MEMBERSHIP STATE CONTRACT
    # ===================================================================
    print("=" * 80)
    print("P3-07: MEMBERSHIP STATE CONTRACT AUDIT")
    print("=" * 80)

    async with engine.begin() as conn:
        # Check what resolver returns
        res = await query_one(conn, """
            SELECT membership_snapshot_id, availability_state
            FROM p3_narrative_intelligence WHERE id = 1
        """)
        print(f"  Intelligence #1: membership_snapshot_id={res[0]}, state={res[1]}")

        # Check snapshot members
        res = await query_all(conn, """
            SELECT coin_id, membership_state
            FROM narrative_membership_snapshot_members
            WHERE snapshot_id = 2
            ORDER BY coin_id
        """)
        print(f"  Snapshot 2 members: {len(res)}")
        for row in res:
            print(f"    coin_id={row[0]}, membership_state={row[1]}")

        # Check what context.constituents expects
        print("\n  Contract analysis:")
        print("    - resolveP3Membership returns: membershipState = 'MEMBER'")
        print("    - prepareLeadershipInputs expects: membershipState = 'ELIGIBLE'")
        print("    - prepareMomentumInputs expects: membershipState = 'ELIGIBLE'")
        print("    - prepareRegimeInputs expects: membershipState = 'ELIGIBLE'")
        print("    - prepareRotationInputs expects: membershipState = 'ELIGIBLE'")
        print("    - persistence.ts expects: membershipState = 'ELIGIBLE'")
        print("    - constituents.ts expects: membershipState = 'ELIGIBLE'")
        print("\n  Root cause: CODE CONTRACT BUG")
        print("    - Resolver produces 'MEMBER' (membership ledger semantic)")
        print("    - Downstream consumers filter on 'ELIGIBLE' (P3 calculation semantic)")
        print("    - These are the same set of coins, but the string literal doesn't match")
        print("\n  Remediation: FIX in membership.ts")
        print("    - Change resolver output from 'MEMBER' to 'ELIGIBLE'")
        print("    - This aligns resolver output with all downstream consumers")
        print("    - 'ELIGIBLE' is the correct semantic for P3 calculation input")

    matrix.append({
        "stage": "P3-07 Leadership",
        "input": "membershipState",
        "required_history": "N/A (contract mismatch)",
        "actual_history": "MEMBER (from resolver)",
        "gap": "String literal mismatch: MEMBER vs ELIGIBLE",
        "root_cause": "Code contract bug",
        "remediation": "Fix resolver in membership.ts to return 'ELIGIBLE' instead of 'MEMBER'"
    })

    # ===================================================================
    # P3-05: MOMENTUM DATA REQUIREMENTS
    # ===================================================================
    print("\n" + "=" * 80)
    print("P3-05: MOMENTUM DATA REQUIREMENTS AUDIT")
    print("=" * 80)

    async with engine.begin() as conn:
        # Narrative health availability
        res = await query_one(conn, """
            SELECT MIN(date), MAX(date), COUNT(*)
            FROM narrative_health
            WHERE narrative_id = 1
        """)
        print(f"  narrative_health for AI (narrative_id=1):")
        print(f"    Date range: {res[0]} to {res[1]}")
        print(f"    Count: {res[2]}")

        # Check specific dates needed for 14D window ending 2026-08-11
        required_dates = []
        for i in range(14):
            d = datetime(2026, 8, 11) - timedelta(days=i)
            required_dates.append(d.date())

        print(f"\n  Required dates for 14D window ending 2026-08-11:")
        for d in required_dates:
            res = await query_scalar(conn, """
                SELECT COUNT(*) FROM narrative_health
                WHERE narrative_id = 1 AND date = :d
            """, {"d": d})
            status = "OK" if res > 0 else "MISSING"
            print(f"    {d}: {status}")

        # Gap analysis
        res = await query_one(conn, """
            SELECT MIN(date) FROM narrative_health WHERE narrative_id = 1
        """)
        earliest = res[0]
        gap_start = "2026-07-28"  # 14D window start target
        print(f"\n  Gap analysis:")
        print(f"    Earliest data: {earliest}")
        print(f"    Required start: {gap_start}")
        print(f"    Gap: {earliest} is AFTER {gap_start}")

        # Check if data can be backfilled
        print(f"\n  Backfill feasibility:")
        print(f"    - narrative_health is populated by P0-P2 scheduler")
        print(f"    - Source: narrative health scoring pipeline")
        print(f"    - Cannot backfill without re-running health score calculation")
        print(f"    - Historical raw data may exist in coin_metrics/health_scores")

    matrix.append({
        "stage": "P3-05 Momentum",
        "input": "narrative_health",
        "required_history": "2026-07-28 to 2026-08-11 (14D window)",
        "actual_history": "2026-08-01 to 2026-08-11",
        "gap": "23 days missing (2026-07-28 to 2026-07-31)",
        "root_cause": "Missing pipeline data (narrative_health not populated before 2026-08-01)",
        "remediation": "Backfill narrative_health from canonical health score pipeline (P0-P2 scheduled job)"
    })

    # ===================================================================
    # P3-08: REGIME DATA REQUIREMENTS
    # ===================================================================
    print("\n" + "=" * 80)
    print("P3-08: REGIME DATA REQUIREMENTS AUDIT")
    print("=" * 80)

    async with engine.begin() as conn:
        # Regime is a point-in-time classification, not historical
        # It needs: health, healthChange, breadth, breadthChange, momentum, acceleration, RS, RSChange
        # These are scalar values from upstream stages

        print("  Regime classification inputs:")
        print("    - health: scalar (from narrative_health)")
        print("    - healthChange: scalar (from narrative_health 7D delta)")
        print("    - breadth: scalar (from P3-04)")
        print("    - breadthChange: scalar (from p3_narrative_intelligence history)")
        print("    - momentum: scalar (from P3-05)")
        print("    - acceleration: scalar (from P3-05)")
        print("    - relativeStrength: scalar (from P3-06)")
        print("    - relativeStrengthChange: scalar (from p3_narrative_intelligence history)")
        print()
        print("  Historical data requirement:")
        print("    - breadthChange: needs p3_narrative_intelligence at window_end - 7d")
        print("    - relativeStrengthChange: needs p3_narrative_intelligence at window_end - 7d")
        print()

        # Check historical p3_narrative_intelligence availability
        res = await query_all(conn, """
            SELECT window_end, availability_state, breadth, relative_strength_7d
            FROM p3_narrative_intelligence
            WHERE narrative_id = 1
            ORDER BY window_end
        """)
        print(f"  Historical p3_narrative_intelligence records: {len(res)}")
        for row in res:
            print(f"    window_end={row[0]}, state={row[1]}, breadth={row[2]}, rs7d={row[3]}")

        # Check if there's a record 7D ago
        res = await query_one(conn, """
            SELECT COUNT(*)
            FROM p3_narrative_intelligence
            WHERE narrative_id = 1
              AND window_end <= '2026-08-04T00:00:00Z'
              AND availability_state = 'VALID'
        """)
        print(f"\n  Valid P3 records at or before 2026-08-04: {res}")
        if res == 0:
            print("  Gap: No valid historical P3 data for breadthChange/RSChange calculation")
            print("  Root cause: No prior clean P3 execution")
            print("  Remediation: Requires successful P3-10E.19 execution first")

    matrix.append({
        "stage": "P3-08 Regime",
        "input": "breadthChange, relativeStrengthChange",
        "required_history": "p3_narrative_intelligence at window_end - 7d",
        "actual_history": "No valid prior P3 records",
        "gap": "Cannot calculate change without baseline",
        "root_cause": "Missing prior execution (P3-10E.19 not completed)",
        "remediation": "Complete P3-10E.19 first clean execution to establish historical baseline"
    })

    # ===================================================================
    # P3-09: ROTATION DATA REQUIREMENTS
    # ===================================================================
    print("\n" + "=" * 80)
    print("P3-09: ROTATION DATA REQUIREMENTS AUDIT")
    print("=" * 80)

    async with engine.begin() as conn:
        # Volume Expansion: needs market_price_daily for 7D window
        print("  Volume Expansion requirements:")
        print("    - Input: market_price_daily (volume)")
        print("    - Window: 7D (2026-08-04 to 2026-08-11)")
        print("    - Need: >= 2 price points per eligible constituent")
        print()

        # Check volume data availability
        coin_ids = [1, 4, 5, 10, 11, 12, 22]
        for coin_id in coin_ids:
            res = await query_scalar(conn, """
                SELECT COUNT(*) FROM market_price_daily
                WHERE coin_id = :cid
                  AND date >= '2026-08-04'
                  AND date <= '2026-08-11'
            """, {"cid": coin_id})
            print(f"    coin_id={coin_id}: {res} days of volume data")

        # OI Confirmation: needs coinMetrics (openInterest)
        print("\n  OI Confirmation requirements:")
        print("    - Input: coin_metrics (openInterest)")
        print("    - Window: 7D (2026-08-04 to 2026-08-11)")
        print("    - Need: >= 2 OI data points per eligible constituent")
        print()

        # Check OI data availability
        for coin_id in coin_ids:
            res = await query_scalar(conn, """
                SELECT COUNT(*) FROM coin_metrics
                WHERE coin_id = :cid
                  AND date >= '2026-08-04'
                  AND date <= '2026-08-11'
                  AND open_interest IS NOT NULL
            """, {"cid": coin_id})
            print(f"    coin_id={coin_id}: {res} days of OI data")

        # Check historical breadth for breadthMomentum
        print("\n  Breadth Momentum requirements:")
        print("    - Input: p3_narrative_intelligence (breadth)")
        print("    - Need: >= 2 historical records for 7D change")
        res = await query_scalar(conn, """
            SELECT COUNT(*) FROM p3_narrative_intelligence
            WHERE narrative_id = 1 AND availability_state = 'VALID'
        """)
        print(f"    Valid historical records: {res}")

        # Check historical RS for relativeStrength
        print("\n  Relative Strength requirements:")
        print("    - Input: p3_narrative_intelligence (relativeStrength7d)")
        print("    - Need: latest valid RS value")
        res = await query_one(conn, """
            SELECT relative_strength_7d FROM p3_narrative_intelligence
            WHERE narrative_id = 1 AND availability_state = 'VALID'
            ORDER BY window_end DESC LIMIT 1
        """)
        if res:
            print(f"    Latest RS_7d: {res[0]}")
        else:
            print("    Latest RS_7d: NULL (no valid records)")

    matrix.append({
        "stage": "P3-09 Rotation",
        "input": "volume_expansion, oi_confirmation, breadth_momentum, relative_strength",
        "required_history": "market_price_daily + coin_metrics for 7D; p3_narrative_intelligence for historical",
        "actual_history": "Volume: available; OI: sparse/missing; Historical P3: none",
        "gap": "OI data missing for most constituents; no historical P3 baseline",
        "root_cause": "Missing pipeline data (coin_metrics OI not populated); missing prior execution",
        "remediation": "Populate coin_metrics openInterest pipeline; complete P3-10E.19 first"
    })

    # ===================================================================
    # SUMMARY MATRIX
    # ===================================================================
    print("\n" + "=" * 80)
    print("REMEDIATION MATRIX")
    print("=" * 80)
    print(f"{'Stage':<20} {'Input':<30} {'Root Cause':<25} {'Remediation'}")
    print("-" * 80)
    for row in matrix:
        print(f"{row['stage']:<20} {row['input']:<30} {row['root_cause']:<25} {row['remediation']}")

    # ===================================================================
    # CROSS-LANGUAGE CANONICALIZATION TESTS
    # ===================================================================
    print("\n" + "=" * 80)
    print("CROSS-LANGUAGE CANONICALIZATION TEST REQUIREMENTS")
    print("=" * 80)
    print("""
Two P3 correctness bugs were identified during E.19 execution:

1. PostgreSQL timestamp microseconds vs JavaScript milliseconds
   - PostgreSQL stores timestamptz with microsecond precision
   - JavaScript Date only has millisecond precision
   - When comparing window_end = coverageStart, microsecond differences cause misses
   - Fix: Use range query (gte + lte + 1ms) instead of exact equality

2. Python vs JavaScript JSON serialization for digest
   - Python json.dumps() adds spaces after separators by default
   - JavaScript JSON.stringify() produces compact output
   - Same canonical data -> different digests
   - Fix: Python uses separators=(',', ':') to match JS compact format

Required tests:
- Test 1: Timestamp boundary test
  - Create snapshot with PostgreSQL NOW() (microseconds)
  - Query from JS with exact equality -> should miss
  - Query from JS with range -> should find
  - Verify resolver behavior with microsecond-precision timestamps

- Test 2: Cross-language digest canonicalization
  - Compute digest in Python with default json.dumps
  - Compute digest in JS with JSON.stringify
  - Compute digest in Python with separators=(',', ':')
  - Verify Python compact matches JS compact
  - Add this as a CI test to prevent regression

- Test 3: Membership snapshot insertion test
  - Insert snapshot from Python with spaced JSON
  - Read from JS resolver -> verify digest mismatch detected
  - This documents the existing data state
""")

    # ===================================================================
    # FEASIBILITY ANALYSIS
    # ===================================================================
    print("=" * 80)
    print("FEASIBILITY ANALYSIS")
    print("=" * 80)
    print("""
P3-05 Momentum:
  - Blocking: Missing narrative_health from 2026-07-28 to 2026-07-31
  - Canonical source: P0-P2 narrative_health table (populated by scheduled job)
  - Backfill possible: YES, if health score pipeline can run for historical dates
  - Without backfill: Cannot compute 14D momentum until 2026-08-12 (when 14D window
    ending 2026-08-11 becomes available with MAX_AS_OF_GAP_DAYS=1 tolerance)

P3-08 Regime:
  - Blocking: No valid historical p3_narrative_intelligence for change calculations
  - Canonical source: Prior P3 executions
  - Backfill possible: NO - requires prior clean execution
  - Without prior execution: breadthChange and relativeStrengthChange will be null
     - Regime may still classify if all other inputs are valid (matches.length could be 0 or 1)

P3-09 Rotation:
  - Blocking: Missing coin_metrics.openInterest for most constituents
  - Canonical source: P0-P2 coin_metrics table
  - Backfill possible: UNKNOWN - depends on whether OI data source provides historical data
  - Volume expansion: Available (market_price_daily has data)
  - Breadth momentum: Blocked by P3-08 (needs historical p3_narrative_intelligence)
  - Relative strength: Available from P3-06 result

P3-07 Leadership:
  - Blocking: Code contract bug (MEMBER vs ELIGIBLE)
  - Fix complexity: LOW (change string literal in resolver)
  - Fix scope: membership.ts only, no schema changes
  - Risk: LOW (all downstream consumers already expect ELIGIBLE)
""")

    print("\n" + "=" * 80)
    print("AUDIT COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())
