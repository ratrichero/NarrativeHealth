from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class NarrativeHealth(Base):
    __tablename__ = "narrative_health"

    id = Column(Integer, primary_key=True, index=True)
    narrative_id = Column(Integer, ForeignKey("narratives.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    health_score = Column(Float, nullable=False)
    previous_score = Column(Float, nullable=True)
    score_change = Column(Float, nullable=True)
    status = Column(String(20), nullable=False)
    coin_count = Column(Integer, nullable=False)
    top_coin_id = Column(Integer, ForeignKey("coins.id"), nullable=True)
    weakest_coin_id = Column(Integer, ForeignKey("coins.id"), nullable=True)
    avg_confidence = Column(Float, nullable=True)
    coin_breakdown = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    narrative = relationship("Narrative", back_populates="narrative_health")

    __table_args__ = (
        UniqueConstraint("narrative_id", "date", name="narrative_health_unique"),
        Index("narrative_health_idx", "narrative_id", "date"),
    )
