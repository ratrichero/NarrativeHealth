"""
Scheduler for automated data refresh

Architecture Note:
- Primary API: Next.js (http://localhost:3000/api/refresh)
- Fallback API: FastAPI (http://localhost:8000/api/refresh)
- Current architecture uses Next.js API routes as the main data refresh endpoint
- FastAPI serves as backup and for legacy compatibility
"""
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta
import asyncio
import json
import logging
import pytz
from typing import Optional
import httpx
from httpx import ConnectError, TimeoutException
from sqlalchemy import text

from backend.config import settings
from backend.database import AsyncSessionLocal
from backend.models.scheduler_log import SchedulerLog


logger = logging.getLogger(__name__)

# RADAR-CONFIG: FastAPI đọc nhịp catalyst từ `app_settings` key `radar.config`
# (cùng payload Admin → Radar & Catalyst ghi). Thứ tự: DB > env
# (`SCHEDULER_CATALYST_*`) > default. Watcher poll mỗi 30 giây và chỉ reschedule
# khi chữ ký nhịp đổi, nên đổi trên Admin không cần restart FastAPI.
CATALYST_CONFIG_KEY = "radar.config"
CATALYST_CONFIG_POLL_SECONDS = 30
CATALYST_MAX_INTERVAL_MINUTES = 1440
CATALYST_JOBS = (
    ("catalyst_announcements", "announcements", "Catalyst announcements (Binance CMS)"),
    ("catalyst_news", "news", "Catalyst news (RSS)"),
    ("catalyst_unlocks", "unlocks", "Catalyst unlocks (event_risks read-only)"),
)

# RADAR-COHORT: cohort/ledger/alert chạy bằng job này (gọi Next.js) thay vì
# `after()` của request /api/market/movers. Nhịp đọc từ
# `radar.config.schedulerCohortMinutes` (fallback SCHEDULER_RADAR_COHORT_MINUTES).
RADAR_COHORT_JOB_ID = "radar_cohort"

# RADAR-BIAS-LOG: job riêng tính outcome 1h/4h/24h/3d/7d cho radar_bias_log.
# Nhịp đọc từ `radar.config.schedulerBiasOutcomeMinutes` (fallback
# SCHEDULER_RADAR_BIAS_OUTCOME_MINUTES). Idempotent: endpoint chỉ thêm outcome
# cho horizon đã đủ tuổi và chưa có dòng, nên chạy trùng không nhân bản dữ liệu.
RADAR_BIAS_OUTCOME_JOB_ID = "radar_bias_outcomes"

# SNAPSHOT-02: chốt bản chụp track record của ngày vừa đóng
# (POST /api/track-record/snapshots) và in `head` ra log để neo. Chạy hằng
# ngày sau lượt refresh (mặc định 07:10 ICT), là lớp dự phòng cho auto-snapshot
# trong `/api/refresh`. Endpoint idempotent theo ngày nên chạy trùng vô hại.
SNAPSHOT_ANCHOR_JOB_ID = "snapshot_anchor"
SNAPSHOT_ANCHOR_ENDPOINT = "http://localhost:3000/api/track-record/snapshots"

# Refresh 07:00 có thể chạy tới 10 phút, nên lượt 07:10 dễ nhận 409
# `settlement-pending` — số của ngày chưa chốt hết, endpoint TỪ CHỐI chốt (đúng).
# Bỏ luôn thì mất ngày (bảng append-only), nên job chờ rồi thử lại trong ngày.
#   • `settlement-pending` (409) → chờ `retry_minutes` rồi thử lại; refresh chạy
#     xong là lượt sau chốt được.
#   • `day-open` (409) → không chờ: ngày chưa đóng thì chờ mấy cũng vậy.
#   • 401/403/503 → lỗi cấu hình (token/host guard), thử lại không sửa được gì.
#   • 5xx/429/lỗi kết nối → có thể do Next restart trong lúc refresh: thử lại.
SNAPSHOT_ANCHOR_TERMINAL_HTTP = frozenset({401, 403, 503})


def snapshot_anchor_retry_decision(
    status_code: int, reason: Optional[str], attempts_left: int
) -> str:
    """`done` | `retry` | `fail` cho một lượt gọi endpoint chốt bản chụp.

    Thuần (không mạng, không settings) để test được toàn bộ luật chờ: đây là
    chỗ dễ sai nhất — thử lại sai loại lỗi thì hoặc mất ngày, hoặc quay vòng
    6 lần trong vô ích.
    """
    if 200 <= status_code < 300:
        return "done"
    if status_code in SNAPSHOT_ANCHOR_TERMINAL_HTTP:
        return "fail"
    # `day-open`: endpoint khoá ngày đang mở; đợi thêm trong ngày không làm
    # ngày đó đóng lại. `settlement-pending` (hoặc reason không đọc được do
    # refresh đang trả lỗi) mới là thứ đáng chờ.
    if status_code == 409 and reason == "day-open":
        return "fail"
    if attempts_left <= 0:
        return "fail"
    # 0 = lỗi kết nối/timeout, 5xx/429 = Next đang restart hoặc quá tải.
    return "retry"


