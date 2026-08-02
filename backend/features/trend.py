"""
Trend score calculation using EMA crossovers
"""
import numpy as np
import pandas as pd
from typing import Dict, Any
from backend.features.calculator import calc_ema


def calculate_trend_score(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Calculate trend score based on EMA relationships
    
    Input: DataFrame với cột 'close', ít nhất 20 rows
    Output: { score: float, detail: dict }
    """
    if len(df) < 20:
        return {
            "score": 50.0,
            "detail": {
                "price": 0,
                "ema20": 0,
                "ema50": 0,
                "ema200": 0,
                "price_vs_ema20": False,
                "price_vs_ema50": False,
                "price_vs_ema200": False,
                "ema20_vs_ema50": False,
                "ema50_vs_ema200": False,
                "score_breakdown": {"base": 50, "insufficient_data": 0},
            }
        }

    closes = df['close'].astype(float)

    e20 = float(calc_ema(closes, 20).iloc[-1])
    e50 = float(calc_ema(closes, min(50, len(closes))).iloc[-1])
    e200 = float(calc_ema(closes, min(200, len(closes))).iloc[-1])
    price = float(closes.iloc[-1])

    p_vs_e20 = price > e20
    p_vs_e50 = price > e50
    p_vs_e200 = price > e200
    e20_e50 = e20 > e50
    e50_e200 = e50 > e200

    breakdown = {
        "base": 50,
        "price_vs_ema20": 15 if p_vs_e20 else -15,
        "price_vs_ema50": 20 if p_vs_e50 else -20,
        "price_vs_ema200": 15 if p_vs_e200 else -15,
        "ema20_vs_ema50": 5 if e20_e50 else -5,
        "ema50_vs_ema200": 5 if e50_e200 else -5,
    }
    score = float(np.clip(sum(breakdown.values()), 0, 100))

    return {
        "score": score,
        "detail": {
            "price": round(price, 8),
            "ema20": round(e20, 8),
            "ema50": round(e50, 8),
            "ema200": round(e200, 8),
            "price_vs_ema20": p_vs_e20,
            "price_vs_ema50": p_vs_e50,
            "price_vs_ema200": p_vs_e200,
            "ema20_vs_ema50": e20_e50,
            "ema50_vs_ema200": e50_e200,
            "score_breakdown": breakdown,
        }
    }
