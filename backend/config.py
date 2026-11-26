"""
Application configuration using Pydantic Settings
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
import logging


_LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def resolve_log_level(value: str) -> int:
    """Đổi `LOG_LEVEL` (env) thành hằng của `logging`; giá trị lạ rơi về INFO."""
    name = (value or "").strip().upper()
    return getattr(logging, name) if name in _LOG_LEVELS else logging.INFO


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/narrative_health"
    
    # App
    app_env: str = "development"
    # Mức log của process FastAPI/backend (Next.js không đọc). Nhận
    # DEBUG/INFO/WARNING/ERROR/CRITICAL; giá trị khác rơi về INFO.
    log_level: str = "INFO"

    # Scheduler (Vietnam timezone UTC+7)
    scheduler_enabled: bool = True
    scheduler_hour: int = 7  # Run at 7:00 AM Vietnam time (UTC+7)
    scheduler_minute: int = 0
    scheduler_interval_hours: int = 0  # Run every X hours (0 = use daily time)
    scheduler_timeout: int = 600  # Timeout in seconds (default 10 minutes)
    # Token server-to-server cho POST /api/refresh (Next.js đọc env
    # SCHEDULER_REFRESH_TOKEN). Để trống = không gửi header.
    scheduler_refresh_token: str = ""
    
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
    # Dùng luôn cho POST /api/market/radar/cohort — không thêm env token mới.
    scheduler_catalyst_token: str = ""

    # RADAR-COHORT: cohort/ledger/alert chạy bằng cron thay vì `after()` của
    # request radar. FastAPI gọi POST /api/market/radar/cohort mỗi
    # `scheduler_radar_cohort_minutes` phút (0 = tắt). Nhịp runtime ưu tiên
    # `app_settings.radar.config.schedulerCohortMinutes`; env chỉ là fallback.
    scheduler_radar_cohort_minutes: int = 30
    scheduler_radar_cohort_timeout: int = 300

    # RADAR-TG P3: fast lane 3 phút (POST cohort với mode=fast) — universe ~30
    # symbol thanh khoản nhất, chỉ gửi tier URGENT, khoá DB riêng. 0 = tắt.
    # Nhịp được Next.js kẹp 1–5 phút; không phụ thuộc radar.config để có thể
    # bật/tắt bằng env khi sự cố.
    scheduler_radar_fast_minutes: int = 3
    # Timeout HTTP của lượt gọi cohort ở lane fast (giây, sàn 30). Không dùng
    # chung `scheduler_radar_cohort_timeout` để một lượt fast treo không giữ
    # slot tới 5 phút.
    scheduler_radar_fast_timeout: int = 120

    # RADAR-BIAS-LOG: job tính outcome 1h/4h/24h/3d/7d cho `radar_bias_log`
    # (POST /api/market/radar/bias-outcomes). Nhịp runtime ưu tiên
    # `app_settings.radar.config.schedulerBiasOutcomeMinutes`; env chỉ là fallback.
    scheduler_radar_bias_outcome_minutes: int = 10
    scheduler_radar_bias_outcome_timeout: int = 300

    # RADAR-TG P2: drain outbox alert radar (POST /api/market/radar/outbox).
    # Mỗi phút để alert/retry đi sát; 0 = tắt job (outbox vẫn được drain ngay
    # trong lượt cohort). Job chạy độc lập công tắc catalyst.
    scheduler_radar_outbox_minutes: int = 1
    scheduler_radar_outbox_timeout: int = 60

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
