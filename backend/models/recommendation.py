from sqlalchemy import Column, Integer, String, Text, Date, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(Integer, primary_key=True, index=True)
    coin_id = Column(Integer, ForeignKey("coins.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    signal = Column(String(30), nullable=False)  # STRONG_WATCH, WATCH, OBSERVE, WEAK
    reason = Column(Text, nullable=False)
    reason_breakdown = Column(JSONB, nullable=True)
    health_score_id = Column(Integer, ForeignKey("health_scores.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    coin = relationship("Coin", back_populates="recommendations")
    health_score = relationship("HealthScore", back_populates="recommendation")

    __table_args__ = (
        UniqueConstraint("coin_id", "date", name="recommendations_unique"),
        Index("recommendations_idx", "coin_id", "date"),
    )
