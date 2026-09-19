"""
Chat compute tools — heavy numeric analysis via pandas (CHAT-P5).

Called from the TS chat orchestrator's compute_coin_analysis tool.
Read-only: market_price_daily + coins. No writes.

GET /api/compute/coin-analysis?symbol=PENDLE&days=60
  -> price stats, returns, volatility, max drawdown, correlation vs BTC
"""
from datetime import date, timedelta
from math import sqrt
from typing import Optional

import numpy as np
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import Coin, MarketPriceDaily

router = APIRouter(tags=["chat-compute"])


async def _load_closes(db: AsyncSession, coin_id: int, days: int) -> list[tuple[date, float]]:
    rows = await db.execute(
        select(MarketPriceDaily.date, MarketPriceDaily.close)
        .where(MarketPriceDaily.coin_id == coin_id)
        .order_by(MarketPriceDaily.date.desc())
        .limit(days)
    )
    return [(r[0], float(r[1])) for r in rows.all()]


async def _resolve_coin(db: AsyncSession, symbol: str) -> Optional[Coin]:
    res = await db.execute(
        select(Coin).where(func.upper(Coin.symbol) == symbol.upper().lstrip("$").removesuffix("USDT"))
    )
    return res.scalar_one_or_none()


@router.get("/coin-analysis")
async def coin_analysis(
    symbol: str = Query(..., description="Coin symbol, e.g. PENDLE"),
    days: int = Query(60, ge=10, le=180, description="Analysis window in days"),
    benchmark: str = Query("BTC", description="Benchmark symbol for correlation"),
    db: AsyncSession = Depends(get_db),
):
    coin = await _resolve_coin(db, symbol)
    if coin is None:
        return {"error": f"Coin '{symbol}' not found in system"}

    series = list(reversed(await _load_closes(db, coin.id, days)))
    if len(series) < 10:
        return {"error": f"Insufficient price history for {coin.symbol} ({len(series)} rows)"}

    dates = [d.isoformat() for d, _ in series]
    closes = np.array([c for _, c in series], dtype=float)

    # Daily simple returns
    rets = closes[1:] / closes[:-1] - 1

    first, last = closes[0], closes[-1]
    period_return = float((last / first - 1) * 100)

    # Annualized volatility from daily returns
    vol_daily = float(np.std(rets, ddof=1)) if len(rets) > 1 else 0.0
    vol_annual = vol_daily * sqrt(365) * 100

    # Max drawdown
    running_max = np.maximum.accumulate(closes)
    drawdowns = (closes - running_max) / running_max
    max_dd_idx = int(np.argmin(drawdowns))
    max_drawdown = float(drawdowns[max_dd_idx] * 100)

    # Best/worst single days
    if len(rets) > 0:
        best_i = int(np.argmax(rets))
        worst_i = int(np.argmin(rets))
        best_day = {"date": dates[best_i + 1], "pct": float(rets[best_i] * 100)}
        worst_day = {"date": dates[worst_i + 1], "pct": float(rets[worst_i] * 100)}
    else:
        best_day = worst_day = None

    out = {
        "symbol": coin.symbol,
        "window": {"days": len(series), "from": dates[0], "to": dates[-1]},
        "price": {"start": first, "end": last, "min": float(closes.min()), "max": float(closes.max())},
        "periodReturnPct": round(period_return, 2),
        "annualizedVolatilityPct": round(vol_annual, 1),
        "maxDrawdownPct": round(max_drawdown, 2),
        "maxDrawdownDate": dates[max_dd_idx],
        "bestDay": best_day,
        "worstDay": worst_day,
    }

    # Correlation vs benchmark (BTC default)
    if benchmark.upper() != coin.symbol:
        bench = await _resolve_coin(db, benchmark)
        if bench is not None:
            bench_series = list(reversed(await _load_closes(db, bench.id, days)))
            if len(bench_series) >= 10:
                bench_dates = [d for d, _ in bench_series]
                common = set(dates) & set(bench_dates)
                if len(common) >= 10:
                    a = [c for d, c in series if d.isoformat() in common]
                    b = [c for d, c in bench_series if d.isoformat() in common]
                    ra = np.array(a[1:]) / np.array(a[:-1]) - 1
                    rb = np.array(b[1:]) / np.array(b[:-1]) - 1
                    corr = float(np.corrcoef(ra, rb)[0, 1])
                    out["benchmark"] = {
                        "symbol": bench.symbol,
                        "correlation": round(corr, 3),
                        "read": (
                            "di chuyển cùng chiều mạnh" if corr > 0.7
                            else "cùng chiều yếu" if corr > 0.3
                            else "độc lập tương đối" if corr > -0.3
                            else "ngược chiều" if corr > -0.7
                            else "ngược chiều mạnh"
                        ),
                    }

    return out
