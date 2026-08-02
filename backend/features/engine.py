"""
Feature Engine - Orchestrates all feature calculations
"""
import pandas as pd
from typing import Dict, Any, Optional, List

from backend.features.trend import calculate_trend_score
from backend.features.derivative import calculate_derivative_score
from backend.features.volume import calculate_volume_score
from backend.features.momentum import calculate_momentum_score
from backend.features.confidence import calculate_confidence


class FeatureEngine:
    """Orchestrates feature calculation for coins"""

    def __init__(
        self,
        health_weights: Dict[str, float] = None,
        confidence_weights: Dict[str, float] = None,
        recommendation_thresholds: Dict[str, int] = None,
    ):
        self.health_weights = health_weights or {
            "trend": 0.35,
            "derivative": 0.35,
            "volume": 0.20,
            "momentum": 0.10,
        }
        self.confidence_weights = confidence_weights or {
            "binance_spot": 0.30,
            "binance_futures": 0.40,
            "coingecko": 0.30,
        }
        self.recommendation_thresholds = recommendation_thresholds or {
            "strong_watch": 90,
            "watch": 80,
            "observe": 65,
        }

    def run(
        self,
        price_data: List[Dict[str, Any]],
        oi_current: Optional[float],
        oi_prev: Optional[float],
        funding_rate: Optional[float],
        has_futures: bool,
        source_ok: Dict[str, bool],
    ) -> Dict[str, Any]:
        """
        Run full feature pipeline for a single coin
        
        price_data: List of {date, open, high, low, close, volume}
        """
        # Convert to DataFrame
        if not price_data:
            return self._empty_result(has_futures)

        df = pd.DataFrame(price_data)

        if len(df) < 20:
            return self._empty_result(has_futures, error="Insufficient price data (need >= 20 rows)")

        # Calculate features
        trend_result = calculate_trend_score(df)
        volume_result = calculate_volume_score(df)
        momentum_result = calculate_momentum_score(df)
        derivative_result = calculate_derivative_score(
            oi_current, oi_prev, funding_rate, has_futures
        )
        confidence_result = calculate_confidence(
            binance_spot_ok=source_ok.get("binance_spot", False),
            binance_futures_ok=source_ok.get("binance_futures", False),
            coingecko_ok=source_ok.get("coingecko", False),
            has_futures=has_futures,
            weights=self.confidence_weights,
        )

        return {
            "trend_score": trend_result["score"],
            "derivative_score": derivative_result["score"],
            "volume_score": volume_result["score"],
            "momentum_score": momentum_result["score"],
            "trend_detail": trend_result["detail"],
            "derivative_detail": derivative_result["detail"],
            "volume_detail": volume_result["detail"],
            "momentum_detail": momentum_result["detail"],
            "confidence_score": confidence_result["confidence_score"],
            "data_completeness": confidence_result["data_completeness"],
            "missing_sources": confidence_result["missing_sources"],
        }

    def calculate_health_score(
        self,
        trend_score: float,
        derivative_score: float,
        volume_score: float,
        momentum_score: float,
    ) -> float:
        """Calculate weighted health score"""
        score = (
            trend_score * self.health_weights["trend"] +
            derivative_score * self.health_weights["derivative"] +
            volume_score * self.health_weights["volume"] +
            momentum_score * self.health_weights["momentum"]
        )
        return round(max(0, min(100, score)), 1)

    def get_health_status(self, score: float) -> str:
        """Get health status from score"""
        if score >= 90:
            return "STRONG"
        if score >= 80:
            return "HEALTHY"
        if score >= 65:
            return "NEUTRAL"
        if score >= 50:
            return "CAUTION"
        return "WEAK"

    def get_recommendation_signal(self, health_score: float) -> str:
        """Get recommendation signal from health score"""
        if health_score >= self.recommendation_thresholds["strong_watch"]:
            return "STRONG_WATCH"
        if health_score >= self.recommendation_thresholds["watch"]:
            return "WATCH"
        if health_score >= self.recommendation_thresholds["observe"]:
            return "OBSERVE"
        return "WEAK"

    def generate_recommendation_reason(
        self,
        signal: str,
        trend_score: float,
        derivative_score: float,
        volume_score: float,
        momentum_score: float,
        confidence_score: float,
    ) -> str:
        """Generate recommendation reason text"""
        parts = []

        # Signal-based opening
        if signal == "STRONG_WATCH":
            parts.append("Strong bullish signals across all metrics.")
        elif signal == "WATCH":
            parts.append("Positive indicators with room for monitoring.")
        elif signal == "OBSERVE":
            parts.append("Mixed signals, continue observing.")
        else:
            parts.append("Weak signals, exercise caution.")

        # Add specific insights
        if trend_score >= 75:
            parts.append("Price above key EMAs.")
        elif trend_score < 40:
            parts.append("Price below key EMAs.")

        if derivative_score >= 75:
            parts.append("Derivatives show accumulation.")
        elif derivative_score < 40:
            parts.append("Derivatives show distribution.")

        if volume_score >= 75:
            parts.append("Volume significantly above average.")
        elif volume_score < 40:
            parts.append("Volume below average.")

        if momentum_score >= 75:
            parts.append("Strong momentum.")
        elif momentum_score < 40:
            parts.append("Weak momentum.")

        # Confidence warning
        if confidence_score < 70:
            parts.append(f"⚠ Data confidence: {confidence_score:.0f}%")

        return " ".join(parts)

    def _empty_result(self, has_futures: bool, error: str = None) -> Dict[str, Any]:
        return {
            "trend_score": 50.0,
            "derivative_score": 50.0,
            "volume_score": 50.0,
            "momentum_score": 50.0,
            "trend_detail": {},
            "derivative_detail": {"no_futures": not has_futures},
            "volume_detail": {},
            "momentum_detail": {},
            "confidence_score": 0.0,
            "data_completeness": 0.0,
            "missing_sources": ["binance_spot", "binance_futures", "coingecko"],
            "error": error,
        }
