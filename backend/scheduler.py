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
import logging
import pytz
from typing import Optional
import httpx
from httpx import ConnectError, TimeoutException

from backend.config import settings
from backend.database import AsyncSessionLocal
from backend.models.scheduler_log import SchedulerLog


logger = logging.getLogger(__name__)


class DataRefreshScheduler:
    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        # Vietnam timezone is UTC+7
        self.vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')

    def start(self):
        """Start the scheduler"""
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

        self.scheduler.start()
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
            self.scheduler.shutdown()
            self.scheduler = None
            print("Scheduler stopped")

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
            log_entry = SchedulerLog(
                job_name=job_id,
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


# Global scheduler instance
scheduler = DataRefreshScheduler()


def start_scheduler():
    """Start the global scheduler"""
    scheduler.start()


def stop_scheduler():
    """Stop the global scheduler"""
    scheduler.stop()
