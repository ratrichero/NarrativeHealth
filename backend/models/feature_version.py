from sqlalchemy import Column, Integer, Text, Boolean, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from backend.database import Base


class FeatureVersion(Base):
    __tablename__ = "feature_versions"

    id = Column(Integer, primary_key=True, index=True)
    version = Column(Integer, unique=True, nullable=False)
    description = Column(Text, nullable=True)
    algorithm = Column(JSONB, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    features = relationship("Feature", back_populates="version")
