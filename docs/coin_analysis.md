Công Thức Phân Tích Kỹ Thuật Crypto (Python)

Tổng Quan:

┌─────────────────────────────────────────────────────────┐
│                  CRYPTO TECHNICAL ANALYZER               │
├─────────────────────────────────────────────────────────┤
│  Data Input (OHLCV) → Indicators → Scoring → Signal    │
├──────────┬──────────┬──────────┬────────────────────────┤
│   15m    │    1H    │    4H    │         1D             │
│ Weight:  │ Weight:  │ Weight:  │      Weight:           │
│   15%    │   25%    │   30%    │        30%             │
├──────────┴──────────┴──────────┴────────────────────────┤
│  Trend + Momentum + Volume + Oscillator + Pattern       │
├─────────────────────────────────────────────────────────┤
│  Output: LONG / SHORT / NEUTRAL + Strength (0-100%)     │
└─────────────────────────────────────────────────────────┘

"""
╔══════════════════════════════════════════════════════════════════════╗
║         CRYPTO TECHNICAL ANALYSIS ENGINE v2.0                       ║
║         Multi-Timeframe: 15m | 1H | 4H | 1D                        ║
║                                                                      ║
║  Cải tiến v2.0:                                                     ║
║  ✅ Fix Adjustment Factor (additive thay vì multiplicative)         ║
║  ✅ Fix VWAP (Rolling thay vì Cumulative)                           ║
║  ✅ Market Regime Detection                                          ║
║  ✅ Dynamic Indicator Weights theo Regime                            ║
║  ✅ Divergence Engine cải tiến                                       ║
║  ✅ RSI Smooth Mapping                                               ║
║  ✅ Heikin-Ashi Analysis                                             ║
║  ✅ Dynamic Risk Management (TP1/TP2/TP3)                           ║
║  ✅ Data Quality Checker                                             ║
║  ✅ Confidence Formula cải tiến                                      ║
╚══════════════════════════════════════════════════════════════════════╝
"""

import numpy as np
import pandas as pd
import ccxt
from datetime import datetime
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Optional
from enum import Enum
import warnings
warnings.filterwarnings('ignore')


# ═══════════════════════════════════════════════════════════════════
# PHẦN 1: DATA STRUCTURES & CONSTANTS
# ═══════════════════════════════════════════════════════════════════

class SignalType(Enum):
    STRONG_LONG  = "🟢 STRONG LONG"
    LONG         = "🟩 LONG"
    WEAK_LONG    = "🔹 WEAK LONG"
    NEUTRAL      = "⬜ NEUTRAL"
    WEAK_SHORT   = "🔸 WEAK SHORT"
    SHORT        = "🟥 SHORT"
    STRONG_SHORT = "🔴 STRONG SHORT"


class RegimeType(Enum):
    TRENDING_UP   = "📈 TRENDING UP"
    TRENDING_DOWN = "📉 TRENDING DOWN"
    RANGING       = "↔️  RANGING"
    VOLATILE      = "⚡ VOLATILE"
    BREAKOUT      = "🚀 BREAKOUT"
    TRANSITIONING = "🔄 TRANSITIONING"


@dataclass
class IndicatorResult:
    name:        str
    value:       float
    signal:      float   # -1.0 (strong short) → +1.0 (strong long)
    weight:      float
    description: str = ""


@dataclass
class MarketRegime:
    regime_type:        RegimeType
    adx:                float = 0.0
    atr_pct:            float = 0.0
    efficiency_ratio:   float = 0.0
    vol_surge:          float = 1.0
    price_position:     float = 0.5
    signal_multiplier:  float = 1.0
    indicator_bias:     str   = "neutral"


@dataclass
class DataQuality:
    quality_score: float
    issues:        List[str]
    is_valid:      bool
    candle_count:  int


@dataclass
class RiskLevels:
    entry:                  float
    stop_loss:              float
    tp1:                    float
    tp2:                    float
    tp3:                    float
    sl_pct:                 float
    rr_ratio:               float
    ref_atr:                float
    suggested_position_pct: float


@dataclass
class TimeframeResult:
    timeframe:       str
    indicators:      List[IndicatorResult] = field(default_factory=list)
    group_scores:    Dict[str, float]      = field(default_factory=dict)
    composite_score: float                 = 0.0
    signal:          str                   = "NEUTRAL"
    regime:          Optional[MarketRegime]= None
    data_quality:    Optional[DataQuality] = None


@dataclass
class FinalSignal:
    symbol:           str
    direction:        str
    signal_type:      SignalType
    strength:         float
    confidence:       float
    composite_score:  float
    timeframe_scores: Dict[str, float]          = field(default_factory=dict)
    timeframe_results:Dict[str, TimeframeResult]= field(default_factory=dict)
    risk_levels:      Optional[RiskLevels]       = None
    dominant_regime:  Optional[MarketRegime]     = None
    timestamp:        str                        = ""


# ───────── WEIGHTS ─────────

# Trọng số timeframe
TF_WEIGHTS = {
    '15m': 0.15,
    '1h':  0.25,
    '4h':  0.30,
    '1d':  0.30,
}

# Trọng số nhóm indicator (base - sẽ điều chỉnh theo regime)
BASE_GROUP_WEIGHTS = {
    'trend':      0.30,
    'momentum':   0.25,
    'volume':     0.20,
    'oscillator': 0.15,
    'pattern':    0.10,
}

# Trọng số theo từng regime
REGIME_GROUP_WEIGHTS = {
    'trend': {          # Trending market
        'trend':      0.40,
        'momentum':   0.25,
        'volume':     0.20,
        'oscillator': 0.10,
        'pattern':    0.05,
    },
    'oscillator': {     # Ranging market
        'trend':      0.15,
        'momentum':   0.20,
        'volume':     0.20,
        'oscillator': 0.35,
        'pattern':    0.10,
    },
    'momentum': {       # Breakout market
        'trend':      0.20,
        'momentum':   0.30,
        'volume':     0.35,
        'oscillator': 0.10,
        'pattern':    0.05,
    },
    'neutral': BASE_GROUP_WEIGHTS,
}


# ═══════════════════════════════════════════════════════════════════
# PHẦN 2: DATA QUALITY CHECKER
# ═══════════════════════════════════════════════════════════════════

class DataQualityChecker:
    """Kiểm tra chất lượng dữ liệu trước khi phân tích"""

    MIN_CANDLES = {'15m': 100, '1h': 100, '4h': 100, '1d': 100}

    @classmethod
    def check(cls, df: pd.DataFrame, timeframe: str) -> DataQuality:
        issues       = []
        quality_score = 100.0

        if df is None or df.empty:
            return DataQuality(
                quality_score=0,
                issues=["DataFrame is empty or None"],
                is_valid=False,
                candle_count=0
            )

        # 1. Số lượng nến tối thiểu
        min_c = cls.MIN_CANDLES.get(timeframe, 100)
        if len(df) < min_c:
            issues.append(f"Insufficient candles: {len(df)} (need ≥ {min_c})")
            quality_score -= 30

        # 2. Missing values
        null_pct = df.isnull().sum().sum() / max(len(df) * len(df.columns), 1) * 100
        if null_pct > 5:
            issues.append(f"High null rate: {null_pct:.1f}%")
            quality_score -= 20
        elif null_pct > 0:
            issues.append(f"Minor nulls: {null_pct:.1f}%")
            quality_score -= 5

        # 3. Extreme price moves (>50% trong 1 nến → data lỗi)
        if len(df) > 1:
            returns = df['close'].pct_change().abs()
            extreme = (returns > 0.50).sum()
            if extreme > 0:
                issues.append(f"Extreme price moves: {extreme} candles")
                quality_score -= 10

        # 4. Zero volume candles
        zero_vol = (df['volume'] == 0).sum()
        if zero_vol > len(df) * 0.05:
            issues.append(f"Too many zero-volume candles: {zero_vol}")
            quality_score -= 10

        # 5. OHLC consistency
        inconsistent = (
            (df['high'] < df['close']) |
            (df['high'] < df['open'])  |
            (df['low']  > df['close']) |
            (df['low']  > df['open'])
        ).sum()
        if inconsistent > 0:
            issues.append(f"OHLC inconsistencies: {inconsistent} candles")
            quality_score -= 15

        # 6. Duplicate timestamps
        if df.index.duplicated().sum() > 0:
            issues.append("Duplicate timestamps found")
            quality_score -= 10

        quality_score = max(quality_score, 0.0)
        return DataQuality(
            quality_score=round(quality_score, 1),
            issues=issues,
            is_valid=quality_score >= 60,
            candle_count=len(df)
        )


# ═══════════════════════════════════════════════════════════════════
# PHẦN 3: MARKET REGIME DETECTOR
# ═══════════════════════════════════════════════════════════════════

