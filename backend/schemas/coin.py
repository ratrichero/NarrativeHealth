from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime


class CoinBase(BaseModel):
    symbol: str
    name: str
    binance_spot_symbol: Optional[str] = None
    binance_futures_symbol: Optional[str] = None
    coingecko_id: Optional[str] = None


class CoinCreate(CoinBase):
    narrative_ids: Optional[List[int]] = None


class CoinUpdate(BaseModel):
    symbol: Optional[str] = None
    name: Optional[str] = None
    binance_spot_symbol: Optional[str] = None
    binance_futures_symbol: Optional[str] = None
    coingecko_id: Optional[str] = None
    is_active: Optional[bool] = None
    narrative_ids: Optional[List[int]] = None


class CoinResponse(CoinBase):
    id: int
    has_futures: bool
    is_active: bool
    created_at: datetime
    narratives: List[str] = []

    class Config:
        from_attributes = True


class NarrativeInfo(BaseModel):
    id: int
    name: str
    is_primary: bool


class CurrentHealth(BaseModel):
    health_score: float
    previous_score: Optional[float] = None
    score_change: Optional[float] = None
    status: str
    confidence_score: Optional[float] = None


class FeatureData(BaseModel):
    trend_score: Optional[float] = None
    derivative_score: Optional[float] = None
    volume_score: Optional[float] = None
    momentum_score: Optional[float] = None
    trend_detail: Optional[Any] = None
    derivative_detail: Optional[Any] = None
    volume_detail: Optional[Any] = None
    momentum_detail: Optional[Any] = None


class RecommendationData(BaseModel):
    signal: str
    reason: str
    reason_breakdown: Optional[Any] = None


class PriceHistoryPoint(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class HealthHistoryPoint(BaseModel):
    date: str
    score: float


class CoinMetricsData(BaseModel):
    open_interest: Optional[float] = None
    funding_rate: Optional[float] = None
    market_cap: Optional[float] = None
    fully_diluted_valuation: Optional[float] = None
    circulating_supply: Optional[float] = None
    total_supply: Optional[float] = None


class CoinDetail(BaseModel):
    id: int
    symbol: str
    name: str
    binance_spot_symbol: Optional[str] = None
    binance_futures_symbol: Optional[str] = None
    coingecko_id: Optional[str] = None
    has_futures: bool
    is_active: bool
    narratives: List[NarrativeInfo]
    current_health: Optional[CurrentHealth] = None
    features: Optional[FeatureData] = None
    recommendation: Optional[RecommendationData] = None
    health_history: List[HealthHistoryPoint]
    price_history: List[PriceHistoryPoint]
    metrics: Optional[CoinMetricsData] = None
