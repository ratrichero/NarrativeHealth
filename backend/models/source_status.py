from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.sql import func
from backend.database import Base


class SourceStatus(Base):
    __tablename__ = "source_status"

    id = Column(Integer, primary_key=True, index=True)
    source = Column(String(50), nullable=False)  # binance_spot, binance_futures, coingecko
    coin_id = Column(Integer, ForeignKey("coins.id", ondelete="CASCADE"), nullable=True)
    status = Column(String(20), nullable=False)  # OK, PARTIAL, FAILED
    last_success = Column(DateTime(timezone=True), nullable=True)
    last_attempt = Column(DateTime(timezone=True), nullable=False)
    error_message = Column(Text, nullable=True)
    records_collected = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("source_status_idx", "source", "coin_id"),
        UniqueConstraint("source", "coin_id", name="source_status_unique"),
    )
