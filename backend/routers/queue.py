"""Job queue status — what the browser polls while agy works.

Mounted at /api/queue, not /api/jobs: in this app "jobs" already means job
postings (The Rough), and overloading the word in the URL space would be a
small permanent confusion for everyone reading the code afterwards.
"""

from fastapi import APIRouter, HTTPException

from services import jobs

router = APIRouter()


@router.get("/api/queue")
async def queue_overview(limit: int = 20):
    """Counts, timing, failure reasons, and the tail of recent work."""
    recent = await jobs.recent(limit)
    return {
        "stats": await jobs.stats(),
        "metrics": await jobs.metrics(),
        "recent": recent,
    }


@router.get("/api/retention")
async def retention_preview():
    """What a sweep *would* remove, plus current disk usage.

    Always a dry run. Seeing the list before anything is deleted is the point
    — and the daily sweep runs on its own schedule regardless.
    """
    from services import retention

    return retention.sweep_all(dry_run=True)


# Registered BEFORE /api/queue/{job_id}. FastAPI matches routes in order, so
# with the parameterised one first this literal path is parsed as an int and
# answers 422. Same first-match-wins rule as the tunnel's ingress list.
@router.get("/api/queue/agy")
async def agy_queue():
    """This user's place in the agy queue.

    agy is one authenticated CLI for the whole host, so somebody else's run
    genuinely delays yours. This says so — with counts and a position, never
    with another person's job payload.
    """
    return await jobs.agy_queue()


@router.get("/api/queue/{job_id}")
async def job_status(job_id: int):
    job = await jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job")
    return job


@router.delete("/api/queue/{job_id}")
async def cancel_job(job_id: int):
    """Cancel a job, queued or running.

    A running job has an agy subprocess in flight; it is stopped — the whole
    process tree, since agy spawns its own children — and the row is only
    marked once that succeeded. A job that cannot actually be stopped reports
    409 with the reason rather than claiming success.
    """
    job = await jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job")

    cancelled, reason = await jobs.cancel(job_id)
    if not cancelled:
        raise HTTPException(status_code=409, detail=f"Cannot cancel: {reason}")
    return {"cancelled": True}
