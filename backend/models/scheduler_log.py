from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from backend.database import Base


class SchedulerLog(Base):
    __tablename__ = "scheduler_logs"

    id = Column(Integer, primary_key=True, index=True)
    job_name = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False)  # STARTED, COMPLETED, FAILED
    started_at = Column(DateTime(timezone=True), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    duration = Column(Integer, nullable=True)  # in seconds
    records_processed = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    details = Column(JSONB, nullable=True)
