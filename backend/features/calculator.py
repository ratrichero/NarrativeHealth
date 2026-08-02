"""
Core math functions for feature calculation using pandas
"""
import pandas as pd
import numpy as np
from typing import Tuple


def calc_ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average"""
    return series.ewm(span=period, adjust=False).mean()


def calc_roc(series: pd.Series, period: int = 14) -> float:
    """Rate of Change (%)"""
    if len(series) < period + 1:
        return 0.0
    current = series.iloc[-1]
    previous = series.iloc[-period]
    if previous == 0:
        return 0.0
    return float((current - previous) / previous * 100)


def calc_atr(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14
) -> float:
    """Average True Range"""
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)

    atr_series = tr.ewm(span=period, adjust=False).mean()
    return float(atr_series.iloc[-1])


def calc_volume_ma(volume: pd.Series, period: int = 20) -> float:
    """Volume Moving Average"""
    if len(volume) < period:
        return float(volume.mean())
    return float(volume.rolling(period).mean().iloc[-1])
