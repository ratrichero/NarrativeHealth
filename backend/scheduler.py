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
import pytz
from typing import Optional
import httpx

from backend.config import settings
from backend.database import get_db


class DataRefreshScheduler:
    def __init__(self):
        self.scheduler: Optional[AsyncIOScheduler] = None
        # Vietnam timezone is UTC+7
        self.vietnam_tz = pytz.timezone('Asia/Ho_Chi_Minh')

    def start(self):
        """Start the scheduler"""
        if not settings.scheduler_enabled:
            print("Scheduler is disabled in config")
            return

        if self.scheduler and self.scheduler.running:
            print("Scheduler is already running")
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
                replace_existing=True
            )
            print(f"Scheduler started - will run daily at {settings.scheduler_hour:02d}:{settings.scheduler_minute:02d} Vietnam time")

        self.scheduler.start()

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

    async def _run_refresh(self):
        """Run the refresh job"""
        print(f"Starting scheduled refresh at {datetime.now(self.vietnam_tz)}")
        try:
            # Call the Next.js API endpoint (primary API in current architecture)
            # Note: Next.js runs on port 3000 by default
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "http://localhost:3000/api/refresh",
                    timeout=300.0  # 5 minutes timeout
                )
                result = response.json()
                print(f"Scheduled refresh completed: {result.get('data', {}).get('message', 'Success')}")
        except Exception as e:
            print(f"Scheduled refresh failed: {e}")
            # Fallback to FastAPI endpoint if Next.js is not available
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        "http://localhost:8000/api/refresh",
                        timeout=300.0
                    )
                    result = response.json()
                    print(f"Fallback refresh completed: {result.get('data', {}).get('message', 'Success')}")
            except Exception as fallback_error:
                print(f"Fallback refresh also failed: {fallback_error}")


# Global scheduler instance
scheduler = DataRefreshScheduler()


def start_scheduler():
    """Start the global scheduler"""
    scheduler.start()


def stop_scheduler():
    """Stop the global scheduler"""
    scheduler.stop()
