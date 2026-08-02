"""
Momentum score calculation using ROC and ATR
"""
import numpy as np
import pandas as pd
from typing import Dict, Any
from backend.features.calculator import calc_roc, calc_atr


def calculate_momentum_score(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Calculate momentum score based on ROC(14) and ATR(14)
    
    Input: DataFrame với cột 'close', 'high', 'low'. Cần ít nhất 15 rows.
    """
    if len(df) < 15:
        return {
            "score": 50.0,
            "detail": {
                "roc_14": 0,
                "atr_14": 0,
                "atr_pct": 0,
                "roc_component": 50.0,
                "atr_component": 50.0,
            }
        }

    closes = df['close'].astype(float)
    highs = df['high'].astype(float)
    lows = df['low'].astype(float)

    roc_14 = calc_roc(closes, period=14)
    atr_14 = calc_atr(highs, lows, closes, period=14)
    price = float(closes.iloc[-1])
    atr_pct = (atr_14 / price * 100) if price > 0 else 0.0

    roc_component = _score_roc(roc_14)
    atr_component = _score_atr(atr_pct)
    
    score = float(np.clip(
        roc_component * 0.6 + atr_component * 0.4,
        0, 100
    ))

    return {
        "score": score,
        "detail": {
            "roc_14": round(roc_14, 2),
            "atr_14": round(atr_14, 8),
            "atr_pct": round(atr_pct, 2),
            "roc_component": roc_component,
            "atr_component": atr_component,
        }
    }


def _score_roc(v: float) -> float:
    if v > 30:   return 95.0
    if v > 20:   return 85.0
    if v > 10:   return 75.0
    if v > 5:    return 65.0
    if v > 0:    return 55.0
    if v > -5:   return 45.0
    if v > -10:  return 35.0
    if v > -20:  return 25.0
    return 15.0


def _score_atr(v: float) -> float:
    if v > 15:  return 80.0
    if v > 10:  return 70.0
    if v > 5:   return 60.0
    if v > 2:   return 50.0
    return 35.0
