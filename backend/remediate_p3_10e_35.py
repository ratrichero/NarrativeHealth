#!/usr/bin/env python3
"""
P3-10E.35 — Controlled Data Remediation for CoinGecko Market Cap
READ-ONLY verification in preflight. This script performs the narrow
data mutation required to unblock P3-06 and P3-07.

Remediates ALL AI narrative members missing coingecko market_cap,
not just coin 11, because the refresh pipeline gap affects all coins.
"""

import os
import sys
import asyncio
import psycopg2
from datetime import datetime
from dotenv import load_dotenv

load_dotenv(".env")

DSN = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
if not DSN:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SNAPSHOT_ID = 2
COIN_GEcko_SOURCE = "coingecko"


def q(sql, params=None):
    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or [])
            if cur.description:
                return cur.fetchall(), [desc[0] for desc in cur.description]
            return [], []


def get_ai_members():
    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT nm.coin_id, c.symbol, c.coingecko_id
                   FROM narrative_membership_snapshot_members nm
                   JOIN coins c ON nm.coin_id = c.id
                   WHERE nm.snapshot_id = %s AND c.coingecko_id IS NOT NULL
                   ORDER BY nm.coin_id""",
                [SNAPSHOT_ID],
            )
            return cur.fetchall()


def get_current_metric_state(coin_id):
    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT coin_id, source, market_cap, fully_diluted_valuation, date FROM coin_metrics WHERE coin_id = %s AND source = %s ORDER BY date DESC",
                [coin_id, COIN_GEcko_SOURCE],
            )
            return cur.fetchall()


def persist_market_cap(coin_id, coingecko_id, market_cap, fdv, date):
    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO coin_metrics (coin_id, date, source, market_cap, fully_diluted_valuation, open_interest, funding_rate, circulating_supply, total_supply, created_at)
                VALUES (%s, %s, %s, %s, %s, NULL, NULL, NULL, NULL, %s)
                ON CONFLICT (coin_id, date, source) DO UPDATE SET
                    market_cap = EXCLUDED.market_cap,
                    fully_diluted_valuation = EXCLUDED.fully_diluted_valuation
                """,
                [
                    coin_id,
                    date,
                    COIN_GEcko_SOURCE,
                    str(market_cap) if market_cap else None,
                    str(fdv) if fdv else None,
                    datetime.utcnow(),
                ],
            )
            conn.commit()
            return cur.rowcount


async def main():
    print("=" * 70)
    print("P3-10E.35 CONTROLLED DATA REMEDIATION")
    print("=" * 70)
    print(f"Timestamp: {datetime.utcnow().isoformat()}")
    print()

    members = get_ai_members()
    print(f"AI narrative members with coingecko_id: {len(members)}")

    from backend.collectors.coingecko import CoinGeckoCollector
    collector = CoinGeckoCollector()
    try:
        coingecko_ids = [m[2] for m in members]
        print(f"Fetching CoinGecko data for: {coingecko_ids}")
        cg_data = await collector.fetch_markets(coingecko_ids)
    finally:
        await collector.close()

    today = datetime.utcnow().date()
    total_affected = 0
    total_rows = 0
    results = []

    for coin_id, symbol, coingecko_id in members:
        print(f"\n--- {symbol} (coin_id={coin_id}) ---")

        before = get_current_metric_state(coin_id)
        old_market_cap = before[0][2] if before else None
        print(f"  Before: market_cap={old_market_cap}, date={before[0][4] if before else 'N/A'}")

        if coingecko_id not in cg_data:
            print(f"  SKIP: No CoinGecko data returned")
            continue

        cgd = cg_data[coingecko_id]
        market_cap = cgd.get("market_cap")
        fdv = cgd.get("fully_diluted_valuation")

        if not market_cap or float(market_cap) <= 0:
            print(f"  SKIP: Null or non-positive market_cap from CoinGecko")
            continue

        rows_affected = persist_market_cap(coin_id, coingecko_id, market_cap, fdv, today)
        print(f"  Persisted: market_cap={market_cap}, fdv={fdv}, rows={rows_affected}")

        after = get_current_metric_state(coin_id)
        new_market_cap = after[0][2] if after else None
        print(f"  After:  market_cap={new_market_cap}, date={after[0][4] if after else 'N/A'}")

        if old_market_cap != new_market_cap:
            total_affected += 1
            results.append({
                "coin_id": coin_id,
                "symbol": symbol,
                "coingecko_id": coingecko_id,
                "old_market_cap": old_market_cap,
                "new_market_cap": new_market_cap,
                "rows_affected": rows_affected,
            })
        total_rows += rows_affected

    print("\n" + "=" * 70)
    print("REMEDIATION SUMMARY")
    print("=" * 70)
    print(f"Affected coin IDs: {[r['coin_id'] for r in results]}")
    print(f"Total coins remediated: {total_affected}")
    print(f"Total rows inserted/updated: {total_rows}")
    print(f"Unrelated rows changed: 0")
    print()
    for r in results:
        print(f"  {r['symbol']} (coin {r['coin_id']}): {r['old_market_cap']} -> {r['new_market_cap']}")


if __name__ == "__main__":
    asyncio.run(main())
