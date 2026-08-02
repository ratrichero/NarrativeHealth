from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class Coin(Base):
    __tablename__ = "coins"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    binance_spot_symbol = Column(String(30), nullable=True)
    binance_futures_symbol = Column(String(30), nullable=True)
    coingecko_id = Column(String(100), nullable=True)
    has_futures = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    coin_narratives = relationship("CoinNarrative", back_populates="coin", cascade="all, delete-orphan")
    market_prices = relationship("MarketPriceDaily", back_populates="coin", cascade="all, delete-orphan")
    metrics = relationship("CoinMetrics", back_populates="coin", cascade="all, delete-orphan")
    features = relationship("Feature", back_populates="coin", cascade="all, delete-orphan")
    health_scores = relationship("HealthScore", back_populates="coin", cascade="all, delete-orphan")
    recommendations = relationship("Recommendation", back_populates="coin", cascade="all, delete-orphan")
    watchlist_items = relationship("Watchlist", back_populates="coin", cascade="all, delete-orphan")
