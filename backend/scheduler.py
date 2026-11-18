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
from datetime import datetime
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


def resolve_catalyst_schedule(values) -> tuple[bool, dict]:
    """Gộp `values` trong DB lên env/default. Trả (enabled, {scope: minutes})."""
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

    async def refresh_catalyst_jobs(self, force: bool = False) -> bool:
        """Đọc radar.config và reschedule catalyst khi nhịp đổi.

        Trả True nếu đã áp dụng cấu hình mới. Watcher gọi hàm này mỗi 30 giây;
        chữ ký (enabled + intervals) không đổi thì không chạm vào job để
        next_run_time không bị đẩy lùi.
        """
        if not self.scheduler or not self.scheduler.running:
            return False
        values = await self._read_radar_config_values()
        if values is None:
            return False
        enabled, intervals = resolve_catalyst_schedule(values)
        signature = (enabled, tuple(sorted(intervals.items())))
        if not force and signature == self._catalyst_signature:
            return False
        self._apply_catalyst_jobs(enabled, intervals)
        self._catalyst_signature = signature
        logger.info(
            "Catalyst schedule applied from %s: enabled=%s intervals=%s",
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
