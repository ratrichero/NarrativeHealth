import asyncio
import sys
from pathlib import Path
from sqlalchemy import text

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from backend.database import engine

async def main():
    async with engine.begin() as conn:
        print("=== Narrative Health for AI (narrative_id=1) around 2026-08-11 ===")
        res = await conn.execute(text("""
            SELECT date, health_score, created_at
            FROM narrative_health
            WHERE narrative_id = 1
              AND date >= '2026-07-20'
              AND date <= '2026-08-11'
            ORDER BY date
        """))
        rows = res.fetchall()
        print(f"Count: {len(rows)}")
        for row in rows:
            print(f"  {row[0]}: health_score={row[1]}")
        
        print("\n=== Health Scores for AI constituents on 2026-08-11 ===")
        res = await conn.execute(text("""
            SELECT hs.coin_id, c.symbol, hs.health_score
            FROM health_scores hs
            JOIN coins c ON hs.coin_id = c.id
            WHERE hs.date = '2026-08-11'
              AND hs.coin_id IN (1, 4, 5, 10, 11, 12, 22)
            ORDER BY hs.coin_id
        """))
        rows = res.fetchall()
        print(f"Count: {len(rows)}")
        for row in rows:
            print(f"  coin_id={row[0]} ({row[1]}): health_score={row[2]}")
        
        print("\n=== Market Price Daily for AI constituents (7D window ending 2026-08-11) ===")
        res = await conn.execute(text("""
            SELECT coin_id, date, close, volume
            FROM market_price_daily
            WHERE coin_id IN (1, 4, 5, 10, 11, 12, 22)
              AND date >= '2026-08-04'
              AND date <= '2026-08-11'
            ORDER BY coin_id, date
        """))
        rows = res.fetchall()
        print(f"Count: {len(rows)}")
        for row in rows:
            print(f"  coin_id={row[0]}, date={row[1]}, close={row[2]}, volume={row[3]}")

asyncio.run(main())
