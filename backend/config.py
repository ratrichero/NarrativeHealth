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
    
    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