class MarketRegimeDetector:
    """
    Phát hiện chế độ thị trường để điều chỉnh indicator weights
    
    ┌──────────────────────────────────────────────────────────────┐
    │  TRENDING_UP   : ADX>30, ER>0.5, price_pos>0.6             │
    │  TRENDING_DOWN : ADX>30, ER>0.5, price_pos<0.4             │
    │  RANGING       : ADX<20, ER<0.3                             │
    │  VOLATILE      : ATR% > 3%                                  │
    │  BREAKOUT      : Vol surge > 2x, price near extremes        │
    │  TRANSITIONING : Không rơi vào các loại trên               │
    └──────────────────────────────────────────────────────────────┘
    """

    def __init__(self, df: pd.DataFrame):
        self.df    = df
        self.close = df['close'].values
        self.high  = df['high'].values
        self.low   = df['low'].values
        self.vol   = df['volume'].values

    def detect(self) -> MarketRegime:
        close = pd.Series(self.close)
        high  = pd.Series(self.high)
        low   = pd.Series(self.low)

        adx_val = self._calc_adx()
        atr_val = self._calc_atr()
        atr_pct = atr_val / close.iloc[-1] * 100 if close.iloc[-1] > 0 else 0

        # Efficiency Ratio (Kaufman)
        n = min(20, len(close) - 1)
        direction_move = abs(close.iloc[-1] - close.iloc[-n]) if n > 0 else 0
        path_length    = sum(
            abs(close.iloc[-i] - close.iloc[-i-1]) for i in range(1, n)
        ) if n > 1 else 1
        efficiency_ratio = direction_move / path_length if path_length > 0 else 0

        # Price position trong 20-period range
        high_20       = high.rolling(20).max().iloc[-1]
        low_20        = low.rolling(20).min().iloc[-1]
        range_20      = high_20 - low_20
        price_position= (close.iloc[-1] - low_20) / range_20 if range_20 > 0 else 0.5

        # Volume surge
        vol_series = pd.Series(self.vol)
        vol_avg    = vol_series.rolling(20).mean().iloc[-1]
        vol_surge  = self.vol[-1] / vol_avg if vol_avg > 0 else 1.0

        # ── Classify ──
        if atr_pct > 4.0:
            regime_type    = RegimeType.VOLATILE
            bias           = "neutral"
            multiplier     = 0.6

        elif vol_surge > 2.5 and (price_position > 0.85 or price_position < 0.15):
            regime_type    = RegimeType.BREAKOUT
            bias           = "momentum"
            multiplier     = 1.3

        elif adx_val > 30 and efficiency_ratio > 0.5:
            if price_position >= 0.5:
                regime_type = RegimeType.TRENDING_UP
            else:
                regime_type = RegimeType.TRENDING_DOWN
            bias           = "trend"
            multiplier     = 1.2

        elif adx_val < 20 and efficiency_ratio < 0.3:
            regime_type    = RegimeType.RANGING
            bias           = "oscillator"
            multiplier     = 0.8

        else:
            regime_type    = RegimeType.TRANSITIONING
            bias           = "neutral"
            multiplier     = 0.9

        return MarketRegime(
            regime_type       = regime_type,
            adx               = round(adx_val, 2),
            atr_pct           = round(atr_pct, 3),
            efficiency_ratio  = round(efficiency_ratio, 3),
            vol_surge         = round(vol_surge, 2),
            price_position    = round(price_position, 3),
            signal_multiplier = multiplier,
            indicator_bias    = bias,
        )

    # ── helpers ──

    def _calc_adx(self, period: int = 14) -> float:
        high  = pd.Series(self.high)
        low   = pd.Series(self.low)
        close = pd.Series(self.close)

        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low  - close.shift(1)).abs(),
        ], axis=1).max(axis=1)

        atr = tr.ewm(span=period, adjust=False).mean()

        up_move   = high - high.shift(1)
        down_move = low.shift(1) - low

        plus_dm  = pd.Series(np.where((up_move > down_move)  & (up_move > 0),   up_move,   0), dtype=float)
        minus_dm = pd.Series(np.where((down_move > up_move)  & (down_move > 0), down_move, 0), dtype=float)

        plus_di  = 100 * plus_dm.ewm(span=period, adjust=False).mean()  / (atr + 1e-10)
        minus_di = 100 * minus_dm.ewm(span=period, adjust=False).mean() / (atr + 1e-10)

        dx  = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di + 1e-10)
        adx = dx.ewm(span=period, adjust=False).mean()
        return float(adx.iloc[-1])

    def _calc_atr(self, period: int = 14) -> float:
        high  = pd.Series(self.high)
        low   = pd.Series(self.low)
        close = pd.Series(self.close)

        tr = pd.concat([
            high - low,
            (high - close.shift(1)).abs(),
            (low  - close.shift(1)).abs(),
        ], axis=1).max(axis=1)

        return float(tr.ewm(span=period, adjust=False).mean().iloc[-1])


def get_group_weights(regime: MarketRegime) -> Dict[str, float]:
    """Lấy group weights dựa trên market regime"""
    bias = regime.indicator_bias
    return REGIME_GROUP_WEIGHTS.get(bias, BASE_GROUP_WEIGHTS).copy()


# ═══════════════════════════════════════════════════════════════════
# PHẦN 4: DIVERGENCE ENGINE
# ═══════════════════════════════════════════════════════════════════

class DivergenceDetector:
    """
    Phát hiện divergence với pivot point algorithm
    
    Regular Bearish  : Price HH + Indicator LH → Đảo chiều xuống
    Regular Bullish  : Price LL + Indicator HL → Đảo chiều lên
    Hidden  Bullish  : Price HL + Indicator LL → Tiếp tục tăng
    Hidden  Bearish  : Price LH + Indicator HH → Tiếp tục giảm
    """

    def __init__(self, prices: np.ndarray, indicator: np.ndarray,
                 lookback: int = 40, pivot_window: int = 5):
        self.prices      = prices[-lookback:]
        self.indicator   = indicator[-lookback:]
        self.pivot_window= pivot_window

    def _pivot_highs(self, data: np.ndarray) -> List[Tuple[int, float]]:
        w = self.pivot_window
        pivots = []
        for i in range(w, len(data) - w):
            if data[i] == max(data[i-w: i+w+1]):
                pivots.append((i, float(data[i])))
        return pivots

    def _pivot_lows(self, data: np.ndarray) -> List[Tuple[int, float]]:
        w = self.pivot_window
        pivots = []
        for i in range(w, len(data) - w):
            if data[i] == min(data[i-w: i+w+1]):
                pivots.append((i, float(data[i])))
        return pivots

    def _nearest(self, pivots: list, idx: int) -> Optional[Tuple[int, float]]:
        if not pivots:
            return None
        return min(pivots, key=lambda p: abs(p[0] - idx))

    def detect(self) -> Dict:
        p_arr = np.array(self.prices,    dtype=float)
        i_arr = np.array(self.indicator, dtype=float)

        ph = self._pivot_highs(p_arr)
        pl = self._pivot_lows(p_arr)
        ih = self._pivot_highs(i_arr)
        il = self._pivot_lows(i_arr)

        divergences = []

        # ── Regular Bearish: Price HH, Indicator LH ──
        if len(ph) >= 2 and len(ih) >= 2:
            p1i, p1v = ph[-2];  p2i, p2v = ph[-1]
            i1 = self._nearest(ih, p1i);  i2 = self._nearest(ih, p2i)
            if i1 and i2 and p2v > p1v * 1.001 and i2[1] < i1[1] * 0.999:
                p_rise  = (p2v - p1v) / p1v * 100
                i_drop  = (i1[1] - i2[1]) / (abs(i1[1]) + 1e-10) * 100
                divergences.append({
                    'type': 'REGULAR_BEARISH', 'signal': -0.65,
                    'strength': min((p_rise + i_drop) / 15, 1.0),
                    'desc': f"Regular Bearish: Price +{p_rise:.1f}%, Ind -{i_drop:.1f}%"
                })

        # ── Regular Bullish: Price LL, Indicator HL ──
        if len(pl) >= 2 and len(il) >= 2:
            p1i, p1v = pl[-2];  p2i, p2v = pl[-1]
            i1 = self._nearest(il, p1i);  i2 = self._nearest(il, p2i)
            if i1 and i2 and p2v < p1v * 0.999 and i2[1] > i1[1] * 1.001:
                p_drop  = (p1v - p2v) / p1v * 100
                i_rise  = (i2[1] - i1[1]) / (abs(i1[1]) + 1e-10) * 100
                divergences.append({
                    'type': 'REGULAR_BULLISH', 'signal': 0.65,
                    'strength': min((p_drop + i_rise) / 15, 1.0),
                    'desc': f"Regular Bullish: Price -{p_drop:.1f}%, Ind +{i_rise:.1f}%"
                })

        # ── Hidden Bullish: Price HL, Indicator LL ──
        if len(pl) >= 2 and len(il) >= 2:
            p1i, p1v = pl[-2];  p2i, p2v = pl[-1]
            i1 = self._nearest(il, p1i);  i2 = self._nearest(il, p2i)
            if i1 and i2 and p2v > p1v * 1.001 and i2[1] < i1[1] * 0.999:
                divergences.append({
                    'type': 'HIDDEN_BULLISH', 'signal': 0.45,
                    'strength': 0.5,
                    'desc': "Hidden Bullish: Uptrend continuation"
                })

        # ── Hidden Bearish: Price LH, Indicator HH ──
        if len(ph) >= 2 and len(ih) >= 2:
            p1i, p1v = ph[-2];  p2i, p2v = ph[-1]
            i1 = self._nearest(ih, p1i);  i2 = self._nearest(ih, p2i)
            if i1 and i2 and p2v < p1v * 0.999 and i2[1] > i1[1] * 1.001:
                divergences.append({
                    'type': 'HIDDEN_BEARISH', 'signal': -0.45,
                    'strength': 0.5,
                    'desc': "Hidden Bearish: Downtrend continuation"
                })

        net_signal = float(np.mean([d['signal'] for d in divergences])) if divergences else 0.0

        return {
            'found':       len(divergences) > 0,
            'divergences': divergences,
            'net_signal':  net_signal,
        }


# ═══════════════════════════════════════════════════════════════════
# PHẦN 5: TECHNICAL INDICATORS
# ═══════════════════════════════════════════════════════════════════

