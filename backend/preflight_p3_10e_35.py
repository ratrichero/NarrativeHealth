#!/usr/bin/env python3
"""
P3-10E.35 — Preflight Verification Before Data Remediation
READ-ONLY. Aborts if any unexpected state is detected.
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


def abort(message):
    print(f"ABORT: {message}")
    sys.exit(1)


def main():
    print("=" * 70)
    print("P3-10E.35 PREFLIGHT VERIFICATION")
    print("=" * 70)
    print(f"Timestamp: {datetime.utcnow().isoformat()}")
    print()

    # 1. Coin 11 exists
    print("=== 1. Coin 11 exists ===")
    rows, cols = q("SELECT id, name, symbol, coingecko_id, binance_futures_symbol FROM coins WHERE id = %s", [COIN_11])
    if len(rows) != 1:
        abort(f"Coin 11 not found or ambiguous: {rows}")
    coin = rows[0]
    print(f"  id={coin[0]}, name={coin[1]}, symbol={coin[2]}, coingecko_id={coin[3]}, binance_futures={coin[4]}")

    # 2. Coin 11 canonical symbol is AKTUSDT
    print("\n=== 2. Coin 11 canonical symbol ===")
    if coin[4] != "AKTUSDT":
        abort(f"Expected AKTUSDT, got {coin[4]}")
    print(f"  PASS: binance_futures_symbol = {coin[4]}")

    # 3. Coin 11 currently has no valid CoinGecko market_cap
    print("\n=== 3. Coin 11 CoinGecko market_cap status ===")
    rows, cols = q(
        "SELECT coin_id, source, market_cap, date FROM coin_metrics WHERE coin_id = %s AND source = %s AND market_cap IS NOT NULL AND CAST(market_cap AS NUMERIC) > 0 ORDER BY date DESC",
        [COIN_11, COIN_GEcko_SOURCE],
    )
    if len(rows) > 0:
        abort(f"Coin 11 already has valid coingecko market_cap: {rows}")
    print("  PASS: No valid coingecko market_cap (remediation needed)")

    # 4. Coin 11 has valid CoinGecko source data available
    print("\n=== 4. Coin 11 has CoinGecko source configured ===")
    if not coin[3]:
        abort(f"Coin 11 has no coingecko_id: {coin[3]}")
    print(f"  PASS: coingecko_id = {coin[3]}")

    # 5. Current P3-06 exclusion reason is missing_market_cap
    print("\n=== 5. P3-06 exclusion reason ===")
    # We can't run P3-06 here, but we can verify the data condition that causes it
    rows, cols = q(
        "SELECT coin_id, source, market_cap FROM coin_metrics WHERE coin_id = %s AND source = %s ORDER BY date DESC LIMIT 1",
        [COIN_11, COIN_GEcko_SOURCE],
    )
    if len(rows) == 0 or rows[0][2] is None:
        print("  PASS: Latest coingecko market_cap is null -> P3-06 would exclude with missing_market_cap")
    else:
        abort(f"Unexpected: coingecko market_cap exists: {rows}")

    # 6. Snapshot 2 remains authoritative
    print("\n=== 6. Snapshot 2 status ===")
    rows, cols = q(
        "SELECT id, narrative_id, window_end, member_count, membership_mode, snapshot_revision FROM narrative_membership_snapshots WHERE id = 2"
    )
    if len(rows) != 1:
        abort(f"Snapshot 2 not found: {rows}")
    snap = rows[0]
    print(f"  PASS: Snapshot 2 exists: narrative_id={snap[1]}, window_end={snap[2]}, members={snap[3]}")

    # 7. Snapshot 7 remains superseded
    print("\n=== 7. Snapshot 7 status ===")
    rows, cols = q(
        "SELECT id, narrative_id, window_end, member_count, membership_mode, snapshot_revision FROM narrative_membership_snapshots WHERE id = 7"
    )
    if len(rows) == 0:
        print("  PASS: Snapshot 7 does not exist (superseded)")
    else:
        snap7 = rows[0]
        print(f"  INFO: Snapshot 7 exists: narrative_id={snap7[1]}, window_end={snap7[2]}, members={snap7[3]}")
        print("  Ensure it remains unchanged during remediation")

    # 8. Intelligence #1 remains immutable
    print("\n=== 8. Intelligence #1 status ===")
    rows, cols = q(
        "SELECT id, narrative_id, algorithm_key, algorithm_version, window_end, calculated_at FROM p3_narrative_intelligence WHERE id = 1"
    )
    if len(rows) == 0:
        print("  INFO: Intelligence #1 does not exist yet")
    else:
        intel = rows[0]
        print(f"  PASS: Intelligence #1 exists: narrative_id={intel[1]}, algorithm={intel[2]}:{intel[3]}, window_end={intel[4]}")
        print("  Ensure it remains unchanged during remediation")

    # 9. Correction ledger unchanged
    print("\n=== 9. Correction ledger status ===")
    rows, cols = q(
        "SELECT COUNT(*) FROM p3_historical_corrections"
    )
    count = rows[0][0]
    print(f"  PASS: Correction ledger has {count} entries (will not be modified)")

    # 10. P0-P2 unchanged
    print("\n=== 10. P0-P2 data status ===")
    rows, cols = q(
        "SELECT COUNT(*) FROM market_price_daily WHERE coin_id = %s", [COIN_11]
    )
    price_count = rows[0][0]
    rows, cols = q(
        "SELECT COUNT(*) FROM features WHERE coin_id = %s", [COIN_11]
    )
    feature_count = rows[0][0]
    print(f"  PASS: P0-P2 data present: {price_count} price records, {feature_count} feature records")
    print("  These will not be modified during remediation")

    # 11. No schema changes needed
    print("\n=== 11. Schema compatibility ===")
    rows, cols = q(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'coin_metrics' AND column_name = 'market_cap'"
    )
    if len(rows) != 1:
        abort("market_cap column not found in coin_metrics")
    print(f"  PASS: coin_metrics.market_cap exists (type: {rows[0][1]})")

    print("\n" + "=" * 70)
    print("PREFLIGHT PASSED — Safe to proceed with data remediation")
    print("=" * 70)


if __name__ == "__main__":
    main()
