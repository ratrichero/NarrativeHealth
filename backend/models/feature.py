from sqlalchemy import Column, Integer, Float, Date, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class Feature(Base):
    __tablename__ = "features"

    id = Column(Integer, primary_key=True, index=True)
    coin_id = Column(Integer, ForeignKey("coins.id", ondelete="CASCADE"), nullable=False)
    date = Column(Date, nullable=False)
    version_id = Column(Integer, ForeignKey("feature_versions.id"), nullable=False)
    
    # Feature scores
    trend_score = Column(Float, nullable=True)
    derivative_score = Column(Float, nullable=True)
    volume_score = Column(Float, nullable=True)
    momentum_score = Column(Float, nullable=True)
    
    # Feature details (JSON)
    trend_detail = Column(JSONB, nullable=True)
    derivative_detail = Column(JSONB, nullable=True)
    volume_detail = Column(JSONB, nullable=True)
    momentum_detail = Column(JSONB, nullable=True)
    
    # Confidence
    confidence_score = Column(Float, nullable=True)
    data_completeness = Column(Float, nullable=True)
    missing_sources = Column(JSONB, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    coin = relationship("Coin", back_populates="features")
    version = relationship("FeatureVersion", back_populates="features")

    __table_args__ = (
        UniqueConstraint("coin_id", "date", "version_id", name="features_unique"),
        Index("features_coin_date_idx", "coin_id", "date"),
    )