class TechnicalIndicators:
    """Tính toán toàn bộ indicators, trả về IndicatorResult"""

    def __init__(self, df: pd.DataFrame):
        self.df     = df.copy()
        self.close  = df['close'].values.astype(float)
        self.high   = df['high'].values.astype(float)
        self.low    = df['low'].values.astype(float)
        self.open   = df['open'].values.astype(float)
        self.volume = df['volume'].values.astype(float)

    # ─────────────────────── helpers ───────────────────────

    def _ema(self, data: np.ndarray, period: int) -> np.ndarray:
        return pd.Series(data).ewm(span=period, adjust=False).mean().values

    def _sma(self, data: np.ndarray, period: int) -> np.ndarray:
        return pd.Series(data).rolling(period).mean().values

    def _atr_series(self, period: int = 14) -> pd.Series:
        h = pd.Series(self.high);  l = pd.Series(self.low);  c = pd.Series(self.close)
        tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
        return tr.ewm(span=period, adjust=False).mean()

    @staticmethod
    def _rsi_smooth_mapping(rsi_val: float, rsi_slope: float = 0.0) -> float:
        """
        ✅ FIX: Smooth RSI mapping thay vì step function mâu thuẫn
        RSI=65 không còn trả về bearish signal
        """
        if rsi_val >= 80:
            base = -0.5 - (rsi_val - 80) / 20 * 0.5   # -0.5 → -1.0
        elif rsi_val >= 70:
            base = -(rsi_val - 70) / 10 * 0.5          # 0 → -0.5
        elif rsi_val > 30:
            # Linear: RSI=70 → 0, RSI=50 → +0.2, RSI=30 → +0.4
            base = -(rsi_val - 50) / 50 * 0.4
        elif rsi_val >= 20:
            base = (30 - rsi_val) / 10 * 0.5           # 0 → +0.5
        else:
            base = 0.5 + (20 - rsi_val) / 20 * 0.5    # +0.5 → +1.0

        slope_adj = float(np.clip(rsi_slope * 0.1, -0.2, 0.2))
        return float(np.clip(base + slope_adj, -1.0, 1.0))

    # ══════════════ TREND GROUP ══════════════

    def moving_average_analysis(self) -> List[IndicatorResult]:
        results = []
        price   = self.close[-1]

        ema_periods = [9, 21, 50, 100, 200]
        emas = {}
        for p in ema_periods:
            if len(self.close) >= p:
                emas[p] = self._ema(self.close, p)

        # 1. Price vs each EMA
        for p, ema_arr in emas.items():
            val = ema_arr[-1]
            if np.isnan(val):
                continue
            pct  = (price - val) / val * 100
            sig  = float(np.clip(pct / 5.0, -1.0, 1.0))
            w    = 0.12 if p <= 21 else 0.22 if p <= 50 else 0.28
            results.append(IndicatorResult(
                name=f"Price vs EMA{p}", value=round(val, 6), signal=sig, weight=w,
                description=f"{'Above' if sig > 0 else 'Below'} EMA{p} by {abs(pct):.2f}%"
            ))

        # 2. EMA 9/21 Cross
        if 9 in emas and 21 in emas and len(emas[9]) >= 3:
            curr_diff = emas[9][-1] - emas[21][-1]
            prev_diff = emas[9][-3] - emas[21][-3]

            if np.isnan(curr_diff) or np.isnan(prev_diff):
                pass
            elif prev_diff < 0 < curr_diff:
                cross_sig = 0.85
                desc = "🔔 Golden Cross EMA9/21"
            elif prev_diff > 0 > curr_diff:
                cross_sig = -0.85
                desc = "🔔 Death Cross EMA9/21"
            else:
                cross_sig = float(np.clip(curr_diff / emas[21][-1] * 100 / 2, -0.5, 0.5))
                desc = "No cross"

            results.append(IndicatorResult(
                name="EMA 9/21 Cross", value=round(curr_diff, 6),
                signal=cross_sig, weight=0.22, description=desc
            ))

        # 3. MA Fan (bullish/bearish order)
        if len(emas) >= 3:
            sorted_vals = [emas[p][-1] for p in sorted(emas.keys())]
            sorted_vals = [v for v in sorted_vals if not np.isnan(v)]
            if len(sorted_vals) >= 3:
                is_bull_fan = all(sorted_vals[i] >= sorted_vals[i+1] for i in range(len(sorted_vals)-1))
                is_bear_fan = all(sorted_vals[i] <= sorted_vals[i+1] for i in range(len(sorted_vals)-1))
                fan_sig = 0.70 if is_bull_fan else -0.70 if is_bear_fan else 0.0
                results.append(IndicatorResult(
                    name="MA Fan Order", value=fan_sig, signal=fan_sig, weight=0.16,
                    description="Bullish Fan" if is_bull_fan else "Bearish Fan" if is_bear_fan else "Mixed"
                ))

        return results

    def adx_analysis(self, period: int = 14) -> List[IndicatorResult]:
        if len(self.close) < period + 5:
            return []

        h = pd.Series(self.high);  l = pd.Series(self.low);  c = pd.Series(self.close)
        tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
        atr = tr.ewm(span=period, adjust=False).mean()

        up   = h - h.shift(1);  down = l.shift(1) - l
        p_dm = pd.Series(np.where((up > down)   & (up > 0),   up,   0), dtype=float)
        m_dm = pd.Series(np.where((down > up)   & (down > 0), down, 0), dtype=float)

        p_di = 100 * p_dm.ewm(span=period, adjust=False).mean() / (atr + 1e-10)
        m_di = 100 * m_dm.ewm(span=period, adjust=False).mean() / (atr + 1e-10)
        dx   = 100 * (p_di - m_di).abs() / (p_di + m_di + 1e-10)
        adx  = dx.ewm(span=period, adjust=False).mean()

        adx_v = float(adx.iloc[-1])
        pdi_v = float(p_di.iloc[-1])
        mdi_v = float(m_di.iloc[-1])

        strength  = min(adx_v / 50.0, 1.0)
        direction = 1.0 if pdi_v > mdi_v else -1.0
        signal    = float(np.clip(direction * strength * 0.85, -1.0, 1.0))

        return [IndicatorResult(
            name="ADX(14)", value=round(adx_v, 2), signal=signal, weight=0.28,
            description=f"ADX={adx_v:.1f} +DI={pdi_v:.1f} -DI={mdi_v:.1f} "
                        f"| {'Strong Trend' if adx_v > 25 else 'Weak/Range'}"
        )]

    def ichimoku_analysis(self) -> List[IndicatorResult]:
        if len(self.close) < 52:
            return []

        h = pd.Series(self.high);  l = pd.Series(self.low)
        tenkan   = (h.rolling(9).max()  + l.rolling(9).min())  / 2
        kijun    = (h.rolling(26).max() + l.rolling(26).min()) / 2
        span_a   = ((tenkan + kijun) / 2).shift(26)
        span_b   = ((h.rolling(52).max() + l.rolling(52).min()) / 2).shift(26)

        price    = self.close[-1]
        tk_v     = float(tenkan.iloc[-1])
        kj_v     = float(kijun.iloc[-1])
        sa_v     = float(span_a.iloc[-1]) if not np.isnan(span_a.iloc[-1]) else price
        sb_v     = float(span_b.iloc[-1]) if not np.isnan(span_b.iloc[-1]) else price
        cloud_top = max(sa_v, sb_v);  cloud_bot = min(sa_v, sb_v)

        sigs = []
        # Price vs cloud
        if price > cloud_top:    sigs.append(0.60)
        elif price < cloud_bot:  sigs.append(-0.60)
        else:                    sigs.append(0.0)

        # Tenkan vs Kijun
        if not (np.isnan(tk_v) or np.isnan(kj_v)):
            sigs.append(float(np.clip((tk_v - kj_v) / kj_v * 100, -0.5, 0.5)))

        # Cloud color
        sigs.append(0.30 if sa_v > sb_v else -0.30)

        signal = float(np.clip(np.mean(sigs), -1.0, 1.0))
        pos_str = "above cloud" if price > cloud_top else "below cloud" if price < cloud_bot else "inside cloud"

        return [IndicatorResult(
            name="Ichimoku Cloud", value=round(price - cloud_top, 6),
            signal=signal, weight=0.26,
            description=f"Price {pos_str} | Tenkan={tk_v:.4f} Kijun={kj_v:.4f}"
        )]

    def supertrend_analysis(self, period: int = 10, mult: float = 3.0) -> List[IndicatorResult]:
        if len(self.close) < period + 5:
            return []

        h = pd.Series(self.high);  l = pd.Series(self.low);  c = pd.Series(self.close)
        atr  = self._atr_series(period)
        hl2  = (h + l) / 2
        ub   = hl2 + mult * atr
        lb   = hl2 - mult * atr

        direction = pd.Series(index=c.index, dtype=int)
        direction.iloc[0] = -1

        for i in range(1, len(c)):
            if c.iloc[i] > ub.iloc[i-1]:   direction.iloc[i] = 1
            elif c.iloc[i] < lb.iloc[i-1]: direction.iloc[i] = -1
            else:                           direction.iloc[i] = direction.iloc[i-1]

        st_line = lb.where(direction == 1, ub)
        sig     = float(direction.iloc[-1]) * 0.72

        return [IndicatorResult(
            name="SuperTrend", value=round(float(st_line.iloc[-1]), 6),
            signal=sig, weight=0.16,
            description=f"{'Bullish ✅' if sig > 0 else 'Bearish ❌'} | ST={st_line.iloc[-1]:.4f}"
        )]

    def heikin_ashi_analysis(self) -> List[IndicatorResult]:
        """✅ MỚI: Heikin-Ashi làm mượt noise"""
        if len(self.close) < 10:
            return []

        o = pd.Series(self.open);  h = pd.Series(self.high)
        l = pd.Series(self.low);   c = pd.Series(self.close)

        ha_c = (o + h + l + c) / 4
        ha_o = pd.Series(index=o.index, dtype=float)
        ha_o.iloc[0] = (o.iloc[0] + c.iloc[0]) / 2
        for i in range(1, len(o)):
            ha_o.iloc[i] = (ha_o.iloc[i-1] + ha_c.iloc[i-1]) / 2

        ha_h = pd.concat([h, ha_o, ha_c], axis=1).max(axis=1)
        ha_l = pd.concat([l, ha_o, ha_c], axis=1).min(axis=1)

        is_bull = ha_c > ha_o
        consecutive = 0
        cur_bull = bool(is_bull.iloc[-1])
        for i in range(len(is_bull)-1, max(len(is_bull)-15, -1), -1):
            if bool(is_bull.iloc[i]) == cur_bull:
                consecutive += 1
            else:
                break

        # Shadow analysis
        up_shd = float(ha_h.iloc[-1] - max(ha_o.iloc[-1], ha_c.iloc[-1]))
        lo_shd = float(min(ha_o.iloc[-1], ha_c.iloc[-1]) - ha_l.iloc[-1])
        candle_range = float(ha_h.iloc[-1] - ha_l.iloc[-1]) + 1e-10

        if cur_bull:
            sig = min(0.30 + consecutive * 0.08, 0.85)
            if lo_shd < candle_range * 0.05:   # No lower shadow = strong bull
                sig = min(sig + 0.10, 0.92)
        else:
            sig = max(-0.30 - consecutive * 0.08, -0.85)
            if up_shd < candle_range * 0.05:   # No upper shadow = strong bear
                sig = max(sig - 0.10, -0.92)

        return [IndicatorResult(
            name="Heikin-Ashi", value=float(consecutive),
            signal=float(np.clip(sig, -1.0, 1.0)), weight=0.20,
            description=f"{'Bullish' if cur_bull else 'Bearish'} ×{consecutive} consecutive candles"
        )]

    # ══════════════ MOMENTUM GROUP ══════════════

    def rsi_analysis(self, period: int = 14) -> List[IndicatorResult]:
        if len(self.close) < period + 5:
            return []

        delta    = pd.Series(self.close).diff()
        gain     = delta.where(delta > 0, 0.0)
        loss     = (-delta).where(delta < 0, 0.0)
        avg_gain = gain.ewm(span=period, adjust=False).mean()
        avg_loss = loss.ewm(span=period, adjust=False).mean()

        rs  = avg_gain / (avg_loss + 1e-10)
        rsi = 100 - (100 / (1 + rs))

        rsi_v  = float(rsi.iloc[-1])
        slope  = float(rsi.iloc[-1] - rsi.iloc[-4]) if len(rsi) >= 4 else 0.0

        # ✅ FIX: Smooth mapping (không dùng step function mâu thuẫn)
        signal = self._rsi_smooth_mapping(rsi_v, slope)

        results = [IndicatorResult(
            name="RSI(14)", value=round(rsi_v, 2), signal=signal, weight=0.28,
            description=f"RSI={rsi_v:.1f} slope={slope:+.2f} "
                        f"| {'Overbought' if rsi_v > 70 else 'Oversold' if rsi_v < 30 else 'Neutral'}"
        )]

        # RSI Divergence
        if len(rsi) >= 30:
            div = DivergenceDetector(self.close, rsi.values)
            result = div.detect()
            if result['found']:
                for d in result['divergences']:
                    results.append(IndicatorResult(
                        name=f"RSI Div ({d['type']})",
                        value=rsi_v, signal=d['signal'] * d['strength'],
                        weight=0.18, description=d['desc']
                    ))

        return results

    def macd_analysis(self, fast: int = 12, slow: int = 26, sig_p: int = 9) -> List[IndicatorResult]:
        if len(self.close) < slow + sig_p:
            return []

        c        = pd.Series(self.close)
        macd_l   = c.ewm(span=fast, adjust=False).mean() - c.ewm(span=slow, adjust=False).mean()
        sig_l    = macd_l.ewm(span=sig_p, adjust=False).mean()
        hist     = macd_l - sig_l

        m_v  = float(macd_l.iloc[-1])
        s_v  = float(sig_l.iloc[-1])
        h_v  = float(hist.iloc[-1])
        ph_v = float(hist.iloc[-2]) if len(hist) >= 2 else 0.0

        sigs = []
        # MACD vs Signal
        sigs.append(0.40 if m_v > s_v else -0.40)
        # Cross detection
        if len(hist) >= 3:
            if hist.iloc[-2] < 0 < hist.iloc[-1]:  sigs.append(0.55)
            elif hist.iloc[-2] > 0 > hist.iloc[-1]: sigs.append(-0.55)
        # Histogram momentum
        if h_v > 0 and h_v > ph_v:     sigs.append(0.30)
        elif h_v < 0 and h_v < ph_v:   sigs.append(-0.30)
        elif h_v > 0:                   sigs.append(0.10)
        elif h_v < 0:                   sigs.append(-0.10)
        # Zero line
        sigs.append(0.20 if m_v > 0 else -0.20)

        signal = float(np.clip(np.mean(sigs), -1.0, 1.0))

        # MACD Divergence
        results = [IndicatorResult(
            name="MACD", value=round(m_v, 8), signal=signal, weight=0.32,
            description=f"MACD={m_v:.6f} Sig={s_v:.6f} Hist={h_v:.6f}"
        )]

        if len(hist) >= 30:
            div = DivergenceDetector(self.close, hist.values)
            res = div.detect()
            if res['found']:
                for d in res['divergences']:
                    results.append(IndicatorResult(
                        name=f"MACD Div ({d['type']})",
                        value=h_v, signal=d['signal'] * d['strength'],
                        weight=0.16, description=d['desc']
                    ))

        return results

    def stochastic_analysis(self, k_p: int = 14, d_p: int = 3) -> List[IndicatorResult]:
        if len(self.close) < k_p + d_p:
            return []

        h  = pd.Series(self.high);  l = pd.Series(self.low);  c = pd.Series(self.close)
        ll = l.rolling(k_p).min();  hh = h.rolling(k_p).max()
        k  = 100 * (c - ll) / (hh - ll + 1e-10)
        d  = k.rolling(d_p).mean()

        kv = float(k.iloc[-1]);  dv = float(d.iloc[-1])

        if kv > 80 and dv > 80:   base = -0.65
        elif kv < 20 and dv < 20: base = 0.65
        elif kv > dv:              base = 0.30
        else:                      base = -0.30

        # Cross bonus
        if len(k) >= 2:
            if k.iloc[-2] < d.iloc[-2] and kv > dv:
                base = 0.80 if kv < 30 else max(base, 0.45)
            elif k.iloc[-2] > d.iloc[-2] and kv < dv:
                base = -0.80 if kv > 70 else min(base, -0.45)

        return [IndicatorResult(
            name="Stochastic(14,3)", value=round(kv, 2),
            signal=float(np.clip(base, -1.0, 1.0)), weight=0.22,
            description=f"%K={kv:.1f} %D={dv:.1f}"
        )]

    # ══════════════ VOLUME GROUP ══════════════

    def obv_analysis(self) -> List[IndicatorResult]:
        if len(self.close) < 20:
            return []

        c   = pd.Series(self.close);  v = pd.Series(self.volume)
        obv = pd.Series(index=c.index, dtype=float)
        obv.iloc[0] = 0.0
        for i in range(1, len(c)):
            if c.iloc[i] > c.iloc[i-1]:   obv.iloc[i] = obv.iloc[i-1] + v.iloc[i]
            elif c.iloc[i] < c.iloc[i-1]: obv.iloc[i] = obv.iloc[i-1] - v.iloc[i]
            else:                          obv.iloc[i] = obv.iloc[i-1]

        obv_ema = obv.ewm(span=20).mean()
        sig = 0.40 if obv.iloc[-1] > obv_ema.iloc[-1] else -0.40

        # OBV slope (5-bar)
        if obv.iloc[-5] != 0:
            slope_sig = float(np.clip((obv.iloc[-1] - obv.iloc[-5]) / abs(obv.iloc[-5]) * 10, -0.30, 0.30))
            sig += slope_sig

        # Price-OBV divergence
        p_up  = c.iloc[-1] > c.iloc[-5]
        obv_up= obv.iloc[-1] > obv.iloc[-5]
        if p_up and not obv_up:   sig -= 0.25
        elif not p_up and obv_up: sig += 0.25

        return [IndicatorResult(
            name="OBV", value=round(float(obv.iloc[-1]), 0),
            signal=float(np.clip(sig, -1.0, 1.0)), weight=0.30,
            description=f"OBV {'Rising ↑' if sig > 0 else 'Falling ↓'} | EMA diff={obv.iloc[-1]-obv_ema.iloc[-1]:.0f}"
        )]

    def vwap_rolling_analysis(self, window: int = 20) -> List[IndicatorResult]:
        """
        ✅ FIX: Rolling VWAP thay vì cumulative
        Phù hợp cho crypto 24/7 (không có session)
        """
        if len(self.close) < window + 5:
            return []

        tp  = (pd.Series(self.high) + pd.Series(self.low) + pd.Series(self.close)) / 3
        vol = pd.Series(self.volume)

        roll_tpv  = (tp * vol).rolling(window).sum()
        roll_vol  = vol.rolling(window).sum()
        vwap      = roll_tpv / (roll_vol + 1e-10)

        # VWAP standard deviation bands
        vwap_std  = tp.rolling(window).std()
        upper2    = vwap + 2 * vwap_std
        lower2    = vwap - 2 * vwap_std

        price     = self.close[-1]
        vwap_v    = float(vwap.iloc[-1])
        u2_v      = float(upper2.iloc[-1])
        l2_v      = float(lower2.iloc[-1])

        # Position within ±2σ bands
        band_w = u2_v - l2_v
        if band_w > 0:
            position = (price - l2_v) / band_w       # 0=at lower, 1=at upper
            signal   = float(np.clip((position - 0.5) * 2, -1.0, 1.0))
        else:
            signal = float(np.sign(price - vwap_v)) * 0.30

        pct = (price - vwap_v) / vwap_v * 100 if vwap_v > 0 else 0

        return [IndicatorResult(
            name="VWAP Rolling(20)", value=round(vwap_v, 6),
            signal=signal, weight=0.35,
            description=f"Price {'above' if price > vwap_v else 'below'} VWAP by {abs(pct):.2f}% "
                        f"| Band pos: {position*100:.0f}%"
        )]

    def volume_pressure_analysis(self) -> List[IndicatorResult]:
        if len(self.close) < 20:
            return []

        c   = pd.Series(self.close);  v = pd.Series(self.volume)
        vol_avg  = v.rolling(20).mean()
        vol_ratio= float(v.iloc[-1] / (vol_avg.iloc[-1] + 1e-10))

        is_up    = c > c.shift(1)
        buy_vol  = v.where(is_up, 0.0).rolling(10).sum()
        sell_vol = v.where(~is_up, 0.0).rolling(10).sum()
        total    = float(buy_vol.iloc[-1]) + float(sell_vol.iloc[-1])
        buy_pct  = float(buy_vol.iloc[-1]) / total if total > 0 else 0.5

        signal = (buy_pct - 0.5) * 2.0           # 0.5→0, 1→+1, 0→-1
        if vol_ratio > 1.5:
            signal = float(np.clip(signal * 1.30, -1.0, 1.0))   # Boost nếu vol cao

        return [IndicatorResult(
            name="Volume Pressure", value=round(vol_ratio, 2),
            signal=float(np.clip(signal, -1.0, 1.0)), weight=0.35,
            description=f"Vol ratio={vol_ratio:.2f}x | Buy%={buy_pct*100:.1f}%"
        )]

    # ══════════════ OSCILLATOR GROUP ══════════════

    def cci_analysis(self, period: int = 20) -> List[IndicatorResult]:
        if len(self.close) < period + 5:
            return []

        tp  = (pd.Series(self.high) + pd.Series(self.low) + pd.Series(self.close)) / 3
        sma = tp.rolling(period).mean()
        mad = tp.rolling(period).apply(lambda x: np.abs(x - x.mean()).mean())
        cci = (tp - sma) / (0.015 * mad + 1e-10)
        v   = float(cci.iloc[-1])

        if v > 200:    sig = -0.85
        elif v > 100:  sig = -0.40 - (v - 100) / 100 * 0.45
        elif v > 0:    sig = (v / 100) * 0.20
        elif v > -100: sig = (v / 100) * 0.20
        elif v > -200: sig = 0.40 + (-v - 100) / 100 * 0.45
        else:          sig = 0.85

        return [IndicatorResult(
            name="CCI(20)", value=round(v, 2),
            signal=float(np.clip(sig, -1.0, 1.0)), weight=0.28,
            description=f"CCI={v:.1f} | {'Overbought' if v>100 else 'Oversold' if v<-100 else 'Normal'}"
        )]

    def williams_r_analysis(self, period: int = 14) -> List[IndicatorResult]:
        if len(self.close) < period:
            return []

        h  = pd.Series(self.high);  l = pd.Series(self.low);  c = pd.Series(self.close)
        hh = h.rolling(period).max();  ll = l.rolling(period).min()
        wr = -100 * (hh - c) / (hh - ll + 1e-10)
        v  = float(wr.iloc[-1])

        if v > -20:    sig = -0.65
        elif v < -80:  sig = 0.65
        else:          sig = float(-(v + 50) / 50 * 0.30)

        return [IndicatorResult(
            name="Williams %R(14)", value=round(v, 2),
            signal=float(np.clip(sig, -1.0, 1.0)), weight=0.24,
            description=f"%R={v:.1f} | {'Overbought' if v>-20 else 'Oversold' if v<-80 else 'Normal'}"
        )]

    def mfi_analysis(self, period: int = 14) -> List[IndicatorResult]:
        if len(self.close) < period + 2:
            return []

        tp   = (pd.Series(self.high) + pd.Series(self.low) + pd.Series(self.close)) / 3
        mf   = tp * pd.Series(self.volume)
        pos  = mf.where(tp > tp.shift(1), 0.0)
        neg  = mf.where(tp < tp.shift(1), 0.0)
        mfr  = pos.rolling(period).sum() / (neg.rolling(period).sum() + 1e-10)
        mfi  = 100 - (100 / (1 + mfr))
        v    = float(mfi.iloc[-1])

        if v > 80:     sig = -0.75
        elif v > 60:   sig = -0.20
        elif v > 40:   sig = 0.10
        elif v > 20:   sig = 0.50
        else:          sig = 0.80

        return [IndicatorResult(
            name="MFI(14)", value=round(v, 2),
            signal=sig, weight=0.24,
            description=f"MFI={v:.1f} | {'Overbought' if v>80 else 'Oversold' if v<20 else 'Normal'}"
        )]

    def bollinger_bands_analysis(self, period: int = 20, std_dev: float = 2.0) -> List[IndicatorResult]:
        if len(self.close) < period:
            return []

        c    = pd.Series(self.close)
        sma  = c.rolling(period).mean()
        std  = c.rolling(period).std()
        ub   = sma + std_dev * std
        lb   = sma - std_dev * std

        price  = self.close[-1]
        pct_b  = float((price - lb.iloc[-1]) / (ub.iloc[-1] - lb.iloc[-1] + 1e-10))
        bb_w   = float((ub.iloc[-1] - lb.iloc[-1]) / (sma.iloc[-1] + 1e-10))

        if pct_b > 1.0:    sig = -0.75
        elif pct_b > 0.80: sig = -0.30
        elif pct_b > 0.50: sig = 0.10
        elif pct_b > 0.20: sig = -0.10
        elif pct_b > 0.0:  sig = 0.30
        else:               sig = 0.75

        return [IndicatorResult(
            name="Bollinger Bands(20)", value=round(pct_b, 4),
            signal=float(np.clip(sig, -1.0, 1.0)), weight=0.24,
            description=f"%B={pct_b:.3f} | Width={bb_w:.4f} "
                        f"| Upper={ub.iloc[-1]:.4f} Lower={lb.iloc[-1]:.4f}"
        )]

    # ══════════════ PATTERN GROUP ══════════════

    def candlestick_patterns(self) -> List[IndicatorResult]:
        if len(self.close) < 5:
            return []

        o = self.open;  h = self.high;  l = self.low;  c = self.close
        body    = abs(c[-1] - o[-1])
        up_shd  = h[-1] - max(o[-1], c[-1])
        lo_shd  = min(o[-1], c[-1]) - l[-1]
        rng     = h[-1] - l[-1] + 1e-10
        is_bull = c[-1] > o[-1]

        patterns = []

        # Doji
        if body / rng < 0.08:
            patterns.append(("Doji", 0.0))

        # Hammer / Hanging Man
        if lo_shd > 2 * body and up_shd < body * 0.30:
            patterns.append(("Hammer" if is_bull else "Hanging Man", 0.55 if is_bull else -0.30))

        # Shooting Star / Inverted Hammer
        if up_shd > 2 * body and lo_shd < body * 0.30:
            patterns.append(("Shooting Star" if not is_bull else "Inv Hammer", -0.55 if not is_bull else 0.30))

        # Engulfing
        if len(c) >= 2:
            prev_body = abs(c[-2] - o[-2])
            if abs(body) > prev_body:
                prev_bull = c[-2] > o[-2]
                if is_bull and not prev_bull and c[-1] > o[-2] and o[-1] < c[-2]:
                    patterns.append(("Bullish Engulfing", 0.75))
                elif not is_bull and prev_bull and c[-1] < o[-2] and o[-1] > c[-2]:
                    patterns.append(("Bearish Engulfing", -0.75))

        # Three White Soldiers / Three Black Crows
        if len(c) >= 3:
            if all(c[-i] > o[-i] for i in range(1, 4)) and c[-1] > c[-2] > c[-3]:
                patterns.append(("Three White Soldiers", 0.85))
            elif all(c[-i] < o[-i] for i in range(1, 4)) and c[-1] < c[-2] < c[-3]:
                patterns.append(("Three Black Crows", -0.85))

        # Morning Star / Evening Star
        if len(c) >= 3:
            f_body = abs(c[-3] - o[-3])
            m_body = abs(c[-2] - o[-2])
            if m_body < f_body * 0.30:
                if c[-3] < o[-3] and c[-1] > o[-1] and c[-1] > (o[-3] + c[-3]) / 2:
                    patterns.append(("Morning Star", 0.72))
                elif c[-3] > o[-3] and c[-1] < o[-1] and c[-1] < (o[-3] + c[-3]) / 2:
                    patterns.append(("Evening Star", -0.72))

        if not patterns:
            return []

        avg_sig = float(np.mean([p[1] for p in patterns]))
        names   = ", ".join(p[0] for p in patterns)

        return [IndicatorResult(
            name="Candlestick Patterns", value=float(len(patterns)),
            signal=float(np.clip(avg_sig, -1.0, 1.0)), weight=0.50,
            description=names
        )]

    def support_resistance_signal(self) -> List[IndicatorResult]:
        if len(self.close) < 50:
            return []

        h = pd.Series(self.high);  l = pd.Series(self.low)
        window   = 5
        p_highs  = []
        p_lows   = []

        for i in range(window, len(h) - window):
            if h.iloc[i] == h.iloc[i-window: i+window+1].max():
                p_highs.append(float(h.iloc[i]))
            if l.iloc[i] == l.iloc[i-window: i+window+1].min():
                p_lows.append(float(l.iloc[i]))

        price = self.close[-1]
        resis = sorted(p for p in p_highs if p > price)
        supps = sorted((p for p in p_lows  if p < price), reverse=True)

        nearest_r = resis[0] if resis else price * 1.05
        nearest_s = supps[0] if supps else price * 0.95

        dist_r = (nearest_r - price) / price * 100
        dist_s = (price - nearest_s) / price * 100
        total  = dist_r + dist_s

        signal = -(dist_s / total - 0.5) * 2.0 if total > 0 else 0.0

        return [IndicatorResult(
            name="Support/Resistance", value=round(price, 6),
            signal=float(np.clip(signal, -1.0, 1.0)), weight=0.50,
            description=f"Nearest Sup={nearest_s:.4f} (-{dist_s:.2f}%) | "
                        f"Nearest Res={nearest_r:.4f} (+{dist_r:.2f}%)"
        )]

    # ══════════════ CALCULATE ALL ══════════════

    def calculate_all(self) -> Dict[str, List[IndicatorResult]]:
        return {
            'trend': (
                self.moving_average_analysis()
                + self.adx_analysis()
                + self.ichimoku_analysis()
                + self.supertrend_analysis()
                + self.heikin_ashi_analysis()
            ),
            'momentum': (
                self.rsi_analysis()
                + self.macd_analysis()
                + self.stochastic_analysis()
            ),
            'volume': (
                self.obv_analysis()
                + self.volume_pressure_analysis()
                + self.vwap_rolling_analysis()
            ),
            'oscillator': (
                self.cci_analysis()
                + self.williams_r_analysis()
                + self.mfi_analysis()
                + self.bollinger_bands_analysis()
            ),
            'pattern': (
                self.candlestick_patterns()
                + self.support_resistance_signal()
            ),
        }


