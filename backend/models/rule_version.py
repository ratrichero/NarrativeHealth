from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from backend.database import Base


class RuleVersion(Base):
    __tablename__ = "rule_versions"

    id = Column(Integer, primary_key=True, index=True)
    version = Column(Integer, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    health_weights = Column(JSONB, nullable=False)
    confidence_weights = Column(JSONB, nullable=False)
    recommendation_thresholds = Column(JSONB, nullable=False)
    is_active = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    activated_at = Column(DateTime(timezone=True), nullable=True)
