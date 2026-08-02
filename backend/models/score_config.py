from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from backend.database import Base


class ScoreConfig(Base):
    __tablename__ = "score_configs"

    id = Column(Integer, primary_key=True, index=True)
    config_type = Column(String(50), nullable=False)  # health_weights, recommendation_thresholds, etc.
    config_key = Column(String(100), nullable=False)
    config_value = Column(JSONB, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