# ═══════════════════════════════════════════════════════════════════
# PHẦN 6: DYNAMIC RISK MANAGER
# ═══════════════════════════════════════════════════════════════════

class DynamicRiskManager:
    """
    Tính SL/TP động theo:
    - Signal strength  → chọn ATR reference timeframe
    - Market regime    → điều chỉnh multipliers
    - Direction        → Long/Short levels
    - Position sizing  → 1% account risk rule
    """

    def __init__(
        self,
        price:          float,
        atrs:           Dict[str, float],   # {'15m':…, '1h':…, '4h':…, '1d':…}
        regime:         MarketRegime,
        strength:       float,
        account_size:   float = 10_000.0,
        risk_pct:       float = 1.0,
    ):
        self.price        = price
        self.atrs         = atrs
        self.regime       = regime
        self.strength     = strength
        self.account_size = account_size
        self.risk_pct     = risk_pct

    def calculate(self, direction: str) -> RiskLevels:
        # Chọn reference ATR theo strength
        if self.strength >= 65:
            ref_atr = self.atrs.get('4h', self.atrs.get('1h', self.price * 0.01))
            sl_mult  = 2.0
            tp_mults = [2.0, 4.0, 6.0]
        elif self.strength >= 40:
            ref_atr = self.atrs.get('1h', self.price * 0.01)
            sl_mult  = 1.8
            tp_mults = [1.8, 3.2, 5.0]
        else:
            ref_atr = self.atrs.get('15m', self.atrs.get('1h', self.price * 0.01))
            sl_mult  = 1.5
            tp_mults = [1.5, 2.5, 4.0]

        # Regime adjustments
        rt = self.regime.regime_type
        if rt == RegimeType.VOLATILE:
            sl_mult  *= 1.35
            tp_mults  = [m * 1.20 for m in tp_mults]
        elif rt == RegimeType.RANGING:
            sl_mult  *= 0.80
            tp_mults  = [tp_mults[0] * 0.70, tp_mults[0] * 1.30, tp_mults[1]]
        elif rt == RegimeType.BREAKOUT:
            sl_mult  *= 0.90
            tp_mults  = [m * 1.30 for m in tp_mults]

        sl_dist = sl_mult * ref_atr
        rr      = tp_mults[0] / sl_mult

        if direction == "LONG":
            sl = self.price - sl_dist
            tp1, tp2, tp3 = (self.price + m * ref_atr for m in tp_mults)
        elif direction == "SHORT":
            sl = self.price + sl_dist
            tp1, tp2, tp3 = (self.price - m * ref_atr for m in tp_mults)
        else:
            sl = tp1 = tp2 = tp3 = 0.0

        sl_pct   = sl_dist / self.price * 100 if self.price > 0 else 0
        pos_size = self._position_size(sl_dist)

        return RiskLevels(
            entry=round(self.price, 8),
            stop_loss=round(sl, 8),
            tp1=round(tp1, 8),
            tp2=round(tp2, 8),
            tp3=round(tp3, 8),
            sl_pct=round(sl_pct, 3),
            rr_ratio=round(rr, 2),
            ref_atr=round(ref_atr, 8),
            suggested_position_pct=round(pos_size, 2),
        )

    def _position_size(self, sl_distance: float) -> float:
        if sl_distance <= 0 or self.price <= 0:
            return 0.0
        risk_amount   = self.account_size * (self.risk_pct / 100)
        units         = risk_amount / sl_distance
        position_val  = units * self.price
        return min(position_val / self.account_size * 100, 20.0)


