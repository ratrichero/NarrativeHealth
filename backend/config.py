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

    # SNAPSHOT-02: chốt bản chụp track record của ngày vừa đóng
    # (POST /api/track-record/snapshots). Chạy hằng ngày, mặc định 07:10 ICT —
    # sau lượt refresh 07:00 để settlement của ngày hôm qua đã xong. Endpoint
    # idempotent theo ngày (chạy trùng trả `created: false`), nên đây là lớp dự
    # phòng cho auto-snapshot trong `/api/refresh`. Auth: token chung
    # SCHEDULER_CATALYST_TOKEN gửi qua header X-Scheduler-Token.
    scheduler_snapshot_enabled: bool = True
    scheduler_snapshot_hour: int = 7
    scheduler_snapshot_minute: int = 10
    scheduler_snapshot_timeout: int = 120
    # Refresh 07:00 có timeout 600s nên lượt 07:10 có thể gặp 409
    # `settlement-pending`. Thay vì bỏ cả ngày, job chờ rồi thử lại trong ngày:
    # 6 lượt, 5 lần chờ × 15 phút → lượt cuối ~08:25 ICT. Chỉ lỗi cấu hình
    # (401/403/503) và `day-open` mới dừng ngay — luật ở
    # `snapshot_anchor_retry_decision`.
    scheduler_snapshot_attempts: int = 6
    scheduler_snapshot_retry_minutes: int = 15

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
    # Dùng luôn cho POST /api/market/radar/cohort — không thêm env token mới.
    scheduler_catalyst_token: str = ""

    # RADAR-COHORT: cohort/ledger/alert chạy bằng cron thay vì `after()` của
    # request radar. FastAPI gọi POST /api/market/radar/cohort mỗi
    # `scheduler_radar_cohort_minutes` phút (0 = tắt). Nhịp runtime ưu tiên
    # `app_settings.radar.config.schedulerCohortMinutes`; env chỉ là fallback.
    scheduler_radar_cohort_minutes: int = 30
    scheduler_radar_cohort_timeout: int = 300

    # RADAR-BIAS-LOG: job tính outcome 1h/4h/24h/3d/7d cho `radar_bias_log`
    # (POST /api/market/radar/bias-outcomes). Nhịp runtime ưu tiên
    # `app_settings.radar.config.schedulerBiasOutcomeMinutes`; env chỉ là fallback.
    scheduler_radar_bias_outcome_minutes: int = 10
    scheduler_radar_bias_outcome_timeout: int = 300

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
