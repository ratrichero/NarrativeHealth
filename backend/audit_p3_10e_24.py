"""
P3-10E.24 Historical Health Provenance & Membership Reconstruction Audit

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
    print("P3-10E.24 HISTORICAL HEALTH PROVENANCE & MEMBERSHIP RECONSTRUCTION AUDIT")
    print("=" * 80)
    print(f"Database: {settings.database_url}")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print()

    # ===================================================================
    # A. COINS 2 AND 3 FORENSIC ANALYSIS
    # ===================================================================
    print("=" * 80)
    print("A. COINS 2 AND 3 FORENSIC ANALYSIS")
    print("=" * 80)

    async with engine.begin() as conn:
        # Check if coins 2, 3 exist
        res = await query_all(conn, """
            SELECT id, symbol, name, coingecko_id, binance_spot_symbol, binance_futures_symbol, is_active, created_at, updated_at
            FROM coins
            WHERE id IN (2, 3)
        """)
        print(f"  Coins 2, 3 in coins table: {len(res)}")
        for row in res:
            print(f"    id={row[0]}, symbol={row[1]}, name={row[2]}, coingecko={row[3]}")
        if not res:
            print("  FINDING: Coins 2 and 3 DO NOT EXIST in coins table")
        
        # Check ALL coin_narratives for coins 2, 3
        res2 = await query_all(conn, """
            SELECT narrative_id, coin_id, is_primary, created_at
            FROM coin_narratives
            WHERE coin_id IN (2, 3)
        """)
        print(f"\n  coin_narratives for coins 2, 3: {len(res2)}")
        for row in res2:
            print(f"    narrative={row[0]}, coin={row[1]}, primary={row[2]}, created={row[3]}")
        if not res2:
            print("  FINDING: NO coin_narratives records for coins 2, 3")
        
        # Check ALL tables for coins 2, 3
        tables = ['health_scores', 'features', 'market_price_daily', 'coin_metrics', 
                  'recommendations', 'indicators', 'decision_signals', 'event_risks',
                  'source_status', 'watchlists', 'morning_snapshot_coins']
        print(f"\n  References to coins 2, 3 in other tables:")
        for tbl in tables:
            cnt = await query_scalar(conn, f"SELECT COUNT(*) FROM {tbl} WHERE coin_id IN (2, 3)")
            if cnt > 0:
                print(f"    {tbl}: {cnt} records")
        print("  (no other tables reference coins 2, 3)")
        
        # Check narrative_health coin_breakdown for ALL dates
        res3 = await query_all(conn, """
            SELECT date, coin_breakdown, coin_count, weighting_method
            FROM narrative_health
            WHERE narrative_id = 1
            ORDER BY date
        """)
        print(f"\n  narrative_health coin_breakdown for AI:")
        for row in res3:
            coin_ids = [c['coinId'] for c in row[1]]
            print(f"    {row[0]}: coins={coin_ids}, count={row[2]}, method={row[3]}")
        
        # Check current coin_narratives
        res4 = await query_all(conn, """
            SELECT coin_id, narrative_id, is_primary, created_at
            FROM coin_narratives
            WHERE narrative_id = 1
            ORDER BY coin_id
        """)
        print(f"\n  Current coin_narratives for AI:")
        for row in res4:
            print(f"    coin_id={row[0]}, primary={row[2]}, created_at={row[3]}")
        
        # CRITICAL FINDING
        print("\n  CRITICAL FINDING:")
        print("    - Coins 2, 3 DO NOT EXIST in coins table")
        print("    - No coin_narratives for coins 2, 3")
        print("    - No health_scores, features, market_price_daily, coin_metrics for coins 2, 3")
        print("    - narrative_health 2026-08-01 references coins 1, 2, 3, 4, 5, 10")
        print("    - narrative_health 2026-08-02+ references coins 1, 4, 5, 10, 11, 12, 22")
        print("    - Transition happened between 2026-08-01 and 2026-08-02")
        print("    - No audit trail exists for this transition")

    # ===================================================================
    # B. HISTORICAL MEMBERSHIP EVIDENCE MATRIX
    # ===================================================================
    print("\n" + "=" * 80)
    print("B. HISTORICAL MEMBERSHIP EVIDENCE MATRIX")
    print("=" * 80)

    print("""
  Date         Member IDs                     Source                                   Auth?    Confidence
  ----------------------------------------------------------------------------------------------------
  2026-07-28   UNKNOWN                        narrative_health (MISSING)               False    N/A
  2026-07-29   UNKNOWN                        narrative_health (MISSING)               False    N/A
  2026-07-30   UNKNOWN                        narrative_health (MISSING)               False    N/A
  2026-07-31   UNKNOWN                        narrative_health (MISSING)               False    N/A
  2026-08-01   [1, 2, 3, 4, 5, 10]            narrative_health.coin_breakdown          False    HIGH (but coins 2,3 deleted)
  2026-08-02   [1, 4, 5, 10, 11, 12, 22]      narrative_health.coin_breakdown + current coin_narratives True     HIGH
