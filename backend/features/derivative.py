"""
Derivative score calculation (OI + Funding Rate)
"""
import numpy as np
from typing import Dict, Any, Optional


def calculate_derivative_score(
    oi_current: Optional[float],
    oi_prev: Optional[float],
    funding_rate: Optional[float],
    has_futures: bool = True,
) -> Dict[str, Any]:
    """
    Calculate derivative score based on OI change and Funding Rate
    
    oi_current:   OI hiện tại (USD)
    oi_prev:      OI 24h trước (USD)
    funding_rate: Funding Rate (decimal, ví dụ -0.0105 = -1.05%)
    has_futures:  False nếu coin không có perpetual futures
    """
    if not has_futures:
        return {
            "score": 50.0,
            "detail": {"no_futures": True}
        }

    # OI Change Component
    if oi_current and oi_prev and oi_prev != 0:
        oi_change_pct = (oi_current - oi_prev) / oi_prev * 100
    else:
        oi_change_pct = 0.0

    oi_component = _score_oi_change(oi_change_pct)

    # Funding Rate Component
    if funding_rate is not None:
        funding_component = _score_funding(funding_rate)
    else:
        funding_component = 55.0  # neutral nếu thiếu data

    # Accumulation Bonus: OI tăng + Funding âm (shorts trả cho longs)
    accumulation_bonus = 0.0
    if oi_change_pct > 10 and funding_rate is not None and funding_rate < 0:
        accumulation_bonus = 10.0

    score = float(np.clip(
        oi_component * 0.5 + funding_component * 0.5 + accumulation_bonus,
        0, 100
    ))

    return {
        "score": score,
        "detail": {
            "oi_current": oi_current,
            "oi_prev": oi_prev,
            "oi_change_pct": round(oi_change_pct, 2),
            "funding_rate": funding_rate,
            "oi_component": oi_component,
            "funding_component": funding_component,
            "accumulation_bonus": accumulation_bonus,
            "no_futures": False,
        }
    }


def _score_oi_change(pct: float) -> float:
    if pct > 20:   return 90.0
    if pct > 10:   return 75.0
    if pct > 0:    return 60.0
    if pct > -10:  return 40.0
    return 20.0


def _score_funding(rate: float) -> float:
    """rate là decimal: -0.0105 = -1.05%"""
    if rate < -0.0001:   return 90.0  # Very negative = bullish
    if rate < 0:         return 75.0
    if rate < 0.0002:    return 55.0  # Neutral
    if rate < 0.0005:    return 35.0
    return 15.0  # Very positive = bearish
