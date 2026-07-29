"""APScheduler job registration — polls subscribed feeds and the calendar
secret feed, and sweeps retention daily (Sections 9 and 10)."""

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from services import paths
from services.calendar_sync import run_calendar_sync
from services.feed_ingest import run_feed_ingest

logger = logging.getLogger("facet.scheduler")

_scheduler = BackgroundScheduler()


def for_each_user(fn):
    """Run a scheduled job once per active user, as that user.

    Scheduled work has no request to inherit an identity from, so without
    this every poll would run as nobody: one shared feed pull writing into
    the shared directory while ten people's databases stay empty.

    One user's failure must not skip the rest — a bad calendar URL in one
    account would otherwise silently stop everyone's sync.
    """

    def run_for_all():
        from services import identity

        if not identity.multiuser_enabled():
            fn()
            return

        from control import store

        for user in store.list_users():
            if user["status"] != "active":
                continue
            try:
                with paths.user_scope(user["slug"]):
                    fn()
            except Exception:
                logger.exception("[Facet] scheduled %s failed for %s",
                                 fn.__name__, user["slug"])

    run_for_all.__name__ = f"{fn.__name__}_for_each_user"
    return run_for_all


def run_retention_sweep() -> None:
    """Daily housekeeping. Never touches workspace/ or tracker.db.

    Wrapped in its own try/except: a failing sweep must not take the
    scheduler's other jobs down with it, and reclaiming space is never worth
    interrupting the app over.
    """
    from services import retention

    try:
        result = retention.sweep_all(dry_run=False)
        removed = len(result["exports"]["removed"])
        if removed or result["jobs"]["removed"]:
            logger.info("[Facet] retention: %s export(s), %s job row(s) removed",
                        removed, result["jobs"]["removed"])
        if result["usage"]["over_quota"]:
            logger.warning("[Facet] over the soft quota: %s bytes of %s (warning only)",
                           result["usage"]["total"], result["usage"]["quota"])
    except Exception:
        logger.exception("[Facet] retention sweep failed")


def start_scheduler():
    if not _scheduler.running:
        # Every 6 hours, with the first pull 10s after boot so a fresh install
        # has postings waiting the first time The Rough is opened rather than
        # an empty list for 24 hours. coalesce+max_instances keep a slow pull
        # from stacking up behind itself.
        _scheduler.add_job(
            for_each_user(run_feed_ingest),
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
            for_each_user(run_calendar_sync),
            "interval",
            hours=24,
            id="calendar_sync_daily",
            replace_existing=True,
        )

        # Daily retention sweep. Only ever removes unreferenced exports and
        # aged-out job rows — anything attached to an application is part of
        # the user's record and is never touched. See services/retention.py.
        _scheduler.add_job(
            for_each_user(run_retention_sweep),
            "interval",
            hours=24,
            id="retention_daily",
            replace_existing=True,
            coalesce=True,
            max_instances=1,
        )
        _scheduler.start()


def shutdown_scheduler():
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
