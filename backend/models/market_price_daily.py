from sqlalchemy import Column, Integer, String, Date, Numeric, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class MarketPriceDaily(Base):
    __tablename__ = "market_price_daily"

    id = Column(Integer, primary_key=True, index=True)
    coin_id = Column(Integer, ForeignKey("coins.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    open = Column(Numeric(24, 8), nullable=False)
    high = Column(Numeric(24, 8), nullable=False)
    low = Column(Numeric(24, 8), nullable=False)
    close = Column(Numeric(24, 8), nullable=False)
    volume = Column(Numeric(24, 2), nullable=False)
    quote_volume = Column(Numeric(24, 2), nullable=True)
    source = Column(String(50), default="binance", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    coin = relationship("Coin", back_populates="market_prices")

    __table_args__ = (
        UniqueConstraint("coin_id", "date", name="market_price_unique"),
        Index("market_price_coin_date_idx", "coin_id", "date"),
    )