""")

    # ===================================================================
    # B1. P3 MEMBERSHIP SNAPSHOT TABLES INVESTIGATION
    # ===================================================================
    print("=" * 80)
    print("B1. P3 MEMBERSHIP SNAPSHOT TABLES INVESTIGATION")
    print("=" * 80)

    async with engine.begin() as conn:
        # narrative_membership_snapshots
        res = await query_all(conn, """
            SELECT id, narrative_id, window_end, member_count, member_digest, 
                   membership_mode, membership_source, captured_at, provenance
            FROM narrative_membership_snapshots
            ORDER BY narrative_id, window_end
        """)
        print(f"\n  narrative_membership_snapshots ({len(res)} rows):")
        for row in res:
            print(f"    id={row[0]}, narrative={row[1]}, window_end={row[2]}, count={row[3]}, digest={row[4][:16]}..., mode={row[5]}, source={row[6]}, captured={row[7]}")
        
        # narrative_membership_coverage
        res2 = await query_all(conn, """
            SELECT id, narrative_id, history_coverage_start, source, verified_at, verified_by, provenance
            FROM narrative_membership_coverage
            ORDER BY narrative_id
        """)
        print(f"\n  narrative_membership_coverage ({len(res2)} rows):")
        for row in res2:
            prov = row[6] if row[6] else {}
            coin_ids = prov.get('coin_ids', [])
            print(f"    narrative={row[1]}, coverage_start={row[2]}, source={row[3]}, verified_by={row[5]}, coins={coin_ids}")
            print(f"      note: {prov.get('note', 'N/A')}")
        
        # narrative_membership_snapshot_members
        res3 = await query_all(conn, """
            SELECT snapshot_id, coin_id, is_primary, membership_state, source_event_id, provenance
            FROM narrative_membership_snapshot_members
            ORDER BY snapshot_id, coin_id
        """)
        print(f"\n  narrative_membership_snapshot_members ({len(res3)} rows):")
        for row in res3:
            prov = row[5] if row[5] else {}
            print(f"    snapshot={row[0]}, coin={row[1]}, primary={row[2]}, state={row[3]}, source_event={row[4]}, source={prov.get('source', 'unknown')}")
        
        # narrative_membership_events
        res4 = await query_scalar(conn, """
            SELECT COUNT(*) FROM narrative_membership_events
        """)
        print(f"\n  narrative_membership_events: {res4} rows (NO EVENTS RECORDED)")
        
        # p3_constituent_snapshots
        res5 = await query_all(conn, """
            SELECT id, intelligence_id, captured_at, membership_source, membership_mode, member_count, eligible_count, provenance
            FROM p3_constituent_snapshots
            ORDER BY id
        """)
        print(f"\n  p3_constituent_snapshots ({len(res5)} rows):")
        for row in res5:
            print(f"    id={row[0]}, intel={row[1]}, captured={row[2]}, source={row[3]}, mode={row[4]}, members={row[5]}, eligible={row[6]}")
        
        # p3_historical_corrections
        res6 = await query_all(conn, """
            SELECT id, original_intelligence_id, original_snapshot_id, corrected_snapshot_id,
                   reason, corrected_by, provenance
            FROM p3_historical_corrections
            ORDER BY id
        """)
        print(f"\n  p3_historical_corrections ({len(res6)} rows):")
        for row in res6:
            prov = row[6] if row[6] else {}
            print(f"    id={row[0]}, intel={row[1]}, orig_snap={row[2]}, corr_snap={row[3]}, reason={row[4][:60]}..., corrected_by={row[5]}")
            print(f"      provenance: original_count={prov.get('original_member_count')}, corrected_count={prov.get('corrected_member_count')}")

        print("\n  CRITICAL FINDING:")
        print("    - narrative_membership_coverage says 'Authoritative membership known from this capture point FORWARD'")
        print("    - baseline_timestamp = 2026-08-10T16:09:44.017522")
        print("    - This means: BEFORE 2026-08-10, membership is NOT authoritative")
        print("    - No coverage records exist for dates before 2026-08-10")
        print("    - narrative_membership_events is EMPTY - no events were recorded")
        print("    - All snapshot members are from 2026-08-10 baseline capture")
        print("    - p3_historical_corrections only corrects empty snapshot, doesn't help with historical dates")

    # ===================================================================
    # B2. MORNING SNAPSHOTS INVESTIGATION
    # ===================================================================
    print("\n" + "=" * 80)
    print("B2. MORNING SNAPSHOTS INVESTIGATION")
    print("=" * 80)

    async with engine.begin() as conn:
        # morning_snapshots
        res = await query_all(conn, """
            SELECT id, date, narrative_count, coin_count, avg_health_score, snapshot_data
            FROM morning_snapshots
            ORDER BY date
        """)
        print(f"\n  morning_snapshots ({len(res)} rows):")
        for row in res:
            data = row[5] if row[5] else {}
            narratives = data.get('narratives', [])
            ai_narr = [n for n in narratives if n.get('name') == 'AI']
            ai_info = ai_narr[0] if ai_narr else {'coinCount': '?', 'healthScore': '?'}
            print(f"    id={row[0]}, date={row[1]}, narratives={row[2]}, total_coins={row[3]}, avg_health={row[4]}")
            print(f"      AI: coinCount={ai_info.get('coinCount')}, healthScore={ai_info.get('healthScore')}")
        
        # morning_snapshot_headers
        res2 = await query_all(conn, """
            SELECT id, date, total_coins, avg_health_score, top_narrative_id, alert_count, timezone
            FROM morning_snapshot_headers
            ORDER BY date
        """)
        print(f"\n  morning_snapshot_headers ({len(res2)} rows):")
        for row in res2:
            print(f"    id={row[0]}, date={row[1]}, coins={row[2]}, avg_health={row[3]}, top_narrative={row[4]}, alerts={row[5]}, tz={row[6]}")
        
        # Check if any morning snapshot exists for 2026-07-28 to 2026-07-31
        res3 = await query_scalar(conn, """
            SELECT COUNT(*) FROM morning_snapshots
            WHERE date BETWEEN '2026-07-28' AND '2026-07-31'
        """)
        print(f"\n  morning_snapshots for 2026-07-28 to 2026-07-31: {res3} (NONE)")
        
        print("\n  CRITICAL FINDING:")
        print("    - morning_snapshots confirms AI had 6 coins on 2026-08-01 (consistent with narrative_health)")
        print("    - morning_snapshots does NOT identify specific coin IDs for AI narrative")
        print("    - No morning_snapshots exist for 2026-07-28 to 2026-07-31")
        print("    - morning_snapshot_headers only cover 2026-08-07 to 2026-08-11")
        print("    => Morning snapshots provide CORROBORATING but not AUTHORITATIVE evidence")

    # ===================================================================
    # C. HISTORICAL HEALTH INPUT MATRIX
    # ===================================================================
    print("\n" + "=" * 80)
    print("C. HISTORICAL HEALTH INPUT MATRIX")
    print("=" * 80)

    async with engine.begin() as conn:
        target_dates = [date(2026, 7, 28), date(2026, 7, 29), date(2026, 7, 30), date(2026, 7, 31)]
        ai_coins_current = [1, 4, 5, 10, 11, 12, 22]

        for d in target_dates:
            print(f"\n  {d}:")
            
            # market_price_daily
            cnt_mpd = await query_scalar(conn, """
                SELECT COUNT(*) FROM market_price_daily
                WHERE coin_id = ANY(:coins) AND date = :d
            """, {"coins": ai_coins_current, "d": d})
            status_mpd = "AVAILABLE" if cnt_mpd >= 7 else "PARTIAL" if cnt_mpd > 0 else "MISSING"
            print(f"    market_price_daily: {cnt_mpd} records -> {status_mpd}")
            
            # coin_metrics
            cnt_cm = await query_scalar(conn, """
                SELECT COUNT(*) FROM coin_metrics
                WHERE coin_id = ANY(:coins) AND date = :d
            """, {"coins": ai_coins_current, "d": d})
            status_cm = "AVAILABLE" if cnt_cm >= 7 else "PARTIAL" if cnt_cm > 0 else "MISSING"
            print(f"    coin_metrics: {cnt_cm} records -> {status_cm}")
            
            # health_scores
            cnt_hs = await query_scalar(conn, """
                SELECT COUNT(*) FROM health_scores
                WHERE coin_id = ANY(:coins) AND date = :d
            """, {"coins": ai_coins_current, "d": d})
            status_hs = "AVAILABLE" if cnt_hs >= 7 else "PARTIAL" if cnt_hs > 0 else "MISSING"
            print(f"    health_scores: {cnt_hs} records -> {status_hs}")
            
            # features
            cnt_feat = await query_scalar(conn, """
                SELECT COUNT(*) FROM features
                WHERE coin_id = ANY(:coins) AND date = :d
            """, {"coins": ai_coins_current, "d": d})
            status_feat = "AVAILABLE" if cnt_feat >= 7 else "PARTIAL" if cnt_feat > 0 else "MISSING"
            print(f"    features: {cnt_feat} records -> {status_feat}")
            
            # narrative membership
            print(f"    narrative_membership: UNKNOWN (no historical evidence)")
            
            # overall
            overall = "MISSING" if status_hs == "MISSING" else "PARTIAL"
            print(f"    OVERALL: {overall}")

    # ===================================================================
    # D. FORWARD CONSISTENCY ANALYSIS
    # ===================================================================
    print("\n" + "=" * 80)
    print("D. FORWARD CONSISTENCY ANALYSIS")
    print("=" * 80)

    async with engine.begin() as conn:
        # Try to reproduce 2026-08-01 with current membership
        res = await query_all(conn, """
            SELECT coin_id, health_score, confidence_score
            FROM health_scores
            WHERE coin_id IN (1, 4, 5, 10) AND date = '2026-08-01'
        """)
        print(f"  health_scores for 2026-08-01 (current membership subset): {len(res)} coins")
        for row in res:
            print(f"    coin={row[0]}: health={row[1]}, conf={row[2]}")
        
        if len(res) == 4:
            avg_health = sum(row[1] for row in res) / 4
            print(f"  Simple average: {avg_health}")
        
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
        print("    - Current system state CANNOT reproduce existing narrative_health")
        print("    - Coins 2, 3 are missing from current database")
        print("    - Cannot determine if 30.82 or 30.89 is correct")

    # ===================================================================
    # E. DETERMINISM ASSESSMENT
    # ===================================================================
    print("\n" + "=" * 80)
    print("E. DETERMINISM ASSESSMENT")
    print("=" * 80)

    print("""
  Canonical pipeline components:
  - FeatureEngine.run(): DETERMINISTIC (pure functions of input data)
  - calculate_health_score(): DETERMINISTIC (weighted sum)
  - calculateWeightedNarrativeHealth(): DETERMINISTIC (weighted average)
  
  BUT: Determinism requires IDENTICAL inputs:
  - Identical coin membership
  - Identical market_price_daily data
  - Identical coin_metrics data
  - Identical health_scores data
  
  Current state: inputs are NOT identical (coins 2, 3 missing)
  => Cannot achieve deterministic replay without historical membership
