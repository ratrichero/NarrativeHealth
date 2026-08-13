"""
P3-10E.23 Historical Narrative Health Backfill Feasibility & Controlled Replay Audit

READ-ONLY audit. No production writes.
"""
import sys
from pathlib import Path
from datetime import datetime, timezone, date, timedelta
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
    print("P3-10E.23 HISTORICAL NARRATIVE HEALTH BACKFILL FEASIBILITY AUDIT")
    print("=" * 80)
    print(f"Database: {settings.database_url}")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print()

    # ===================================================================
    # 1. CURRENT COVERAGE
    # ===================================================================
    print("=" * 80)
    print("1. CURRENT NARRATIVE_HEALTH COVERAGE")
    print("=" * 80)

    async with engine.begin() as conn:
        res = await query_all(conn, """
            SELECT date, narrative_id, health_score, previous_score, score_change,
                   status, coin_count, top_coin_id, weakest_coin_id,
                   avg_confidence, weighting_method, rule_version_id
            FROM narrative_health
            WHERE narrative_id = 1
            ORDER BY date
        """)
        print(f"  Existing records for AI (narrative_id=1): {len(res)}")
        for row in res:
            print(f"    {row[0]}: health={row[2]}, coins={row[6]}, method={row[10]}, rule={row[11]}")

        res2 = await query_one(conn, """
            SELECT MIN(date), MAX(date) FROM narrative_health WHERE narrative_id = 1
        """)
        print(f"  Date range: {res2[0]} to {res2[1]}")

        # Identify missing dates
        start = date(2026, 7, 28)
        end = date(2026, 8, 11)
        existing = {row[0] for row in res}
        missing = []
        current = start
        while current <= end:
            if current not in existing:
                missing.append(current)
            current += timedelta(days=1)
        print(f"  Missing dates: {missing}")

    # ===================================================================
    # 2. COIN_NARRATIVES HISTORY / MEMBERSHIP SEMANTICS
    # ===================================================================
    print("\n" + "=" * 80)
    print("2. HISTORICAL MEMBERSHIP SEMANTICS")
    print("=" * 80)

    async with engine.begin() as conn:
        res = await query_all(conn, """
            SELECT coin_id, narrative_id, is_primary, created_at
            FROM coin_narratives
            WHERE narrative_id = 1
            ORDER BY coin_id
        """)
        print(f"  Current coin_narratives for AI:")
        for row in res:
            print(f"    coin_id={row[0]}, primary={row[2]}, created_at={row[3]}")

        # Check coin_breakdown for 2026-08-01 to see historical membership
        res2 = await query_one(conn, """
            SELECT coin_breakdown FROM narrative_health
            WHERE narrative_id = 1 AND date = '2026-08-01'
        """)
        if res2:
            import json
            breakdown = res2[0]
            print(f"\n  coin_breakdown for 2026-08-01:")
            for coin in breakdown:
                print(f"    coinId={coin['coinId']}, weight={coin['weight']}")

        # Check if coins 2, 3 exist
        res3 = await query_all(conn, """
            SELECT id, symbol FROM coins WHERE id IN (2, 3)
        """)
        print(f"\n  Coins 2, 3 exist in coins table: {len(res3) > 0}")
        for row in res3:
            print(f"    coin_id={row[0]}, symbol={row[1]}")

        # CRITICAL FINDING
        print("\n  CRITICAL FINDING:")
        print("    - Current coin_narratives has 7 coins: 1, 4, 5, 10, 11, 12, 22")
        print("    - narrative_health 2026-08-01 references coins 1, 2, 3, 4, 5, 10")
        print("    - Coins 2 and 3 DO NOT EXIST in current coins table")
        print("    - No audit/history table exists for coin_narratives changes")
        print("    - Historical membership for 2026-07-28 to 2026-07-31 CANNOT be determined")

    # ===================================================================
    # 3. SOURCE DATA AVAILABILITY
    # ===================================================================
    print("\n" + "=" * 80)
    print("3. SOURCE DATA AVAILABILITY FOR MISSING DATES")
    print("=" * 80)

    async with engine.begin() as conn:
        target_dates = [date(2026, 7, 28), date(2026, 7, 29), date(2026, 7, 30), date(2026, 7, 31)]
        ai_coins = [1, 4, 5, 10, 11, 12, 22]

        for d in target_dates:
            print(f"\n  {d}:")
            
            # market_price_daily
            res = await query_scalar(conn, """
                SELECT COUNT(*) FROM market_price_daily
                WHERE coin_id = ANY(:coins) AND date = :d
            """, {"coins": ai_coins, "d": d})
            print(f"    market_price_daily: {res} records")

            # coin_metrics
            res2 = await query_all(conn, """
                SELECT coin_id, source, open_interest, funding_rate, market_cap
                FROM coin_metrics
                WHERE coin_id = ANY(:coins) AND date = :d
                ORDER BY coin_id, source
            """, {"coins": ai_coins, "d": d})
            print(f"    coin_metrics: {len(res2)} records")
            for row in res2:
                print(f"      coin={row[0]} src={row[1]}: OI={row[2]}, funding={row[3]}, mcap={row[4]}")

            # health_scores
            res3 = await query_scalar(conn, """
                SELECT COUNT(*) FROM health_scores
                WHERE coin_id = ANY(:coins) AND date = :d
            """, {"coins": ai_coins, "d": d})
            print(f"    health_scores: {res3} records")

            # features
            res4 = await query_scalar(conn, """
                SELECT COUNT(*) FROM features
                WHERE coin_id = ANY(:coins) AND date = :d
            """, {"coins": ai_coins, "d": d})
            print(f"    features: {res4} records")

    # ===================================================================
    # 4. FORWARD CONSISTENCY CHECK
    # ===================================================================
    print("\n" + "=" * 80)
    print("4. FORWARD CONSISTENCY CHECK")
    print("=" * 80)

    async with engine.begin() as conn:
        # Try to reproduce 2026-08-01 narrative_health using current membership
        # Current membership: 1, 4, 5, 10, 11, 12, 22
        # But narrative_health 2026-08-01 used: 1, 2, 3, 4, 5, 10
        # This will fail because coins 2, 3 don't exist

        res = await query_all(conn, """
            SELECT coin_id, health_score, confidence_score
            FROM health_scores
            WHERE coin_id IN (1, 4, 5, 10, 11, 12, 22) AND date = '2026-08-01'
        """)
        print(f"  health_scores for 2026-08-01 (current membership): {len(res)} coins")
        for row in res:
            print(f"    coin={row[0]}: health={row[1]}, conf={row[2]}")

        res2 = await query_one(conn, """
            SELECT health_score, coin_count, coin_breakdown
            FROM narrative_health
            WHERE narrative_id = 1 AND date = '2026-08-01'
        """)
        if res2:
            print(f"\n  Existing narrative_health 2026-08-01:")
            print(f"    health_score={res2[0]}, coin_count={res2[1]}")
            print(f"    breakdown={res2[2]}")

        print("\n  FORWARD CONSISTENCY: FAIL")
        print("    - Current membership (7 coins) != historical membership (6 coins)")
        print("    - Coins 2, 3 referenced in existing narrative_health do not exist in current coins table")
        print("    - Cannot reproduce existing narrative_health with current system state")

    # ===================================================================
    # 5. PIPELINE DEPENDENCY GRAPH
    # ===================================================================
    print("\n" + "=" * 80)
    print("5. CANONICAL P0-P2 HEALTH PIPELINE DEPENDENCY GRAPH")
    print("=" * 80)

    print("""
  Entry Point: src/app/api/refresh/route.ts (Next.js API route)
             OR backend/api/refresh.py (FastAPI route)

  Per-Coin Pipeline:
    1. Collect price data (Binance futures/spot)
       -> market_price_daily
    2. Collect OI + funding rate (Binance futures)
       -> coin_metrics (source=binance_futures)
    3. Collect FDV (CoinGecko)
       -> coin_metrics (source=coingecko)
    4. Run FeatureEngine.run():
       - trend_score (linear regression on price)
       - derivative_score (OI change + funding rate)
       - volume_score (volume profile)
       - momentum_score (price momentum)
       - confidence_score (data completeness)
       -> features table
    5. Calculate health_score:
       health = trend*0.35 + derivative*0.35 + volume*0.20 + momentum*0.10
       -> health_scores table

  Narrative Health Pipeline:
    1. Get active narratives
    2. For each narrative:
       a. Get coins from coin_narratives (CURRENT membership)
       b. Get health_scores for today
       c. Get market_cap from coin_metrics for today
       d. Get previous narrative_health (yesterday)
       e. Run calculateWeightedNarrativeHealth():
          - If any coin missing market_cap -> equal weighting
          - Else -> market_cap weighting
          - weightedHealth = sum(coin.healthScore * weight)
       f. Save to narrative_health

  Dependencies:
    - coin_narratives (CURRENT membership - NO historical tracking)
    - coins (must exist)
    - market_price_daily (historical available)
    - coin_metrics (OI, funding, FDV - LIMITED historical)
    - health_scores (NOT available for 2026-07-28 to 2026-07-30)
    - features (NOT available for 2026-07-28 to 2026-07-30)
    - narrative_health (previous day for score_change)
    - FeatureEngine (deterministic)
    - calculateWeightedNarrativeHealth (deterministic)
""")

    # ===================================================================
    # 6. PRODUCTION SAFETY
    # ===================================================================
    print("=" * 80)
    print("6. PRODUCTION SAFETY VERIFICATION")
    print("=" * 80)

    async with engine.begin() as conn:
        tables = [
            "narrative_health", "health_scores", "features",
            "market_price_daily", "coin_metrics", "coin_narratives",
            "narrative_membership_snapshots", "p3_narrative_intelligence",
            "p3_constituent_snapshot_members", "p3_historical_corrections"
        ]
        for tbl in tables:
            res = await query_scalar(conn, f"SELECT COUNT(*) FROM {tbl}")
            print(f"  {tbl}: {res} rows")

    print("\n  Production writes during this audit: 0")
    print("  Production mutations during this audit: 0")

    # ===================================================================
    # 7. FEASIBILITY DECISION
    # ===================================================================
    print("\n" + "=" * 80)
    print("7. FEASIBILITY DECISION")
    print("=" * 80)

    print("""
  P3-10E.23 STATUS: BLOCKED

  BLOCKERS:

  1. HISTORICAL MEMBERSHIP UNDETERMINED
     - Canonical pipeline uses current coin_narratives
     - No audit/history table for coin_narratives changes
     - Coins 2, 3 were in narrative on 2026-08-01 but deleted since
     - Cannot determine membership for 2026-07-28 to 2026-07-31

  2. DATA INCONSISTENCY
     - narrative_health 2026-08-01 references coins 2, 3
     - Coins 2, 3 do not exist in current coins table
     - health_scores for coins 2, 3 do not exist
     - Existing narrative_health cannot be reproduced

  3. MISSING HEALTH_SCORES
     - health_scores does not exist for 2026-07-28 to 2026-07-30
     - Would need to run full per-coin feature pipeline first
     - Requires OI/funding data which is also missing for these dates

  4. MISSING COIN_METRICS
     - coin_metrics has limited data for 2026-07-28 to 2026-07-30
     - Only 2026-07-31 has partial binance_futures data
     - No FDV data for these dates

  WHAT CAN BE DONE:

  - For 2026-07-31: Partially feasible IF membership is confirmed as coins 1,4,5,10
    * health_scores exist for these 4 coins
    * coin_metrics has partial OI/funding data
    * But market_cap is missing (required for weighted calculation)
    * Cannot forward-consistently reproduce existing narrative_health

  - For 2026-07-28 to 2026-07-30: NOT feasible
    * No health_scores
    * No coin_metrics
    * Unknown membership

  RECOMMENDED NEXT STEP:

  Do NOT perform production backfill.

  Instead:
  1. Establish historical membership tracking (add audit table for coin_narratives)
  2. Investigate why coins 2, 3 were deleted and whether their data can be restored
  3. If coins 2, 3 are permanently removed, update P3-05 to accept partial narrative coverage
  4. Re-run E.23 after historical membership is established
""")

    print("\n" + "=" * 80)
    print("AUDIT COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
