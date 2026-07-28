"""APScheduler job registration — polls subscribed feeds and the calendar
secret feed, both daily (Sections 9 and 10)."""

from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from services.calendar_sync import run_calendar_sync
from services.feed_ingest import run_feed_ingest

_scheduler = BackgroundScheduler()


def start_scheduler():
    if not _scheduler.running:
        # Every 6 hours, with the first pull 10s after boot so a fresh install
        # has postings waiting the first time The Rough is opened rather than
        # an empty list for 24 hours. coalesce+max_instances keep a slow pull
        # from stacking up behind itself.
        _scheduler.add_job(
            run_feed_ingest,
            "interval",
            hours=6,
            id="feed_ingest",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=3600,
            next_run_time=datetime.now() + timedelta(seconds=10),
        )
        _scheduler.add_job(
            run_calendar_sync,
            "interval",
            hours=24,
            id="calendar_sync_daily",
            replace_existing=True,
        )
        _scheduler.start()


def shutdown_scheduler():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
