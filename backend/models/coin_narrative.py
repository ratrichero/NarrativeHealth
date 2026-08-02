from sqlalchemy import Column, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class CoinNarrative(Base):
    __tablename__ = "coin_narratives"

    coin_id = Column(Integer, ForeignKey("coins.id", ondelete="CASCADE"), primary_key=True)
    narrative_id = Column(Integer, ForeignKey("narratives.id", ondelete="CASCADE"), primary_key=True)
    is_primary = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    coin = relationship("Coin", back_populates="coin_narratives")
    narrative = relationship("Narrative", back_populates="coin_narratives")
