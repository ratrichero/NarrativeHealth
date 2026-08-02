from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class NarrativeBase(BaseModel):
    name: str
    description: Optional[str] = None


class NarrativeCreate(NarrativeBase):
    pass


class NarrativeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class NarrativeResponse(NarrativeBase):
    id: int
    is_active: bool
    created_at: datetime
    coin_count: int = 0

    class Config:
        from_attributes = True


class CoinInNarrative(BaseModel):
    id: int
    symbol: str
    name: str
    health_score: float
    score_change: Optional[float] = None
    status: str
    signal: str
    reason: str
    confidence_score: Optional[float] = None
    trend_score: Optional[float] = None
    derivative_score: Optional[float] = None
    volume_score: Optional[float] = None
    momentum_score: Optional[float] = None


class HealthHistoryPoint(BaseModel):
    date: str
    score: float


class NarrativeDetail(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    is_active: bool
    health_score: float
    previous_score: Optional[float] = None
    score_change: Optional[float] = None
    status: str
    avg_confidence: Optional[float] = None
    coins: List[CoinInNarrative]
    health_history: List[HealthHistoryPoint]
