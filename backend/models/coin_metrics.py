from sqlalchemy import Column, Integer, String, Date, Numeric, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class CoinMetrics(Base):
    __tablename__ = "coin_metrics"

    id = Column(Integer, primary_key=True, index=True)
    coin_id = Column(Integer, ForeignKey("coins.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    open_interest = Column(Numeric(24, 2), nullable=True)
    funding_rate = Column(Numeric(18, 8), nullable=True)
    market_cap = Column(Numeric(24, 2), nullable=True)
    fully_diluted_valuation = Column(Numeric(24, 2), nullable=True)
    circulating_supply = Column(Numeric(24, 2), nullable=True)
    total_supply = Column(Numeric(24, 2), nullable=True)
    source = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    coin = relationship("Coin", back_populates="metrics")

    __table_args__ = (
        UniqueConstraint("coin_id", "date", "source", name="coin_metrics_unique"),
        Index("coin_metrics_idx", "coin_id", "date", "source"),
    )
