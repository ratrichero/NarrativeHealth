"""
CoinGecko data collector - Market Cap, FDV, Supply
"""
import httpx
from typing import Dict, Any, Optional, List

COINGECKO_API = "https://api.coingecko.com/api/v3"


class CoinGeckoCollector:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=15.0)

    async def close(self):
        await self.client.aclose()

    async def fetch_coin_data(self, coin_id: str) -> Dict[str, Any]:
        """Fetch single coin data"""
        try:
            response = await self.client.get(
                f"{COINGECKO_API}/coins/{coin_id}",
                params={
                    "localization": "false",
                    "tickers": "false",
                    "market_data": "true",
                    "community_data": "false",
                    "developer_data": "false",
                    "sparkline": "false",
                },
            )
            data = response.json()
            market = data.get("market_data", {})

            return {
                "market_cap": market.get("market_cap", {}).get("usd"),
                "fully_diluted_valuation": market.get("fully_diluted_valuation", {}).get("usd"),
                "circulating_supply": market.get("circulating_supply"),
                "total_supply": market.get("total_supply"),
                "current_price": market.get("current_price", {}).get("usd"),
            }
        except Exception as e:
            print(f"CoinGecko error for {coin_id}: {e}")
            return {}

    async def fetch_markets(self, coin_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Fetch multiple coins at once (more efficient)"""
        if not coin_ids:
            return {}

        result = {}
        try:
            response = await self.client.get(
                f"{COINGECKO_API}/coins/markets",
                params={
                    "vs_currency": "usd",
                    "ids": ",".join(coin_ids),
                    "order": "market_cap_desc",
                    "per_page": 250,
                    "page": 1,
                    "sparkline": "false",
                },
            )
            data = response.json()

            if isinstance(data, list):
                for coin in data:
                    result[coin["id"]] = {
                        "market_cap": coin.get("market_cap"),
                        "fully_diluted_valuation": coin.get("fully_diluted_valuation"),
                        "circulating_supply": coin.get("circulating_supply"),
                        "total_supply": coin.get("total_supply"),
                        "current_price": coin.get("current_price"),
                        "price_change_24h": coin.get("price_change_percentage_24h"),
                        "volume_24h": coin.get("total_volume"),
                    }
        except Exception as e:
            print(f"CoinGecko markets error: {e}")

        return result
