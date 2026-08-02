from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class HealthScore(Base):
    __tablename__ = "health_scores"

    id = Column(Integer, primary_key=True, index=True)
    coin_id = Column(Integer, ForeignKey("coins.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    health_score = Column(Float, nullable=False)
    previous_score = Column(Float, nullable=True)
    score_change = Column(Float, nullable=True)
    status = Column(String(20), nullable=False)  # STRONG, HEALTHY, NEUTRAL, CAUTION, WEAK
    confidence_score = Column(Float, nullable=True)
    weight_breakdown = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    coin = relationship("Coin", back_populates="health_scores")
    recommendation = relationship("Recommendation", back_populates="health_score", uselist=False)

    __table_args__ = (
        UniqueConstraint("coin_id", "date", name="health_scores_unique"),
        Index("health_scores_idx", "coin_id", "date"),
    )
