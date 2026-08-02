"""
Binance Futures data collector - OI and Funding Rate
"""
import httpx
from typing import Dict, Any, Optional, List
from datetime import datetime

BINANCE_FUTURES_API = "https://fapi.binance.com/fapi/v1"
BINANCE_FUTURES_DATA_API = "https://fapi.binance.com/futures/data"


class BinanceFuturesCollector:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=15.0)

    async def close(self):
        await self.client.aclose()

    async def fetch_klines(
        self, symbol: str, interval: str = "1d", limit: int = 200
    ) -> List[Dict[str, Any]]:
        """Fetch daily klines from Binance Futures"""
        try:
            response = await self.client.get(
                f"{BINANCE_FUTURES_API}/klines",
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
            print(f"Binance futures klines error for {symbol}: {e}")
            return []

    async def fetch_open_interest(self, symbol: str) -> Optional[float]:
        """Fetch current Open Interest"""
        try:
            response = await self.client.get(
                f"{BINANCE_FUTURES_API}/openInterest",
                params={"symbol": symbol},
            )
            data = response.json()

            return float(data.get("openInterest", 0))
        except Exception as e:
            print(f"Binance futures OI error for {symbol}: {e}")
            return None

    async def fetch_funding_rate(self, symbol: str) -> Optional[float]:
        """Fetch current Funding Rate"""
        try:
            response = await self.client.get(
                f"{BINANCE_FUTURES_API}/premiumIndex",
                params={"symbol": symbol},
            )
            data = response.json()

            return float(data.get("lastFundingRate", 0))
        except Exception as e:
            print(f"Binance funding rate error for {symbol}: {e}")
            return None

    async def fetch_oi_history(
        self, symbol: str, period: str = "1d", limit: int = 2
    ) -> List[Dict[str, Any]]:
        """Fetch historical OI"""
        try:
            response = await self.client.get(
                f"{BINANCE_FUTURES_DATA_API}/openInterestHist",
                params={"symbol": symbol, "period": period, "limit": limit},
            )
            data = response.json()

            return [
                {
                    "timestamp": item["timestamp"],
                    "openInterest": float(item.get("sumOpenInterest", 0)),
                }
                for item in data
            ]
        except Exception as e:
            print(f"Binance OI history error for {symbol}: {e}")
            return []

    async def fetch_metrics(self, symbol: str) -> Dict[str, Optional[float]]:
        """Fetch both OI and Funding Rate"""
        oi = await self.fetch_open_interest(symbol)
        funding = await self.fetch_funding_rate(symbol)
        return {"open_interest": oi, "funding_rate": funding}
