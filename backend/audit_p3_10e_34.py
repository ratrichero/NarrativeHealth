#!/usr/bin/env python3
"""
P3-10E.34 — Coin 11 Market Cap Forensic Audit
READ-ONLY. No mutations.
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv(".env")

DSN = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
if not DSN:
    print("ERROR: DATABASE_URL not set")
    sys.exit(1)

COIN_11 = 11
COIN_IDS = [1, 4, 5, 10, 11, 12, 22]


def q(sql, params=None):
    with psycopg2.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or [])
            if cur.description:
                return cur.fetchall(), [desc[0] for desc in cur.description]
            return [], []


def main():
    print("=" * 70)
    print("P3-10E.34 COIN 11 MARKET CAP FORENSIC AUDIT")
    print("=" * 70)
    print(f"Timestamp: {__import__('datetime').datetime.now().isoformat()}")
    print()

    # 1. All market_cap records for coin 11
    print("=== 1. ALL MARKET_CAP RECORDS FOR COIN 11 ===")
    rows, cols = q(
        "SELECT coin_id, source, market_cap, date FROM coin_metrics WHERE coin_id = %s ORDER BY source, date DESC",
        [COIN_11],
    )
    for r in rows:
        print(f"  source={r[1]}, market_cap={r[2]}, date={r[3]}")

    # 2. Market cap for all AI constituents
    print("\n=== 2. MARKET CAP COVERAGE FOR ALL AI CONSTITUENTS ===")
    rows, cols = q(
        f"SELECT coin_id, source, COUNT(*) as cnt, MIN(date) as min_date, MAX(date) as max_date FROM coin_metrics WHERE coin_id IN ({','.join(['%s']*len(COIN_IDS))}) AND market_cap IS NOT NULL GROUP BY coin_id, source ORDER BY coin_id, source",
        COIN_IDS,
    )
    for r in rows:
        print(f"  coin {r[0]}: source={r[1]}, count={r[2]}, range={r[3]} to {r[4]}")

    # 3. Check if binance_futures market_cap is actually market cap or something else
    print("\n=== 3. COIN_11 BINANCE_FUTURES MARKET_CAP VALUE QUALITY ===")
    rows, cols = q(
        "SELECT date, market_cap FROM coin_metrics WHERE coin_id = %s AND source = 'binance_futures' AND market_cap IS NOT NULL ORDER BY date DESC LIMIT 10",
        [COIN_11],
    )
    for r in rows:
        print(f"  date={r[0]}, market_cap={r[1]}")

    # 4. Check if there are any other sources with market_cap for coin 11
    print("\n=== 4. ALL SOURCES FOR COIN 11 ===")
    rows, cols = q(
        "SELECT DISTINCT source FROM coin_metrics WHERE coin_id = %s ORDER BY source",
        [COIN_11],
    )
    for r in rows:
        print(f"  source={r[0]}")

    # 5. Check coin_metrics schema to understand what fields exist
    print("\n=== 5. COIN_METRICS SCHEMA FOR COIN 11 ===")
    rows, cols = q(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'coin_metrics' ORDER BY ordinal_position",
    )
    for r in rows:
        print(f"  {r[0]}: {r[1]}")

    # 6. Check if coingecko market_cap for coin 11 exists in any form
    print("\n=== 6. COINGECKO MARKET_CAP DETAILS FOR COIN 11 ===")
    rows, cols = q(
        "SELECT date, market_cap, open_interest, fully_diluted_valuation, circulating_supply FROM coin_metrics WHERE coin_id = %s AND source = 'coingecko' ORDER BY date DESC LIMIT 20",
        [COIN_11],
    )
    for r in rows:
        print(f"  date={r[0]}, market_cap={r[1]}, oi={r[2]}, fdv={r[3]}, circ={r[4]}")

    # 7. Check if there is a way to determine if binance_futures market_cap is real
    print("\n=== 7. COIN 11 BINANCE_FUTURES vs COINGECKO COMPARISON ===")
    rows, cols = q(
        """SELECT 
            bf.date, 
            bf.market_cap as bf_market_cap, 
            cg.market_cap as cg_market_cap,
            bf.open_interest as bf_oi,
            cg.open_interest as cg_oi
          FROM coin_metrics bf
          LEFT JOIN coin_metrics cg 
            ON bf.coin_id = cg.coin_id 
            AND bf.date = cg.date 
            AND cg.source = 'coingecko'
          WHERE bf.coin_id = %s 
            AND bf.source = 'binance_futures'
            AND bf.market_cap IS NOT NULL
          ORDER BY bf.date DESC
          LIMIT 20""",
        [COIN_11],
    )
    for r in rows:
        print(f"  date={r[0]}, bf_mcap={r[1]}, cg_mcap={r[2]}, bf_oi={r[3]}, cg_oi={r[4]}")

    # 8. Check coins table for coin 11 metadata
    print("\n=== 8. COIN 11 METADATA ===")
    rows, cols = q(
        "SELECT id, name, symbol, coingecko_id, binance_futures_symbol FROM coins WHERE id = %s",
        [COIN_11],
    )
    for r in rows:
        print(f"  id={r[0]}, name={r[1]}, symbol={r[2]}, coingecko_id={r[3]}, binance_futures={r[4]}")

    # 9. Check if any other P3 module uses binance_futures market_cap
    print("\n=== 9. P3 CODE SOURCES FOR MARKET_CAP ===")
    print("  P3_MARKET_CAP_SOURCE = 'coingecko' (defined in relative-strength.ts)")
    print("  P3_FUTURES_PRICE_SOURCE = 'binance_futures' (defined in relative-strength.ts)")
    print("  loadRelativeStrengthInputs() filters by P3_MARKET_CAP_SOURCE")
    print("  prepareLeadershipInputs() uses constituent.inputManifest.marketCap")

    # 10. Summary
    print("\n=== 10. SUMMARY ===")
    cg_cap_rows, _ = q(
        "SELECT COUNT(*) FROM coin_metrics WHERE coin_id = %s AND source = 'coingecko' AND market_cap IS NOT NULL",
        [COIN_11],
    )
    bf_cap_rows, _ = q(
        "SELECT COUNT(*) FROM coin_metrics WHERE coin_id = %s AND source = 'binance_futures' AND market_cap IS NOT NULL",
        [COIN_11],
    )
    print(f"  coingecko market_cap records: {cg_cap_rows[0][0]}")
    print(f"  binance_futures market_cap records: {bf_cap_rows[0][0]}")

    if cg_cap_rows[0][0] == 0 and bf_cap_rows[0][0] > 0:
        print("\n  CONCLUSION: Coin 11 has NO coingecko market_cap data.")
        print("  binance_futures HAS market_cap data.")
        print("  Need to determine if binance_futures market_cap is canonical.")


if __name__ == "__main__":
    main()
