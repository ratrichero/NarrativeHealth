"""
Application configuration using Pydantic Settings
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
import os


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/narrative_health"
    
    # App
    app_env: str = "development"
    log_level: str = "INFO"
    
    # API Keys (optional)
    coingecko_api_key: str = ""
    binance_api_key: str = ""
    binance_secret: str = ""
    
    # Scheduler (Vietnam timezone UTC+7)
    scheduler_enabled: bool = True
    scheduler_hour: int = 7  # Run at 7:00 AM Vietnam time (UTC+7)
    scheduler_minute: int = 0
    scheduler_interval_hours: int = 0  # Run every X hours (0 = use daily time)
    scheduler_timeout: int = 600  # Timeout in seconds (default 10 minutes)
    
    # P3 Historical Execution Loop (P3-15)
    # Triggers POST /api/admin/p3/execute (Next.js) on the same schedule.
    # Idempotency is enforced server-side: a window already persisted is skipped.
    scheduler_p3_enabled: bool = True
    scheduler_p3_interval_hours: int = 48  # Every 2 days (0 = run daily after refresh)

    # SQ-MOVERS: Daily Top Movers Square post (6 per-coin posts)
    scheduler_movers_enabled: bool = True
    scheduler_movers_hour: int = 7
    scheduler_movers_minute: int = 15
    # Token chung xác thực POST /api/square/movers (Next.js đọc env
    # SCHEDULER_MOVERS_TOKEN). Để trống = không gửi header (giữ hành vi cũ).
    scheduler_movers_token: str = ""

    # RADAR-06-SCHED: Catalyst layer sync (POST /api/catalyst/sync).
    # Tách nhịp theo tính chất nguồn: announcement cần tươi (5–10 phút), RSS
    # 10–15 phút là đủ, unlock chỉ đọc event_risks (đổi 1 lần/ngày) nên 60 phút.
    # Tên env tương ứng: SCHEDULER_CATALYST_ENABLED /
    # SCHEDULER_CATALYST_ANNOUNCEMENTS_MINUTES / SCHEDULER_CATALYST_NEWS_MINUTES /
    # SCHEDULER_CATALYST_UNLOCKS_MINUTES / SCHEDULER_CATALYST_TOKEN.
    scheduler_catalyst_enabled: bool = True
    scheduler_catalyst_announcements_minutes: int = 5
    scheduler_catalyst_news_minutes: int = 15
    scheduler_catalyst_unlocks_minutes: int = 60
    scheduler_catalyst_timeout: int = 180  # giây; mỗi scope chỉ vài request
    # Token chung với Next (SCHEDULER_CATALYST_TOKEN). Để trống = không gửi header.
    scheduler_catalyst_token: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
