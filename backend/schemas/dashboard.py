from pydantic import BaseModel
from typing import Optional, List


class CoinBasic(BaseModel):
    id: int
    symbol: str
    name: str
    health_score: float


class SourceState(BaseModel):
    status: str  # OK, PARTIAL, FAILED
    last_success: Optional[str] = None
    records_collected: int = 0


class SourceStatusSummary(BaseModel):
    binance_spot: SourceState
    binance_futures: SourceState
    coingecko: SourceState
    last_update: str


class NarrativeSummary(BaseModel):
    id: int
    name: str
    health_score: float
    previous_score: Optional[float] = None
    score_change: Optional[float] = None
    status: str
    coin_count: int
    top_coin: Optional[CoinBasic] = None
    weakest_coin: Optional[CoinBasic] = None
    avg_confidence: Optional[float] = None
    signal: Optional[str] = None


class CoinMover(BaseModel):
    id: int
    symbol: str
    name: str
    health_score: float
    score_change: float
    narrative_id: Optional[int] = None
    narrative_name: Optional[str] = None


class DashboardData(BaseModel):
    date: str
    narratives: List[NarrativeSummary]
    source_status: SourceStatusSummary
    top_movers: List[CoinMover]
    weakest_coins: List[CoinMover]
    alert_count: int = 0
    last_update: str


class WatchlistItem(BaseModel):
    id: int
    coin_id: int
    symbol: str
    name: str
    note: Optional[str] = None
    priority: int = 0
    health_score: Optional[float] = None
    score_change: Optional[float] = None
    status: Optional[str] = None
    signal: Optional[str] = None
    confidence_score: Optional[float] = None


class RefreshResponse(BaseModel):
    message: str
    coins_processed: int
    duration: str
    errors: Optional[List[str]] = None