def _as_bool(value, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in ("1", "true", "yes", "on"):
            return True
        if normalized in ("0", "false", "no", "off"):
            return False
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    return fallback


def _as_minutes(value, fallback: int) -> int:
    """0 = tắt job; giá trị hỏng dùng fallback; kẹp 0–1440."""
    try:
        minutes = int(float(value))
    except (TypeError, ValueError):
        return max(0, int(fallback))
    if minutes <= 0:
        return 0
    return min(CATALYST_MAX_INTERVAL_MINUTES, minutes)


def resolve_scheduler_intervals(values) -> tuple[bool, dict]:
    """Gộp `values` trong DB lên env/default.

    Trả (catalyst_enabled, {scope: minutes}) cho announcements/news/unlocks và
    `cohort` (nhịp ledger/alert, job riêng — 0 = tắt, không chịu công tắc catalyst).
    """
    data = values if isinstance(values, dict) else {}
    enabled = _as_bool(data.get("schedulerEnabled"), settings.scheduler_catalyst_enabled)
    return enabled, {
        "announcements": _as_minutes(
            data.get("schedulerAnnouncementsMinutes"),
            settings.scheduler_catalyst_announcements_minutes,
        ),
        "news": _as_minutes(
            data.get("schedulerNewsMinutes"),
            settings.scheduler_catalyst_news_minutes,
        ),
        "unlocks": _as_minutes(
            data.get("schedulerUnlocksMinutes"),
            settings.scheduler_catalyst_unlocks_minutes,
        ),
        "cohort": _as_minutes(
            data.get("schedulerCohortMinutes"),
            settings.scheduler_radar_cohort_minutes,
        ),
        "biasOutcomes": _as_minutes(
            data.get("schedulerBiasOutcomeMinutes"),
            settings.scheduler_radar_bias_outcome_minutes,
        ),
    }


class DataRefreshScheduler:
    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        self._catalyst_signature: Optional[tuple] = None
        # Vietnam timezone is UTC+7
        self.vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')

    async def start(self):
        """Start the scheduler (async vì nạp nhịp catalyst từ DB)."""
        logger.info(
            "Scheduler startup requested: enabled=%s hour=%02d minute=%02d interval_hours=%s timezone=%s",
            settings.scheduler_enabled,
            settings.scheduler_hour,
            settings.scheduler_minute,
            settings.scheduler_interval_hours,
            self.vietnam_tz.zone,
        )
        if not settings.scheduler_enabled:
            logger.warning("Scheduler is disabled in config")
            return

        if self.scheduler and self.scheduler.running:
            logger.warning("Scheduler is already running")
            return

        self.scheduler = AsyncIOScheduler(timezone=self.vietnam_tz)

        # Check if interval mode is enabled
        if settings.scheduler_interval_hours > 0:
            # Run every X hours
            self.scheduler.add_job(
                self._run_refresh,
                trigger='interval',
                hours=settings.scheduler_interval_hours,
                id='interval_refresh',
                name=f'Interval Data Refresh (every {settings.scheduler_interval_hours}h)',
                args=['interval_refresh'],
                replace_existing=True
            )
            print(f"Scheduler started - will run every {settings.scheduler_interval_hours} hours (Vietnam time)")
        else:
            # Run daily at specific time
            self.scheduler.add_job(
                self._run_refresh,
                trigger=CronTrigger(
                    hour=settings.scheduler_hour,
                    minute=settings.scheduler_minute,
                    timezone=self.vietnam_tz
                ),
                id='daily_refresh',
                name='Daily Data Refresh',
                args=['daily_refresh'],
                replace_existing=True
            )
            print(f"Scheduler started - will run daily at {settings.scheduler_hour:02d}:{settings.scheduler_minute:02d} Vietnam time")

        # SQ-MOVERS: Daily Top Movers Square post — 07:15 VN (after the 07:00
        # refresh so it never contends with the refresh lock or the setup
        # pipeline's LLM quota). Posts 3 top gainers + 3 top losers as 6
        # separate Square posts via POST /api/square/movers.
        if settings.scheduler_movers_enabled:
            self.scheduler.add_job(
                self._run_movers_pipeline,
                trigger=CronTrigger(
                    hour=settings.scheduler_movers_hour,
                    minute=settings.scheduler_movers_minute,
                    timezone=self.vietnam_tz
                ),
                id='movers_cron',
                name='Daily Top Movers Square Post',
                args=[],
                replace_existing=True
            )
            print(f"Movers scheduler started - will run daily at {settings.scheduler_movers_hour:02d}:{settings.scheduler_movers_minute:02d} Vietnam time")
        else:
            print("Movers scheduler disabled in config")

        # SNAPSHOT-02: chốt bản chụp ngày vừa đóng + log `head` để neo ra ngoài.
        # Đặt sau giờ refresh để settlement của hôm qua đã xong. Refresh 07:00 có
        # thể kéo dài tới 10 phút → 409 `settlement-pending`; job chờ rồi thử lại
        # trong ngày (xem `_run_snapshot_anchor`) thay vì bỏ mất ngày.
        if settings.scheduler_snapshot_enabled:
            self.scheduler.add_job(
                self._run_snapshot_anchor,
                trigger=CronTrigger(
                    hour=settings.scheduler_snapshot_hour,
                    minute=settings.scheduler_snapshot_minute,
                    timezone=self.vietnam_tz
                ),
                id=SNAPSHOT_ANCHOR_JOB_ID,
                name='Daily Track Record Snapshot',
                args=[],
                max_instances=1,
                coalesce=True,
                replace_existing=True
            )
            print(
                "Snapshot scheduler started - will run daily at "
                f"{settings.scheduler_snapshot_hour:02d}:{settings.scheduler_snapshot_minute:02d} Vietnam time"
            )
        else:
            print("Snapshot scheduler disabled in config")

        # P3 Historical Execution Loop (P3-15)
        # Every scheduler_p3_interval_hours (default 48h = 2 days), or daily after
        # the main refresh when interval is 0. The endpoint is idempotent.
        if settings.scheduler_p3_enabled:
            if settings.scheduler_p3_interval_hours > 0:
                self.scheduler.add_job(
                    self._run_p3_execution,
                    trigger='interval',
                    hours=settings.scheduler_p3_interval_hours,
                    id='p3_execution_loop',
                    name=f'P3 Execution Loop (every {settings.scheduler_p3_interval_hours}h)',
                    replace_existing=True
                )
                print(f"P3 scheduler started - will run every {settings.scheduler_p3_interval_hours} hours")
            else:
                self.scheduler.add_job(
                    self._run_p3_execution,
                    trigger=CronTrigger(
                        hour=settings.scheduler_hour,
                        minute=min(59, settings.scheduler_minute + 5),
                        timezone=self.vietnam_tz
                    ),
                    id='p3_execution_loop',
                    name='P3 Execution Loop (daily after refresh)',
                    replace_existing=True
                )
                print(f"P3 scheduler started - will run daily at {settings.scheduler_hour:02d}:{min(59, settings.scheduler_minute + 5):02d} Vietnam time")
        else:
            print("P3 scheduler disabled in config")

        # RADAR-06-SCHED: catalyst jobs không gắn cứng theo env ở đây nữa — nhịp
        # đọc từ `app_settings.radar.config` (DB > env SCHEDULER_CATALYST_*) và
        # được reschedule khi cấu hình đổi, nên đổi trên Admin không cần restart.
        self.scheduler.start()

        # Áp nhịp hiện hành ngay khi scheduler chạy, rồi poll DB mỗi 30 giây.
        await self.refresh_catalyst_jobs(force=True)
        self.scheduler.add_job(
            self.refresh_catalyst_jobs,
            trigger='interval',
            seconds=CATALYST_CONFIG_POLL_SECONDS,
            id='catalyst_config_watch',
            name='Catalyst schedule watcher (radar.config)',
            max_instances=1,
            coalesce=True,
            replace_existing=True,
        )
        jobs = self.scheduler.get_jobs()
        logger.info(
            "Scheduler running=%s jobs=%s",
            self.scheduler.running,
            [
                {"id": job.id, "next_run_time": job.next_run_time.isoformat()}
                for job in jobs
            ],
        )

    def stop(self):
        """Stop the scheduler"""
        if self.scheduler:
            # Remove existing jobs before shutdown
            try:
                self.scheduler.remove_job('daily_refresh')
            except:
                pass
            try:
                self.scheduler.remove_job('interval_refresh')
            except:
                pass
            try:
                self.scheduler.remove_job('p3_execution_loop')
            except:
                pass
            try:
                self.scheduler.remove_job('movers_cron')
            except:
                pass
            for job_id in (
                'catalyst_announcements',
                'catalyst_news',
                'catalyst_unlocks',
                'catalyst_config_watch',
                RADAR_COHORT_JOB_ID,
                RADAR_BIAS_OUTCOME_JOB_ID,
                SNAPSHOT_ANCHOR_JOB_ID,
            ):
                try:
                    self.scheduler.remove_job(job_id)
                except Exception:
                    pass
            self.scheduler.shutdown()
            self.scheduler = None
            print("Scheduler stopped")

    async def _read_radar_config_values(self) -> Optional[dict]:
        """Đọc `app_settings.radar.config`.values.

        `None` = không đọc được DB (mạng/query lỗi) → giữ nhịp đang chạy thay vì
        rơi về env và reschedule qua lại. `{}` = chưa có cấu hình → env fallback.
        """
        try:
            async with AsyncSessionLocal() as session:
                result = await session.execute(
                    text("SELECT value FROM app_settings WHERE key = :key LIMIT 1"),
                    {"key": CATALYST_CONFIG_KEY},
                )
                row = result.first()
        except Exception as exc:
            logger.warning(
                "Không đọc được %s từ DB, giữ nhịp catalyst hiện tại: %s",
                CATALYST_CONFIG_KEY,
                exc,
            )
            return None

        if row is None:
            return {}
        value = row[0]
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                return {}
        if not isinstance(value, dict):
            return {}
        values = value.get("values")
        return values if isinstance(values, dict) else {}

    def _apply_catalyst_jobs(self, enabled: bool, intervals: dict) -> None:
        """Thêm/gỡ 3 job catalyst theo nhịp mới."""
        if not self.scheduler:
            return
        for job_id, scope, name in CATALYST_JOBS:
            minutes = intervals[scope]
            if not enabled or minutes <= 0:
                if self.scheduler.get_job(job_id):
                    self.scheduler.remove_job(job_id)
                    print(f"Catalyst job '{job_id}' removed (disabled)")
                continue
            self.scheduler.add_job(
                self._run_catalyst_sync,
                trigger='interval',
                minutes=minutes,
                id=job_id,
                name=f'{name} every {minutes}m',
                args=[scope],
                # Một lượt sync không được chồng lên lượt trước (upsert vốn
                # idempotent, nhưng overlap chỉ tạo tải vô ích lên Binance).
                max_instances=1,
                coalesce=True,
                replace_existing=True,
            )
            print(f"Catalyst scheduler applied - '{scope}' every {minutes} minutes")
        self._apply_radar_cohort_job(intervals.get("cohort", 0))
        self._apply_radar_bias_outcome_job(intervals.get("biasOutcomes", 0))

    def _apply_radar_cohort_job(self, minutes: int) -> None:
        """Thêm/gỡ job cohort/ledger/alert theo nhịp mới (0 = tắt).

        Job không chịu công tắc catalyst: ledger/alert vẫn cần chạy khi tắt
        sync catalyst. FastAPI là nơi duy nhất giữ nhịp, nên tải không phụ
        thuộc số request radar hay số instance Next.js (khoá nằm trong DB).
        """
        if not self.scheduler:
            return
        if minutes <= 0:
            if self.scheduler.get_job(RADAR_COHORT_JOB_ID):
                self.scheduler.remove_job(RADAR_COHORT_JOB_ID)
                print(f"Radar cohort job '{RADAR_COHORT_JOB_ID}' removed (disabled)")
            return
        self.scheduler.add_job(
            self._run_radar_cohort,
            trigger='interval',
            minutes=minutes,
            id=RADAR_COHORT_JOB_ID,
            name=f'Radar cohort/ledger/alert every {minutes}m',
            args=[minutes],
            # Build nguội + webhook có thể > 1 phút; không cho chồng lượt.
            max_instances=1,
            coalesce=True,
            replace_existing=True,
            # Lượt đầu sau khi (re)start 60 giây, không phải chờ hết một nhịp.
            next_run_time=datetime.now(self.vietnam_tz) + timedelta(seconds=60),
        )
        print(f"Radar cohort scheduler applied - every {minutes} minutes")

    def _apply_radar_bias_outcome_job(self, minutes: int) -> None:
        """Thêm/gỡ job outcome radar_bias_log theo nhịp mới (0 = tắt).

        Tách khỏi cohort vì outcome chỉ cần chạy khi horizon đủ tuổi; nhịp ngắn
        (mặc định 10 phút) cho kết quả 1h/4h sát mốc hơn mà không kéo dài lượt
        cohort (mỗi lượt cohort đã phải build snapshot + alert).
        """
        if not self.scheduler:
            return
        if minutes <= 0:
            if self.scheduler.get_job(RADAR_BIAS_OUTCOME_JOB_ID):
                self.scheduler.remove_job(RADAR_BIAS_OUTCOME_JOB_ID)
                print(f"Radar bias outcome job '{RADAR_BIAS_OUTCOME_JOB_ID}' removed (disabled)")
            return
        self.scheduler.add_job(
            self._run_radar_bias_outcomes,
            trigger='interval',
            minutes=minutes,
            id=RADAR_BIAS_OUTCOME_JOB_ID,
            name=f'Radar bias log outcomes every {minutes}m',
            args=[minutes],
            # Fetch klines cho nhiều symbol; không cho chồng lượt.
            max_instances=1,
            coalesce=True,
            replace_existing=True,
            # Lượt đầu sau (re)start 2 phút, để cohort kịp có dòng đầu tiên.
            next_run_time=datetime.now(self.vietnam_tz) + timedelta(seconds=120),
        )
        print(f"Radar bias outcome scheduler applied - every {minutes} minutes")

    async def refresh_catalyst_jobs(self, force: bool = False) -> bool:
        """Đọc radar.config và reschedule job khi nhịp đổi.

        Trả True nếu đã áp dụng cấu hình mới. Watcher gọi hàm này mỗi 30 giây;
        chữ ký (enabled + intervals) không đổi thì không chạm vào job để
        next_run_time không bị đẩy lùi.
        """
        if not self.scheduler or not self.scheduler.running:
            return False
        values = await self._read_radar_config_values()
        if values is None:
            return False
        enabled, intervals = resolve_scheduler_intervals(values)
        signature = (enabled, tuple(sorted(intervals.items())))
        if not force and signature == self._catalyst_signature:
            return False
        self._apply_catalyst_jobs(enabled, intervals)
        self._catalyst_signature = signature
        logger.info(
            "Scheduler intervals applied from %s: catalyst_enabled=%s intervals=%s",
            CATALYST_CONFIG_KEY,
            enabled,
            intervals,
        )
        return True

    async def _run_refresh(self, job_id: str = "unknown"):
        """Run the refresh job"""
        started_at = datetime.now(self.vietnam_tz)
        log_entry = None
        
        logger.info(
            "Scheduled refresh fired at %s; job_id=%s primary=http://localhost:3000/api/refresh fallback=http://localhost:8000/api/refresh",
            started_at.isoformat(),
            job_id,
        )
        
        async with AsyncSessionLocal() as session:
            # Use a distinct job_name for the wrapper log. The Next.js refresh
            # route's lock check looks for an active SchedulerLog with the SAME
            # job_name that is not stale — pre-inserting 'daily_refresh'/'interval_refresh'
            # here would make every scheduled run 409-lock itself and fall back
            # to the FastAPI refresh, which has no Square pipeline.
            log_entry = SchedulerLog(
                job_name=f"{job_id}_trigger",
                status="STARTED",
                started_at=started_at,
            )
            session.add(log_entry)
            await session.commit()
            await session.refresh(log_entry)
        
        timeout = settings.scheduler_timeout
        result_message = None
        error_message = None
        completed_at = datetime.now(self.vietnam_tz)
        
        try:
            # Try Next.js API first (primary)
            try:
                print("Attempting Next.js API refresh (localhost:3000)...")
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        "http://localhost:3000/api/refresh",
                        json={"jobName": job_id},
                        timeout=timeout
                    )
                    if response.status_code == 200:
                        result = response.json()
                        result_message = result.get('data', {}).get('message', 'Success')
                        print(f"Next.js refresh completed: {result_message}")
                    else:
                        error_message = f"Next.js API returned status {response.status_code}: {response.text}"
                        print(error_message)
            except ConnectError as e:
                error_message = f"Next.js API connection failed: {e}"
                print(error_message)
            except TimeoutException as e:
                error_message = f"Next.js API timeout: {e}"
                print(error_message)
            except Exception as e:
                error_message = f"Next.js API error: {e}"
                print(error_message)
            
            # Fallback to FastAPI endpoint if primary failed
            if error_message:
                print("Falling back to FastAPI refresh (localhost:8000)...")
                try:
                    async with httpx.AsyncClient() as client:
                        response = await client.post(
                            "http://localhost:8000/api/refresh",
                            timeout=timeout
                        )
                        if response.status_code == 200:
                            result = response.json()
                            result_message = result.get('data', {}).get('message', 'Success')
                            error_message = None
                            print(f"FastAPI refresh completed: {result_message}")
                        else:
                            fallback_error = f"FastAPI API returned status {response.status_code}: {response.text}"
                            print(fallback_error)
                            if error_message:
                                error_message = error_message + " | " + fallback_error
                            else:
                                error_message = fallback_error
                except ConnectError as e:
                    fallback_error = f"FastAPI connection failed: {e}"
                    print(fallback_error)
                    if error_message:
                        error_message = error_message + " | " + fallback_error
                    else:
                        error_message = fallback_error
                except TimeoutException as e:
                    fallback_error = f"FastAPI timeout: {e}"
                    print(fallback_error)
                    if error_message:
                        error_message = error_message + " | " + fallback_error
                    else:
                        error_message = fallback_error
                except Exception as e:
                    fallback_error = f"FastAPI error: {e}"
                    print(fallback_error)
                    if error_message:
                        error_message = error_message + " | " + fallback_error
                    else:
                        error_message = fallback_error
        finally:
            duration = int((completed_at - started_at).total_seconds())
            async with AsyncSessionLocal() as session:
                await session.execute(
                    SchedulerLog.__table__.update()
                    .where(SchedulerLog.id == log_entry.id)
                    .values(
                        status="COMPLETED" if not error_message else "FAILED",
                        completed_at=completed_at,
                        duration=duration,
                        error_message=error_message,
                        details={
                            "result_message": result_message,
                            "timeout": timeout,
                        },
                    )
                )
                await session.commit()
            
            if error_message:
                logger.error("Scheduled refresh failed: %s", error_message)
            else:
                logger.info("Scheduled refresh completed in %ds: %s", duration, result_message)

    async def _run_movers_pipeline(self):
        """Run the daily Top Movers Square pipeline via the Next.js API."""
        started_at = datetime.now(self.vietnam_tz)
        # 6 bài × stagger 90s + LLM calls → cần timeout dài hơn refresh.
        timeout = max(settings.scheduler_timeout, 900)
        error_message = None
        result_message = None
        completed_at = datetime.now(self.vietnam_tz)

        logger.info(
            "Movers pipeline fired at %s; endpoint=http://localhost:3000/api/square/movers",
            started_at.isoformat(),
        )

        try:
            async with httpx.AsyncClient() as client:
                # Khóa endpoint phía Next: cùng giá trị với env
                # SCHEDULER_MOVERS_TOKEN. Chưa config → không gửi header
                # (Next cho qua với warning — giữ cron không bị vỡ).
                headers = {}
                token = (settings.scheduler_movers_token or "").strip()
                if token:
                    headers["X-Scheduler-Token"] = token
                response = await client.post(
                    "http://localhost:3000/api/square/movers",
                    json={},
                    headers=headers,
                    timeout=timeout,
                )
                if response.status_code == 200:
                    data = response.json().get('data', {})
                    skipped = data.get('skipped')
                    result_message = (
                        f"published={data.get('postsPublished')} failed={data.get('postsFailed')} "
                        f"deduped={data.get('postsDeduped')} quotaBlocked={data.get('postsQuotaBlocked')}"
                        + (f" skipped={skipped}" if skipped else "")
                    )
                    print(f"Movers pipeline completed: {result_message}")
                else:
                    error_message = f"Movers API returned status {response.status_code}: {response.text}"
                    print(error_message)
        except ConnectError as e:
            error_message = f"Movers API connection failed: {e}"
            print(error_message)
        except TimeoutException as e:
            error_message = f"Movers API timeout: {e}"
            print(error_message)
        except Exception as e:
            error_message = f"Movers API error: {e}"
            print(error_message)

        duration = int((completed_at - started_at).total_seconds())
        if error_message:
            logger.error("Movers pipeline failed: %s", error_message)
        else:
            logger.info("Movers pipeline completed in %ds: %s", duration, result_message)

    async def _run_catalyst_sync(self, scope: str):
        """Run one catalyst sync scope via POST /api/catalyst/sync.

        Scope tách theo nhịp nguồn (announcements/news/unlocks). Endpoint trả
        200 kèm summary từng nguồn; nguồn lỗi không làm hỏng cả lượt — chỉ
        failedSources > 0 và log warning để biết nguồn nào đang chết.
        """
        started_at = datetime.now(self.vietnam_tz)
        timeout = max(30, settings.scheduler_catalyst_timeout)
        error_message = None
        result_message = None

        try:
            async with httpx.AsyncClient() as client:
                headers = {}
                token = (settings.scheduler_catalyst_token or "").strip()
                if token:
                    headers["X-Scheduler-Token"] = token
                response = await client.post(
                    "http://localhost:3000/api/catalyst/sync",
                    json={"scope": scope},
                    headers=headers,
                    timeout=timeout,
                )
                if response.status_code == 200:
                    data = response.json().get('data', {}) or {}
                    totals = data.get('totals', {}) or {}
                    sources = data.get('sources', []) or []
                    failed = [
                        s.get('name') for s in sources
                        if isinstance(s, dict) and s.get('error')
                    ]
                    result_message = (
                        f"scope={data.get('scope', scope)} sources={len(sources)} "
                        f"fetched={totals.get('fetched')} stored={totals.get('stored')} "
                        f"purged={data.get('purged')}"
                        + (f" failed={failed}" if failed else "")
                    )
                    if failed:
                        logger.warning("Catalyst sync %s: nguồn lỗi %s", scope, failed)
                    else:
                        logger.info("Catalyst sync completed in %ds: %s",
                                    int((datetime.now(self.vietnam_tz) - started_at).total_seconds()),
                                    result_message)
                else:
                    error_message = (
                        f"Catalyst API returned status {response.status_code}: {response.text}"
                    )
        except ConnectError as e:
            error_message = f"Catalyst API connection failed: {e}"
        except TimeoutException as e:
            error_message = f"Catalyst API timeout: {e}"
        except Exception as e:
            error_message = f"Catalyst API error: {e}"

        if error_message:
            logger.error("Catalyst sync (%s) failed: %s", scope, error_message)
            print(f"Catalyst sync ({scope}) failed: {error_message}")

    async def _run_radar_cohort(self, minutes: int):
        """Run radar cohort/ledger/alert via POST /api/market/radar/cohort.

        Đây là đường duy nhất sinh cohort/ledger/alert (request radar không còn
        `after()`). Endpoint Next.js tự giành khoá trong `app_settings`, nên
        nhiều instance Next.js chỉ cho một instance chạy mỗi lượt; instance
        khác trả `skipped="locked"` chứ không chạy trùng.
        """
        started_at = datetime.now(self.vietnam_tz)
        timeout = max(60, settings.scheduler_radar_cohort_timeout)
        error_message = None
        result_message = None

        try:
            async with httpx.AsyncClient() as client:
                headers = {}
                token = (settings.scheduler_catalyst_token or "").strip()
                if token:
                    headers["X-Scheduler-Token"] = token
                response = await client.post(
                    "http://localhost:3000/api/market/radar/cohort",
                    json={"intervalMinutes": minutes},
                    headers=headers,
                    timeout=timeout,
                )
                if response.status_code == 200:
                    data = response.json().get('data', {}) or {}
                    result_message = (
                        f"ran={data.get('ran')} skipped={data.get('skipped')} "
                        f"signals={data.get('signals')} clusters={data.get('clusterEvents')} "
                        f"alerts={data.get('alerts')}"
                    )
                    if data.get('skipped') == 'locked':
                        logger.info("Radar cohort skipped (instance khác giữ khoá)")
                    elif data.get('ran'):
                        logger.info(
                            "Radar cohort completed in %ds: %s",
                            int((datetime.now(self.vietnam_tz) - started_at).total_seconds()),
                            result_message,
                        )
                    else:
                        logger.warning("Radar cohort không chạy: %s", result_message)
                else:
                    error_message = (
                        f"Radar cohort API returned status {response.status_code}: {response.text}"
                    )
        except ConnectError as e:
            error_message = f"Radar cohort API connection failed: {e}"
        except TimeoutException as e:
            error_message = f"Radar cohort API timeout: {e}"
        except Exception as e:
            error_message = f"Radar cohort API error: {e}"

        if error_message:
            logger.error("Radar cohort (%sm) failed: %s", minutes, error_message)
            print(f"Radar cohort failed: {error_message}")

    async def _run_radar_bias_outcomes(self, minutes: int):
        """Tính outcome cho radar_bias_log qua POST /api/market/radar/bias-outcomes.

        Endpoint tự chọn row có horizon tới hạn mà chưa có outcome, nên job chỉ
        cần gọi đều; insert idempotent theo (log_id, horizon).
        """
        started_at = datetime.now(self.vietnam_tz)
        timeout = max(60, settings.scheduler_radar_bias_outcome_timeout)
        error_message = None

        try:
            async with httpx.AsyncClient() as client:
                headers = {}
                token = (settings.scheduler_catalyst_token or "").strip()
                if token:
                    headers["X-Scheduler-Token"] = token
                response = await client.post(
                    "http://localhost:3000/api/market/radar/bias-outcomes",
                    json={},
                    headers=headers,
                    timeout=timeout,
                )
                if response.status_code == 200:
                    data = response.json().get('data', {}) or {}
                    logger.info(
                        "Radar bias outcomes (%sm) in %ds: candidates=%s symbols=%s computed=%s inserted=%s",
                        minutes,
                        int((datetime.now(self.vietnam_tz) - started_at).total_seconds()),
                        data.get('candidates'),
                        data.get('symbols'),
                        data.get('computed'),
                        data.get('inserted'),
                    )
                else:
                    error_message = (
                        f"Radar bias outcome API returned status {response.status_code}: {response.text}"
                    )
        except ConnectError as e:
            error_message = f"Radar bias outcome API connection failed: {e}"
        except TimeoutException as e:
            error_message = f"Radar bias outcome API timeout: {e}"
        except Exception as e:
            error_message = f"Radar bias outcome API error: {e}"

        if error_message:
            logger.error("Radar bias outcomes (%sm) failed: %s", minutes, error_message)
            print(f"Radar bias outcomes failed: {error_message}")

    async def _post_snapshot_anchor_once(self, headers: dict, timeout: int) -> dict:
        """Một lượt gọi endpoint chốt bản chụp. Không bao giờ ném lỗi.

        Trả `status` (0 = không có HTTP response: kết nối/timeout), `reason`
        (lý do cổng từ chối của Next), `data` và `error` (câu để log).
        """
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    SNAPSHOT_ANCHOR_ENDPOINT,
                    json={},
                    headers=headers,
                    timeout=timeout,
                )
        except ConnectError as e:
            return {
                "status": 0,
                "reason": "connection",
                "data": {},
                "error": f"Snapshot API connection failed: {e}",
            }
        except TimeoutException as e:
            return {
                "status": 0,
                "reason": "timeout",
                "data": {},
                "error": f"Snapshot API timeout: {e}",
            }
        except Exception as e:  # noqa: BLE001 — job không được làm sập scheduler
            return {
                "status": 0,
                "reason": "error",
                "data": {},
                "error": f"Snapshot API error: {e}",
            }

        data = {}
        reason = None
        try:
            body = response.json()
            if isinstance(body, dict):
                raw_data = body.get("data")
                if isinstance(raw_data, dict):
                    data = raw_data
                    reason = raw_data.get("reason")
        except ValueError:
            pass

        error = None
        if response.status_code != 200:
            error = (
                f"Snapshot API returned status {response.status_code}"
                + (f" reason={reason}" if reason else "")
                + f": {response.text}"
            )

        return {
            "status": response.status_code,
            "reason": reason,
            "data": data,
            "error": error,
        }

    async def _run_snapshot_anchor(self):
        """Chốt bản chụp track record ngày vừa đóng và in `head` ra log.

        SNAPSHOT-02: `track_record_snapshots` là append-only và `head_hash` chỉ
        neo được khi bản in ra ngoài khớp, nên log của job là một trong những
        nơi neo (`[SNAPSHOT-02] head=...`). Không bao giờ bỏ qua bước log này,
        kể cả khi ngày đã có bản chụp (`created: false`) — head hiện tại vẫn là
        thứ cần đối chiếu.

        Chờ refresh: lượt 07:10 có thể trùng lúc refresh 07:00 (timeout tới 600s)
        còn đang chạy → endpoint trả 409 `settlement-pending`. Bỏ luôn là mất
        ngày vĩnh viễn (bảng append-only), nên job chờ `retry_minutes` rồi thử
        lại, tối đa `attempts` lượt. Luật chờ nằm ở
        `snapshot_anchor_retry_decision` để test được mà không cần mạng.
        """
        attempts = max(1, settings.scheduler_snapshot_attempts)
        retry_seconds = max(0, settings.scheduler_snapshot_retry_minutes) * 60
        timeout = max(30, settings.scheduler_snapshot_timeout)

        headers = {}
        token = (settings.scheduler_catalyst_token or "").strip()
        if token:
            headers["X-Scheduler-Token"] = token
        else:
            logger.warning(
                "SCHEDULER_CATALYST_TOKEN chưa set — POST "
                "/api/track-record/snapshots sẽ bị Next từ chối 503; "
                "set cùng token cho Next và FastAPI rồi restart."
            )

        for attempt in range(1, attempts + 1):
            result = await self._post_snapshot_anchor_once(headers, timeout)
            decision = snapshot_anchor_retry_decision(
                result["status"], result["reason"], attempts - attempt
            )

            if decision == "done":
                data = result["data"]
                entry = data.get("entry", {}) or {}
                head = data.get("head")
                # Dòng này là neo: giữ nguyên prefix + `head=` để grep/đối
                # chiếu về sau (commit, tin nhắn, log scheduler).
                logger.info(
                    "[SNAPSHOT-02] head=%s day=%s created=%s payloadHash=%s",
                    head,
                    entry.get("day"),
                    data.get("created"),
                    entry.get("payloadHash"),
                )
                print(
                    f"[SNAPSHOT-02] head={head} day={entry.get('day')} "
                    f"created={data.get('created')}"
                )
                return

            message = result["error"] or (
                f"Snapshot API returned status {result['status']}"
                + (f" reason={result['reason']}" if result["reason"] else "")
            )

            if decision == "fail":
                logger.error(
                    "Snapshot anchor failed (lần %s/%s): %s",
                    attempt,
                    attempts,
                    message,
                )
                print(f"Snapshot anchor failed: {message}")
                return

            logger.warning(
                "[SNAPSHOT-02] chưa chốt được (lần %s/%s): %s — chờ %ss rồi thử "
                "lại (refresh 07:00 có thể còn đang chạy).",
                attempt,
                attempts,
                message,
                retry_seconds,
            )
            await asyncio.sleep(retry_seconds)

        # Mỗi nhánh ở trên đều return; đây chỉ là lưới an toàn.
        logger.error("Snapshot anchor failed: hết %s lượt mà chưa chốt được", attempts)

    async def _run_p3_execution(self):
        """Run the P3 historical execution loop via the Next.js API."""
        started_at = datetime.now(self.vietnam_tz)
        timeout = settings.scheduler_timeout
        error_message = None
        result_message = None
        completed_at = datetime.now(self.vietnam_tz)

        logger.info(
            "P3 execution loop fired at %s; endpoint=http://localhost:3000/api/admin/p3/execute",
            started_at.isoformat(),
        )

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "http://localhost:3000/api/admin/p3/execute",
                    json={},
                    timeout=timeout,
                )
                if response.status_code == 200:
                    data = response.json().get('data', {})
                    result_message = (
                        f"executed={data.get('executed')} skipped={data.get('skipped')} "
                        f"notEligible={data.get('notEligible')} failed={data.get('failed')} "
                        f"windowEnd={data.get('windowEnd')}"
                    )
                    print(f"P3 execution loop completed: {result_message}")
                else:
                    error_message = f"P3 API returned status {response.status_code}: {response.text}"
                    print(error_message)
        except ConnectError as e:
            error_message = f"P3 API connection failed: {e}"
            print(error_message)
        except TimeoutException as e:
            error_message = f"P3 API timeout: {e}"
            print(error_message)
        except Exception as e:
            error_message = f"P3 API error: {e}"
            print(error_message)

        duration = int((completed_at - started_at).total_seconds())
        if error_message:
            logger.error("P3 execution loop failed: %s", error_message)
        else:
            logger.info("P3 execution loop completed in %ds: %s", duration, result_message)


# Global scheduler instance
scheduler = DataRefreshScheduler()


async def start_scheduler():
    """Start the global scheduler (nạp nhịp catalyst từ DB)."""
    await scheduler.start()


def stop_scheduler():
    """Stop the global scheduler"""
    scheduler.stop()
