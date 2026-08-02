"""
Volume score calculation
"""
import pandas as pd
from typing import Dict, Any
from backend.features.calculator import calc_volume_ma


def calculate_volume_score(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Calculate volume score based on current volume vs MA20
    
    Input: DataFrame với cột 'volume', ít nhất 1 row
    """
    if len(df) == 0 or 'volume' not in df.columns:
        return {
            "score": 50.0,
            "detail": {
                "volume_current": 0,
                "volume_ma20": 0,
                "volume_ratio": 1.0,
                "days_used": 0,
            }
        }

    volumes = df['volume'].astype(float)
    current = float(volumes.iloc[-1])
    ma20 = calc_volume_ma(volumes, period=20)
    ratio = current / ma20 if ma20 > 0 else 1.0

    score = _score_volume_ratio(ratio)

    return {
        "score": float(score),
        "detail": {
            "volume_current": round(current, 2),
            "volume_ma20": round(ma20, 2),
            "volume_ratio": round(ratio, 3),
            "days_used": min(20, len(volumes)),
        }
    }


def _score_volume_ratio(ratio: float) -> float:
    if ratio > 3.0:   return 95.0
    if ratio > 2.0:   return 85.0
    if ratio > 1.5:   return 75.0
    if ratio > 1.0:   return 60.0
    if ratio > 0.7:   return 45.0
    if ratio > 0.5:   return 30.0
    return 15.0