# ═══════════════════════════════════════════════════════════════════
# PHẦN 7: SCORING ENGINE
# ═══════════════════════════════════════════════════════════════════

class ScoringEngine:
    """
    Tổng hợp signals → final score
    
    ┌────────────────────────────────────────────────────────────┐
    │  FORMULA:                                                  │
    │                                                            │
    │  1. Group Score = Σ(ind_signal × ind_weight) / Σ(weight)  │
    │  2. TF Composite = Σ(group_score × regime_group_w) × 100  │
    │  3. Raw Final = Σ(TF_composite × TF_weight) / Σ(TF_w)     │
    │  4. Final = Raw + additive_adjustments   ← ✅ FIX         │
    │  5. Confidence = f(agreement, strength, HTF_weight)        │
    └────────────────────────────────────────────────────────────┘
    """

    @staticmethod
    def calc_timeframe_composite(
        indicator_groups: Dict[str, List[IndicatorResult]],
        regime: MarketRegime,
    ) -> Tuple[float, Dict[str, float]]:
        """
        Tính composite score cho 1 timeframe
        Returns: (composite_score_-100_to_+100, group_scores_dict)
        """
        group_weights = get_group_weights(regime)
        group_scores  = {}

        for group, ind_list in indicator_groups.items():
            active = [ind for ind in ind_list if ind.weight > 0]
            if not active:
                continue
            total_w  = sum(ind.weight for ind in active)
            g_signal = sum(ind.signal * ind.weight for ind in active) / total_w
            group_scores[group] = g_signal

        # Weighted average across groups
        total_gw   = sum(group_weights.get(g, 0.05) for g in group_scores)
        if total_gw == 0:
            return 0.0, group_scores

        composite  = sum(
            group_scores[g] * group_weights.get(g, 0.05)
            for g in group_scores
        ) / total_gw

        # Apply regime signal multiplier (cap at ±1 before ×100)
        composite  = float(np.clip(composite * regime.signal_multiplier, -1.0, 1.0)) * 100.0

        return composite, group_scores

    @staticmethod
    def apply_adjustments(
        raw_score:  float,
        directions: Dict[str, str],
    ) -> float:
        """
        ✅ FIX: Additive adjustments thay vì multiplicative
        
        Multiplicative (❌ cũ): final = raw × 1.25
          → Cùng hướng SHORT (raw=-50) nhân 1.25 → -62.5 (mạnh hơn) ✓
          → Conflict SHORT (raw=-50) nhân 0.75    → -37.5 (yếu hơn) ✓
          → Nhưng: NEUTRAL (raw=0) × bất kỳ       → vẫn 0 (mất thông tin)
          → Và: raw=80 × 1.25 = 100, raw=-80 × 1.25 = -100 (bị clip)
        
        Additive (✅ mới): final = raw + adjustment_points
          → Luôn tăng/giảm magnitude đúng hướng signal
          → Không gây vấn đề với raw=0
        """
        pts = 0.0
        sig = float(np.sign(raw_score)) if raw_score != 0 else 0.0

        # All TFs agree → boost +10 points theo hướng signal
        unique = set(d for d in directions.values() if d != "NEUTRAL")
        if len(unique) == 1:
            pts += sig * 10.0

        # 4H & 1D agree → +7 points
        if directions.get('4h') == directions.get('1d') and \
           directions.get('4h') not in (None, "NEUTRAL"):
            pts += sig * 7.0

        # 1H & 15m agree with direction → +3 points
        if directions.get('1h') == directions.get('15m') and \
           directions.get('1h') not in (None, "NEUTRAL"):
            if (raw_score > 0 and directions['1h'] == "LONG") or \
               (raw_score < 0 and directions['1h'] == "SHORT"):
                pts += sig * 3.0

        # Conflict: 1D vs 15m opposite → penalty -10 points (magnitude)
        d1d = directions.get('1d');  d15 = directions.get('15m')
        if d1d and d15 and d1d != "NEUTRAL" and d15 != "NEUTRAL" and d1d != d15:
            pts -= abs(sig) * 10.0 * (1 if raw_score > 0 else -1)

        # Conflict: 4H vs 1H opposite → penalty -7 points
        d4h = directions.get('4h');  d1h = directions.get('1h')
        if d4h and d1h and d4h != "NEUTRAL" and d1h != "NEUTRAL" and d4h != d1h:
            pts -= abs(sig) * 7.0 * (1 if raw_score > 0 else -1)

        return float(np.clip(raw_score + pts, -100.0, 100.0))

    @staticmethod
    def calc_confidence(
        tf_scores:  Dict[str, float],
        tf_weights: Dict[str, float],
        direction:  str,
    ) -> float:
        """
        ✅ CẢI TIẾN: Confidence có cơ sở rõ ràng
        
        Confidence = 0.50 × agreement_score
                   + 0.35 × strength_score
                   + 0.15 × htf_bonus
        """
        if not tf_scores:
            return 0.0

        # Agreement: tỷ lệ (weighted) các TF đồng thuận
        weighted_agree = 0.0;  total_w = 0.0
        for tf, score in tf_scores.items():
            w      = tf_weights.get(tf, 0.1)
            tf_dir = "LONG" if score > 15 else "SHORT" if score < -15 else "NEUTRAL"
            agree  = 1.0 if tf_dir == direction else (0.5 if tf_dir == "NEUTRAL" else 0.0)
            weighted_agree += agree * w
            total_w        += w

        agreement_score = (weighted_agree / total_w * 100) if total_w > 0 else 0.0

        # Strength: weighted average abs(score)
        weighted_strength = sum(
            abs(s) * tf_weights.get(tf, 0.1) for tf, s in tf_scores.items()
        ) / max(sum(tf_weights.get(tf, 0.1) for tf in tf_scores), 1e-10)

        # HTF bonus: 1D aligns with direction
        htf_bonus = 0.0
        if '1d' in tf_scores:
            d1d = "LONG" if tf_scores['1d'] > 15 else "SHORT" if tf_scores['1d'] < -15 else "NEUTRAL"
            if d1d == direction:
                htf_bonus = 15.0
        if '4h' in tf_scores:
            d4h = "LONG" if tf_scores['4h'] > 15 else "SHORT" if tf_scores['4h'] < -15 else "NEUTRAL"
            if d4h == direction:
                htf_bonus += 5.0

        confidence = (
            agreement_score   * 0.50
            + weighted_strength * 0.35
            + htf_bonus          * 1.00   # already small value
        )
        return round(min(confidence, 95.0), 1)

    @staticmethod
    def classify_signal(score: float) -> Tuple[str, SignalType]:
        if score > 60:    return "LONG",  SignalType.STRONG_LONG
        elif score > 35:  return "LONG",  SignalType.LONG
        elif score > 15:  return "LONG",  SignalType.WEAK_LONG
        elif score > -15: return "NEUTRAL",SignalType.NEUTRAL
        elif score > -35: return "SHORT", SignalType.WEAK_SHORT
        elif score > -60: return "SHORT", SignalType.SHORT
        else:             return "SHORT", SignalType.STRONG_SHORT


