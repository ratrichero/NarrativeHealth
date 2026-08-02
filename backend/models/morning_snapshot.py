from sqlalchemy import Column, Integer, Float, Date, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from backend.database import Base


class MorningSnapshot(Base):
    __tablename__ = "morning_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, unique=True, nullable=False)
    snapshot_data = Column(JSONB, nullable=False)
    narrative_count = Column(Integer, nullable=False)
    coin_count = Column(Integer, nullable=False)
    avg_health_score = Column(Float, nullable=True)
    top_narrative_id = Column(Integer, ForeignKey("narratives.id"), nullable=True)
    alert_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
