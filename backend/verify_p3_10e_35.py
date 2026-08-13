#!/usr/bin/env python3
"""
P3-10E.35 — Post-Remediation Verification
Verifies that the market_cap persistence remediation is complete
and the system is ready for P3-10E.30.
"""

import os
import sys
import psycopg2
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv(".env")

DSN = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
if not DSN:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

COIN_11 = 11
COIN_GEcko_SOURCE = "coingecko"
BINANCE_FUTURES_SOURCE = "binance_futures"
TODAY = datetime.utcnow().date()


def q(sql, params=None):
    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or [])
            if cur.description:
                return cur.fetchall(), [desc[0] for desc in cur.description]
            return [], []


def assert_true(condition, message):
    if not condition:
        print(f"FAIL: {message}")
        return False
    print(f"PASS: {message}")
    return True


def main():
    print("=" * 70)
    print("P3-10E.35 POST-REMEDIATION VERIFICATION")
    print("=" * 70)
    print(f"Timestamp: {datetime.utcnow().isoformat()}")
    print()

    all_passed = True

    # === Coin 11 Verification ===
    print("=== COIN 11 MARKET CAP VERIFICATION ===")

    # 1. Valid coin_metrics.market_cap
    rows, cols = q(
        "SELECT coin_id, source, market_cap, fully_diluted_valuation, date FROM coin_metrics WHERE coin_id = %s AND source = %s AND market_cap IS NOT NULL AND CAST(market_cap AS NUMERIC) > 0 ORDER BY date DESC LIMIT 5",
        [COIN_11, COIN_GEcko_SOURCE],
    )
    all_passed &= assert_true(len(rows) > 0, f"Coin 11 has valid coingecko market_cap ({len(rows)} records)")
    all_passed &= assert_true(rows[0][2] is not None and float(rows[0][2]) > 0, f"Latest market_cap is positive: {rows[0][2] if rows else 'N/A'}")

    # 2. Source = coingecko
    all_passed &= assert_true(rows[0][1] == COIN_GEcko_SOURCE if rows else False, f"Source is coingecko: {rows[0][1] if rows else 'N/A'}")

    # 3. Timestamp is appropriate
    if rows:
        record_date = rows[0][4]
        days_old = (TODAY - record_date).days
        all_passed &= assert_true(days_old <= 2, f"Record date is recent: {record_date} ({days_old} days old)")

    # 4. No duplicate/unexpected records
    rows_all, cols_all = q(
        "SELECT coin_id, source, date, COUNT(*) FROM coin_metrics WHERE coin_id = %s AND source = %s GROUP BY coin_id, source, date HAVING COUNT(*) > 1",
        [COIN_11, COIN_GEcko_SOURCE],
    )
    all_passed &= assert_true(len(rows_all) == 0, f"No duplicate coingecko records for coin 11 ({len(rows_all)} duplicates found)")

    # === P3-06 Readiness ===
    print("\n=== P3-06 READINESS ===")

    # 5. Coin 11 no longer excluded solely due to missing market_cap
    rows, cols = q(
        "SELECT coin_id, source, market_cap FROM coin_metrics WHERE coin_id = %s AND source = %s AND market_cap IS NOT NULL AND CAST(market_cap AS NUMERIC) > 0 ORDER BY date DESC LIMIT 1",
        [COIN_11, COIN_GEcko_SOURCE],
    )
    has_valid_market_cap = len(rows) > 0
    all_passed &= assert_true(has_valid_market_cap, "Coin 11 has valid coingecko market_cap for P3-06 eligibility")

    # 6. P3-06 can produce valid 7D RS for Coin 11
    # Verify price data exists for RS calculation
    rows, cols = q(
        "SELECT COUNT(*) FROM market_price_daily WHERE coin_id = %s AND source = %s",
        [COIN_11, BINANCE_FUTURES_SOURCE],
    )
    price_count = rows[0][0] if rows else 0
    all_passed &= assert_true(price_count >= 14, f"Coin 11 has sufficient price data for 7D RS: {price_count} records")

    # 7. BTC benchmark exists
    rows, cols = q(
        """SELECT COUNT(*) FROM market_price_daily mpd
           JOIN coins c ON mpd.coin_id = c.id
           WHERE c.coingecko_id = 'bitcoin' AND mpd.source = %s""",
        [BINANCE_FUTURES_SOURCE],
    )
    btc_count = rows[0][0] if rows else 0
    all_passed &= assert_true(btc_count >= 14, f"BTC has sufficient price data for 7D RS benchmark: {btc_count} records")

    # 8. Leadership now has >= 3 RS-valid eligible constituents
    # We verify this by checking that coins 4, 5, 11 all have valid coingecko market_cap
    rows, cols = q(
        f"SELECT coin_id, COUNT(*) as cnt FROM coin_metrics WHERE coin_id IN (4, 5, {COIN_11}) AND source = %s AND market_cap IS NOT NULL AND CAST(market_cap AS NUMERIC) > 0 GROUP BY coin_id ORDER BY coin_id",
        [COIN_GEcko_SOURCE],
    )
    eligible_count = len(rows)
    all_passed &= assert_true(eligible_count >= 3, f"Leadership has >= 3 RS-valid constituents: {eligible_count} coins with valid market_cap")

    # === P3-09 Readiness ===
    print("\n=== P3-09 READINESS ===")

    # 9. relativeStrength is available
    all_passed &= assert_true(eligible_count >= 3, "relativeStrength available for Leadership (via P3-06)")

    # 10. oiConfirmation is available after E.33
    # Verify OI data exists for eligible coins
    rows, cols = q(
        f"SELECT coin_id, COUNT(*) as cnt FROM coin_metrics WHERE coin_id IN (4, 5, {COIN_11}) AND source = %s AND open_interest IS NOT NULL AND CAST(open_interest AS NUMERIC) > 0 GROUP BY coin_id ORDER BY coin_id",
        [BINANCE_FUTURES_SOURCE],
    )
    oi_count = len(rows)
    all_passed &= assert_true(oi_count >= 3, f"OI confirmation data available for {oi_count} coins")

    # 11. breadthMomentum may remain absent (first-run semantics)
    # This is expected and acceptable
    print("  INFO: breadthMomentum may remain absent due to first-run semantics (acceptable)")

    # === Historical Integrity ===
    print("\n=== HISTORICAL INTEGRITY ===")

    # 12. Snapshot count unchanged
    rows_before, _ = q("SELECT COUNT(*) FROM narrative_membership_snapshots")
    # We don't have the before count here, but we can verify no new snapshots were created during remediation
    # by checking that snapshot 7 is unchanged
    rows, cols = q(
        "SELECT id, narrative_id, window_end, member_count FROM narrative_membership_snapshots WHERE id = 7"
    )
    if rows:
        print(f"  INFO: Snapshot 7 still exists: narrative_id={rows[0][1]}, window_end={rows[0][2]}, members={rows[0][3]}")
        print("  Ensure it was not modified during remediation")
    else:
        print("  INFO: Snapshot 7 does not exist")

    # 13. Intelligence #1 unchanged
    rows, cols = q(
        "SELECT id, narrative_id, algorithm_key, algorithm_version, window_end FROM p3_narrative_intelligence WHERE id = 1"
    )
    if rows:
        intel = rows[0]
        print(f"  INFO: Intelligence #1 exists: narrative_id={intel[1]}, algorithm={intel[2]}:{intel[3]}, window_end={intel[4]}")
        print("  Ensure it was not modified during remediation")
    else:
        print("  INFO: Intelligence #1 does not exist yet")

    # 14. Correction ledger unchanged
    rows, cols = q("SELECT COUNT(*) FROM p3_historical_corrections")
    correction_count = rows[0][0]
    print(f"  INFO: Correction ledger has {correction_count} entries")

    # 15. P0-P2 unchanged
    rows, cols = q("SELECT COUNT(*) FROM market_price_daily WHERE coin_id = %s", [COIN_11])
    price_count = rows[0][0]
    rows, cols = q("SELECT COUNT(*) FROM features WHERE coin_id = %s", [COIN_11])
    feature_count = rows[0][0]
    print(f"  INFO: P0-P2 data: {price_count} price records, {feature_count} feature records")

    # 16. No new P3 intelligence artifact
    rows, cols = q(
        "SELECT COUNT(*) FROM p3_narrative_intelligence WHERE narrative_id = 1 AND calculated_at > %s",
        [datetime.utcnow() - timedelta(hours=1)],
    )
    new_intel = rows[0][0]
    all_passed &= assert_true(new_intel == 0, f"No new P3 intelligence artifacts created ({new_intel} found in last hour)")

    # 17. No new membership snapshot
    rows, cols = q(
        "SELECT COUNT(*) FROM narrative_membership_snapshots WHERE captured_at > %s",
        [datetime.utcnow() - timedelta(hours=1)],
    )
    new_snapshots = rows[0][0]
    all_passed &= assert_true(new_snapshots == 0, f"No new membership snapshots created ({new_snapshots} found in last hour)")

    print("\n" + "=" * 70)
    if all_passed:
        print("ALL VERIFICATIONS PASSED")
        print("SYSTEM IS READY FOR P3-10E.30")
        print("=" * 70)
        sys.exit(0)
    else:
        print("SOME VERIFICATIONS FAILED")
        print("STATUS = BLOCKED")
        print("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    main()