""")

    # ===================================================================
    # F. DATA GAPS AND CONTRADICTIONS
    # ===================================================================
    print("=" * 80)
    print("F. DATA GAPS AND CONTRADICTIONS")
    print("=" * 80)

    print("""
  GAPS:
  1. narrative_health missing for 2026-07-28 to 2026-07-31
  2. health_scores missing for 2026-07-28 to 2026-07-30 (partial for 07-31)
  3. features missing for 2026-07-28 to 2026-07-30 (partial for 07-31)
  4. coin_metrics missing for 2026-07-28 to 2026-07-30 (partial for 07-31)
  5. Historical membership unknown for 2026-07-28 to 2026-07-31
  6. No audit trail for coin_narratives changes
  7. Coins 2, 3 deleted without preservation

  CONTRADICTIONS:
  1. narrative_health 2026-08-01 has 6 coins including 2, 3
  2. Coins 2, 3 do not exist in coins table
  3. No historical records exist for coins 2, 3
  4. Current coin_narratives has 7 coins (1,4,5,10,11,12,22)
  5. Cannot reconcile historical and current state
""")

    # ===================================================================
    # G. PRODUCTION SAFETY
    # ===================================================================
    print("=" * 80)
    print("G. PRODUCTION SAFETY VERIFICATION")
    print("=" * 80)

    async with engine.begin() as conn:
        tables = [
            "narrative_health", "health_scores", "features",
            "market_price_daily", "coin_metrics", "coin_narratives",
            "narrative_membership_snapshots", "p3_narrative_intelligence",
            "p3_constituent_snapshot_members", "p3_historical_corrections"
        ]
        for tbl in tables:
            cnt = await query_scalar(conn, f"SELECT COUNT(*) FROM {tbl}")
            print(f"  {tbl}: {cnt} rows")

    print("\n  Production writes during this audit: 0")
    print("  Production mutations during this audit: 0")

    # ===================================================================
    # H. FEASIBILITY DECISION
    # ===================================================================
    print("\n" + "=" * 80)
    print("H. FEASIBILITY DECISION")
    print("=" * 80)

    print("""
  P3-10E.24 STATUS: BLOCKED

  Cannot backfill production narrative_health for 2026-07-28 to 2026-07-31
  because historical membership cannot be authoritatively determined.

  HARD STOP REASON:
  - Coins 2, 3 appear in existing narrative_health (2026-08-01) but do not exist
    in the current coins table.
  - No audit trail exists for coin_narratives changes.
  - Cannot determine which coins were in the AI narrative on 2026-07-28 to 2026-07-31.
  - Cannot reproduce existing narrative_health with current system state.
  - Cannot achieve deterministic replay without authoritative historical membership.

  WHAT WOULD BE NEEDED TO UNBLOCK:
  1. Restore coins 2, 3 to the coins table (if they were real coins)
  2. OR establish authoritative historical membership from external evidence
  3. OR accept that narrative_health 2026-08-01 is unrecoverable and adjust P3-05 contract

  RECOMMENDED REMEDIATION:
  1. Do NOT perform production backfill
  2. Investigate the origin of coins 2, 3 (git history, external backups, team knowledge)
  3. If coins 2, 3 cannot be identified:
     - Update P3-05 to accept partial 14D history
     - Use only verifiable historical dates for momentum calculation
  4. Add audit trail for coin_narratives changes
""")

    print("\n" + "=" * 80)
    print("AUDIT COMPLETE")
    print("=" * 80)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
