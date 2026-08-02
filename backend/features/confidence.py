"""
Confidence score calculation based on data source availability
"""
from typing import Dict, List


DEFAULT_WEIGHTS = {
    "binance_spot": 0.30,
    "binance_futures": 0.40,
    "coingecko": 0.30,
}


def calculate_confidence(
    binance_spot_ok: bool,
    binance_futures_ok: bool,
    coingecko_ok: bool,
    has_futures: bool,
    weights: Dict[str, float] = None,
) -> Dict[str, any]:
    """
    Calculate confidence score based on data source availability
    
    weights: { "binance_spot": 0.30, "binance_futures": 0.40, "coingecko": 0.30 }
    has_futures: False nếu coin không có perpetual → không phạt binance_futures
    """
    if weights is None:
        weights = DEFAULT_WEIGHTS.copy()

    missing: List[str] = []

    if not has_futures:
        # Redistribute futures weight to other sources
        total_w = weights["binance_spot"] + weights["coingecko"]
        spot_w = weights["binance_spot"] / total_w
        cg_w = weights["coingecko"] / total_w
        fut_w = 0.0
    else:
        spot_w = weights["binance_spot"]
        fut_w = weights["binance_futures"]
        cg_w = weights["coingecko"]

    score = 0.0

    if binance_spot_ok:
        score += spot_w * 100
    else:
        missing.append("binance_spot")

    if has_futures:
        if binance_futures_ok:
            score += fut_w * 100
        else:
            missing.append("binance_futures")

    if coingecko_ok:
        score += cg_w * 100
    else:
        missing.append("coingecko")

    total_sources = 3 if has_futures else 2
    data_completeness = ((total_sources - len(missing)) / total_sources) * 100

    return {
        "confidence_score": round(score, 1),
        "missing_sources": missing,
        "data_completeness": round(data_completeness, 1),
    }