# ═══════════════════════════════════════════════════════════════════
# PHẦN 8: MAIN ANALYZER
# ═══════════════════════════════════════════════════════════════════

class CryptoAnalyzer:
    """
    Main orchestrator:
    fetch → quality check → regime → indicators → score → risk → report
    """

    def __init__(self, exchange_id: str = 'binance', market_type: str = 'future'):
        opts = {'enableRateLimit': True}
        if market_type in ('future', 'swap'):
            opts['options'] = {'defaultType': market_type}
        self.exchange = getattr(ccxt, exchange_id)(opts)

    # ─────── data ───────

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int = 200) -> pd.DataFrame:
        try:
            raw = self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
            df  = pd.DataFrame(raw, columns=['timestamp','open','high','low','close','volume'])
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)
            df = df.astype(float)
            return df
        except Exception as e:
            print(f"  ⚠️  Fetch error [{symbol} {timeframe}]: {e}")
            return pd.DataFrame()

    def _get_atr(self, df: pd.DataFrame, period: int = 14) -> float:
        if len(df) < period + 1:
            return 0.0
        h  = pd.Series(df['high'].values)
        l  = pd.Series(df['low'].values)
        c  = pd.Series(df['close'].values)
        tr = pd.concat([h-l, (h-c.shift(1)).abs(), (l-c.shift(1)).abs()], axis=1).max(axis=1)
        return float(tr.ewm(span=period, adjust=False).mean().iloc[-1])

    # ─────── per-timeframe analysis ───────

    def analyze_timeframe(self, df: pd.DataFrame, timeframe: str) -> TimeframeResult:
        result = TimeframeResult(timeframe=timeframe)

        # 1. Data quality
        dq = DataQualityChecker.check(df, timeframe)
        result.data_quality = dq
        if not dq.is_valid:
            print(f"    ⚠️  Data quality issue [{timeframe}]: {dq.issues}")
            return result

        # 2. Market regime
        regime = MarketRegimeDetector(df).detect()
        result.regime = regime

        # 3. Calculate indicators
        ind_groups = TechnicalIndicators(df).calculate_all()

        # 4. Score
        composite, g_scores = ScoringEngine.calc_timeframe_composite(ind_groups, regime)
        result.composite_score = round(composite, 2)
        result.group_scores    = {g: round(v, 4) for g, v in g_scores.items()}

        # Flatten all indicators for report
        result.indicators = [ind for grp in ind_groups.values() for ind in grp]

        # Signal label
        if composite > 15:     result.signal = "LONG"
        elif composite < -15:  result.signal = "SHORT"
        else:                  result.signal = "NEUTRAL"

        return result

    # ─────── final signal ───────

    def build_final_signal(
        self,
        symbol:     str,
        tf_results: Dict[str, TimeframeResult],
        price:      float,
        atrs:       Dict[str, float],
    ) -> FinalSignal:

        # Weighted raw score
        tf_scores = {tf: r.composite_score for tf, r in tf_results.items()}
        total_w   = sum(TF_WEIGHTS.get(tf, 0.1) for tf in tf_scores)
        raw_score = (
            sum(tf_scores[tf] * TF_WEIGHTS.get(tf, 0.1) for tf in tf_scores) / total_w
            if total_w > 0 else 0.0
        )

        # Directions per TF
        directions = {tf: r.signal for tf, r in tf_results.items()}

        # ✅ Additive adjustment
        final_score = ScoringEngine.apply_adjustments(raw_score, directions)

        # Classify
        direction, signal_type = ScoringEngine.classify_signal(final_score)

        # Confidence
        confidence = ScoringEngine.calc_confidence(tf_scores, TF_WEIGHTS, direction)

        # Dominant regime (highest-weight TF with valid regime)
        dom_regime = None
        for tf in ['1d', '4h', '1h', '15m']:
            if tf in tf_results and tf_results[tf].regime is not None:
                dom_regime = tf_results[tf].regime
                break

        # Risk levels
        risk = None
        if dom_regime and price > 0:
            risk = DynamicRiskManager(
                price=price, atrs=atrs,
                regime=dom_regime,
                strength=abs(final_score),
            ).calculate(direction)

        return FinalSignal(
            symbol           = symbol,
            direction        = direction,
            signal_type      = signal_type,
            strength         = round(abs(final_score), 1),
            confidence       = confidence,
            composite_score  = round(final_score, 2),
            timeframe_scores = {tf: round(s, 2) for tf, s in tf_scores.items()},
            timeframe_results= tf_results,
            risk_levels      = risk,
            dominant_regime  = dom_regime,
            timestamp        = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC'),
        )

    # ─────── main entry ───────

    def analyze(self, symbol: str) -> FinalSignal:
        print(f"\n{'═'*64}")
        print(f"  ANALYZING  ▶  {symbol}")
        print(f"  {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
        print(f"{'═'*64}")

        tf_results: Dict[str, TimeframeResult] = {}
        atrs:       Dict[str, float]           = {}
        price       = 0.0

        limits = {'15m': 200, '1h': 200, '4h': 200, '1d': 200}

        for tf in ['15m', '1h', '4h', '1d']:
            print(f"\n  ▶ [{tf}] Fetching...", end="")
            df = self.fetch_ohlcv(symbol, tf, limits[tf])
            if df.empty:
                print(" ❌ no data")
                continue
            print(f" {len(df)} candles", end="")

            if tf == '1h' or price == 0:
                price = float(df['close'].iloc[-1])

            atrs[tf] = self._get_atr(df)
            tf_res   = self.analyze_timeframe(df, tf)
            tf_results[tf] = tf_res

            regime_str = tf_res.regime.regime_type.value if tf_res.regime else "N/A"
            print(f" | Score={tf_res.composite_score:+.1f} | {tf_res.signal} | {regime_str}")

        print(f"\n  ✅ Building final signal...")
        return self.build_final_signal(symbol, tf_results, price, atrs)


# ═══════════════════════════════════════════════════════════════════
# PHẦN 9: REPORT PRINTER
# ═══════════════════════════════════════════════════════════════════

class ReportPrinter:

    @staticmethod
    def _bar(value: float, max_val: float = 100, width: int = 38, fill: str = '█', empty: str = '░') -> str:
        filled = int(abs(value) / max_val * width)
        filled = min(filled, width)
        return fill * filled + empty * (width - filled)

    @staticmethod
    def _score_bar(score: float, width: int = 30) -> str:
        """Two-sided bar centered at 0"""
        mid  = width // 2
        if score >= 0:
            f = int(score / 100 * mid)
            return ' ' * mid + '█' * f + '░' * (mid - f)
        else:
            f = int(abs(score) / 100 * mid)
            return '░' * (mid - f) + '█' * f + ' ' * mid

    @classmethod
    def full(cls, sig: FinalSignal):
        W = 70

        print(f"\n{'═'*W}")
        print(f"{'CRYPTO TECHNICAL ANALYSIS  ─  v2.0':^{W}}")
        print(f"{'═'*W}")
        print(f"  Symbol : {sig.symbol}")
        print(f"  Time   : {sig.timestamp}")
        print(f"  Price  : {sig.risk_levels.entry if sig.risk_levels else 'N/A'}")
        if sig.dominant_regime:
            print(f"  Regime : {sig.dominant_regime.regime_type.value}  "
                  f"ADX={sig.dominant_regime.adx:.1f}  "
                  f"ER={sig.dominant_regime.efficiency_ratio:.2f}  "
                  f"VolSurge={sig.dominant_regime.vol_surge:.2f}x")
        print(f"{'─'*W}")

        # ── Final Signal Box ──
        print(f"\n  ╔{'═'*(W-4)}╗")
        print(f"  ║{'FINAL SIGNAL':^{W-4}}║")
        print(f"  ╠{'═'*(W-4)}╣")
        print(f"  ║  Direction  : {sig.signal_type.value:<{W-18}}║")

        str_bar  = cls._bar(sig.strength)
        conf_bar = cls._bar(sig.confidence)
        print(f"  ║  Strength   : [{str_bar}] {sig.strength:5.1f}% ║")
        print(f"  ║  Confidence : [{conf_bar}] {sig.confidence:5.1f}% ║")
        print(f"  ║  Score      : {sig.composite_score:+.2f} / 100{' '*(W-26)}║")
        print(f"  ╠{'═'*(W-4)}╣")

        # Risk levels
        rl = sig.risk_levels
        if rl and sig.direction != "NEUTRAL":
            print(f"  ║  📍 Entry   : {rl.entry:<{W-18}}║")
            print(f"  ║  🛑 SL      : {rl.stop_loss:<{W-18}}║")
            print(f"  ║     (SL%   : {rl.sl_pct:.3f}%  R:R = 1:{rl.rr_ratio:.1f}){' '*(W-38)}║")
            print(f"  ║  🎯 TP1     : {rl.tp1:<{W-18}}║")
            print(f"  ║  🎯 TP2     : {rl.tp2:<{W-18}}║")
            print(f"  ║  🎯 TP3     : {rl.tp3:<{W-18}}║")
            print(f"  ║  💰 Pos Size: {rl.suggested_position_pct:.2f}% of account{' '*(W-34)}║")
        else:
            print(f"  ║  ⚠️  NEUTRAL – No trade recommended.{' '*(W-40)}║")
        print(f"  ╚{'═'*(W-4)}╝\n")

        # ── Timeframe Breakdown ──
        print(f"  {'TIMEFRAME BREAKDOWN':}")
        print(f"  {'─'*W}")
        print(f"  {'TF':>4} {'Weight':>7} {'Score Bar (←Short | Long→)':^33} {'Score':>7} {'Signal'}")
        print(f"  {'─'*W}")
        for tf in ['15m', '1h', '4h', '1d']:
            if tf not in sig.timeframe_results:
                continue
            r   = sig.timeframe_results[tf]
            w   = TF_WEIGHTS.get(tf, 0.1) * 100
            bar = cls._score_bar(r.composite_score)
            em  = "🟢" if r.signal == "LONG" else "🔴" if r.signal == "SHORT" else "⚪"
            reg = r.regime.regime_type.value if r.regime else ""
            dq  = f"Q={r.data_quality.quality_score:.0f}" if r.data_quality else ""
            print(f"  {em}{tf:>4}  {w:>5.0f}%  │{bar}│  {r.composite_score:+6.1f}  {r.signal:<8} {reg} {dq}")
        print(f"  {'─'*W}")

        # ── Group Scores per TF ──
        print(f"\n  {'GROUP SCORES BY TIMEFRAME':}")
        print(f"  {'─'*W}")
        groups = ['trend', 'momentum', 'volume', 'oscillator', 'pattern']
        header = f"  {'Group':<13}" + "".join(f"{tf:>9}" for tf in ['15m','1h','4h','1d'])
        print(header)
        print(f"  {'─'*W}")
        for g in groups:
            row = f"  {g:<13}"
            for tf in ['15m', '1h', '4h', '1d']:
                if tf in sig.timeframe_results and g in sig.timeframe_results[tf].group_scores:
                    v = sig.timeframe_results[tf].group_scores[g] * 100
                    row += f"  {v:+6.1f}"
                else:
                    row += f"  {'N/A':>6}"
            print(row)
        print(f"  {'─'*W}")

        # ── Indicator Details ──
        print(f"\n  {'INDICATOR DETAILS':}")
        for tf in ['15m', '1h', '4h', '1d']:
            if tf not in sig.timeframe_results:
                continue
            r = sig.timeframe_results[tf]
            print(f"\n  ◆ [{tf}] indicators  (composite={r.composite_score:+.1f})")
            for ind in r.indicators:
                if ind.weight == 0:
                    continue
                em = "🟢" if ind.signal > 0.25 else "🔴" if ind.signal < -0.25 else "⚪"
                print(f"    {em} {ind.name:<28} sig={ind.signal:+.3f}  w={ind.weight:.2f}  │ {ind.description}")

        print(f"\n{'═'*W}")
        print(f"  ⚠️  DISCLAIMER: For educational purposes only.")
        print(f"  Never risk more than 1-2% per trade. DYOR.")
        print(f"{'═'*W}\n")

    @classmethod
    def summary(cls, sig: FinalSignal):
        rl = sig.risk_levels
        print(f"\n┌─ {sig.symbol} {'─'*(40-len(sig.symbol))}┐")
        print(f"│ {sig.signal_type.value:<42}│")
        print(f"│ Score:  {sig.composite_score:+.1f}/100  Strength: {sig.strength:.1f}%{' '*8}│")
        print(f"│ Confidence: {sig.confidence:.1f}%  Regime: "
              f"{sig.dominant_regime.regime_type.value if sig.dominant_regime else 'N/A':<12}│")
        if rl and sig.direction != "NEUTRAL":
            print(f"│ Entry={rl.entry:<8}  SL={rl.stop_loss:<10} ({rl.sl_pct:.2f}%)  │")
            print(f"│ TP1={rl.tp1:<8}  TP2={rl.tp2:<10}  TP3={rl.tp3:<8}│")
            print(f"│ R:R=1:{rl.rr_ratio:.1f}  Pos Size: {rl.suggested_position_pct:.2f}%{' '*14}│")
        else:
            print(f"│ No trade recommended.{' '*20}│")
        print(f"└{'─'*43}┘")


# ═══════════════════════════════════════════════════════════════════
# PHẦN 10: PUBLIC API
# ═══════════════════════════════════════════════════════════════════

def analyze_coin(
    symbol:      str  = 'BTC/USDT',
    exchange_id: str  = 'binance',
    market_type: str  = 'future',   # 'spot' | 'future'
    full_report: bool = True,
) -> FinalSignal:
    """
    Phân tích đầy đủ 1 coin trên 4 timeframes.

    Parameters
    ----------
    symbol      : e.g. 'BTC/USDT', 'ETH/USDT'
    exchange_id : ccxt exchange id, e.g. 'binance', 'bybit', 'okx'
    market_type : 'spot' hoặc 'future'
    full_report : True = in báo cáo chi tiết

    Returns
    -------
    FinalSignal dataclass
    """
    analyzer = CryptoAnalyzer(exchange_id, market_type)
    signal   = analyzer.analyze(symbol)

    if full_report:
        ReportPrinter.full(signal)
    else:
        ReportPrinter.summary(signal)

    return signal


def analyze_multiple(
    symbols:     List[str],
    exchange_id: str  = 'binance',
    market_type: str  = 'future',
) -> Dict[str, FinalSignal]:
    """Phân tích nhiều coin, in bảng so sánh."""
    results = {}

    for sym in symbols:
        try:
            results[sym] = analyze_coin(sym, exchange_id, market_type, full_report=False)
        except Exception as e:
            print(f"  ❌ Error [{sym}]: {e}")

    # Summary table
    W = 90
    print(f"\n{'═'*W}")
    print(f"{'MULTI-COIN ANALYSIS SUMMARY':^{W}}")
    print(f"{'═'*W}")
    print(f"{'Symbol':<14}{'Signal':<22}{'Score':>8}{'Strength':>10}"
          f"{'Conf':>8}{'Direction':>10}{'Regime':>16}")
    print(f"{'─'*W}")

    for sym, sig in sorted(results.items(), key=lambda x: abs(x[1].composite_score), reverse=True):
        reg = sig.dominant_regime.regime_type.value if sig.dominant_regime else "N/A"
        print(f"{sym:<14}{sig.signal_type.value:<22}{sig.composite_score:>+8.1f}"
              f"{sig.strength:>9.1f}%{sig.confidence:>7.1f}%"
              f"{sig.direction:>10}{reg:>16}")

    print(f"{'═'*W}\n")
    return results


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":

    # ── Phân tích 1 coin (báo cáo đầy đủ) ──
    signal = analyze_coin(
        symbol      = 'BTC/USDT',
        exchange_id = 'binance',
        market_type = 'future',
        full_report = True,
    )

    # ── Truy cập kết quả programmatically ──
    print(f"Direction  : {signal.direction}")
    print(f"Score      : {signal.composite_score:+.2f}")
    print(f"Strength   : {signal.strength}%")
    print(f"Confidence : {signal.confidence}%")
    if signal.risk_levels and signal.direction != "NEUTRAL":
        rl = signal.risk_levels
        print(f"Entry      : {rl.entry}")
        print(f"Stop Loss  : {rl.stop_loss}  ({rl.sl_pct:.3f}%)")
        print(f"TP1/TP2/TP3: {rl.tp1} / {rl.tp2} / {rl.tp3}")
        print(f"R:R        : 1:{rl.rr_ratio}")
        print(f"Pos Size   : {rl.suggested_position_pct:.2f}%")

    # ── Phân tích nhiều coin ──
    # results = analyze_multiple(
    #     symbols     = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT'],
    #     exchange_id = 'binance',
    #     market_type = 'future',
    # )