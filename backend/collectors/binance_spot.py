"""
Binance Spot data collector
"""
import httpx
from typing import List, Dict, Any, Optional
from datetime import datetime

BINANCE_SPOT_API = "https://api.binance.com/api/v3"


class BinanceSpotCollector:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=15.0)

    async def close(self):
        await self.client.aclose()

    async def fetch_klines(
        self, symbol: str, interval: str = "1d", limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Fetch daily klines from Binance Spot"""
        try:
            response = await self.client.get(
                f"{BINANCE_SPOT_API}/klines",
                params={"symbol": symbol, "interval": interval, "limit": limit},
            )
            data = response.json()

            return [
                {
                    "open_time": k[0],
                    "open": k[1],
                    "high": k[2],
                    "low": k[3],
                    "close": k[4],
                    "volume": k[5],
                    "close_time": k[6],
                    "quote_volume": k[7],
                }
                for k in data
            ]
        except Exception as e:
            print(f"Binance spot error for {symbol}: {e}")
            return []

    async def get_current_price(self, symbol: str) -> Optional[float]:
        """Get current price"""
        try:
            response = await self.client.get(
                f"{BINANCE_SPOT_API}/ticker/price",
                params={"symbol": symbol},
            )
            data = response.json()
            if "price" in data:
                return float(data["price"])
            return None
        except Exception:
            return None
