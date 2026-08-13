"""
P3-10E.12 Pre-flight Data Availability Audit
Verify 2026-08-11 data exists for all required sources.
"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine
from backend.config import settings

MEMBERS = [1, 4, 5, 10, 11, 12, 22]
BTC_ID = 17


async def main():
    print("=" * 60)
    print("P3-10E.12 PRE-FLIGHT DATA AVAILABILITY AUDIT")
    print("=" * 60)
    print(f"Database: {settings.database_url}")
    print()

    async with engine.begin() as conn:
        # 1. market_price_daily for AI members
        print("## 1. market_price_daily (AI members)")
        for coin_id in MEMBERS:
            res = await conn.execute(text("""
                SELECT MAX(date), COUNT(*) FROM market_price_daily
                WHERE coin_id = :cid AND date >= '2026-08-11'
            """), {'cid': coin_id})
            row = res.fetchone()
            has_0811 = "YES" if row[0] else "NO"
            print(f"  coin_id={coin_id}: 2026-08-11 data={has_0811} (latest={row[0]}, count={row[1]})")

        # 2. indicators for AI members
        print("\n## 2. indicators (AI members)")
        for coin_id in MEMBERS:
            res = await conn.execute(text("""
                SELECT MAX(date), COUNT(*) FROM indicators
                WHERE coin_id = :cid AND date >= '2026-08-11'
            """), {'cid': coin_id})
            row = res.fetchone()
            has_0811 = "YES" if row[0] else "NO"
            print(f"  coin_id={coin_id}: 2026-08-11 data={has_0811} (latest={row[0]}, count={row[1]})")

        # 3. narrative_health for AI
        print("\n## 3. narrative_health (AI)")
        res = await conn.execute(text("""
            SELECT MAX(date), COUNT(*) FROM narrative_health
            WHERE narrative_id = 1 AND date >= '2026-08-11'
        """))
        row = res.fetchone()
        has_0811 = "YES" if row[0] else "NO"
        print(f"  narrative_id=1: 2026-08-11 data={has_0811} (latest={row[0]}, count={row[1]})")

        # 4. coin_metrics for AI members
        print("\n## 4. coin_metrics (AI members)")
        for coin_id in MEMBERS:
            res = await conn.execute(text("""
                SELECT MAX(date), COUNT(*) FROM coin_metrics
                WHERE coin_id = :cid AND date >= '2026-08-11'
            """), {'cid': coin_id})
            row = res.fetchone()
            has_0811 = "YES" if row[0] else "NO"
            print(f"  coin_id={coin_id}: 2026-08-11 data={has_0811} (latest={row[0]}, count={row[1]})")

        # 5. BTC benchmark
        print("\n## 5. BTC Benchmark (coin_id=17)")
        res = await conn.execute(text("""
            SELECT MAX(date), COUNT(*) FROM market_price_daily
            WHERE coin_id = :cid AND date >= '2026-08-11'
        """), {'cid': BTC_ID})
        row = res.fetchone()
        has_0811 = "YES" if row[0] else "NO"
        print(f"  BTC market_price_daily: 2026-08-11 data={has_0811} (latest={row[0]}, count={row[1]})")

        # 6. BTC coin identity
        print("\n## 6. BTC Coin Identity")
        res = await conn.execute(text("""
            SELECT id, symbol, coingecko_id, binance_futures_symbol
            FROM coins WHERE id = :cid
        """), {'cid': BTC_ID})
        btc = res.fetchone()
        if btc:
            print(f"  id={btc[0]}, symbol={btc[1]}, coingecko_id={btc[2]}, binance_futures_symbol={btc[3]}")
        else:
            print("  BTC NOT FOUND!")

        # 7. Membership snapshot
        print("\n## 7. Membership Snapshot")
        res = await conn.execute(text("""
            SELECT id, member_count, member_digest FROM narrative_membership_snapshots
            WHERE narrative_id = 1 ORDER BY window_end DESC LIMIT 1
        """))
        snap = res.fetchone()
        if snap:
            print(f"  snapshot_id={snap[0]}, member_count={snap[1]}, digest={snap[2][:16]}...")
        else:
            print("  NO SNAPSHOT FOUND!")

    print("\n" + "=" * 60)
    print("PRE-FLIGHT AUDIT COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())