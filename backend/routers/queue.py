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
    """Counts plus the tail of recent work. The admin dashboard's data source
    (PLAN.md Phase 4); useful on its own for "is anything stuck"."""
    return {"stats": await jobs.stats(), "recent": await jobs.recent(limit)}


@router.get("/api/queue/{job_id}")
async def job_status(job_id: int):
    job = await jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job")
    return job


@router.delete("/api/queue/{job_id}")
async def cancel_job(job_id: int):
    """Cancel a job that hasn't started.

    A running job means an agy subprocess is already in flight; reporting it
    cancelled while the process keeps going would be a lie the rest of the
    system has to live with. Killing it properly is Phase 4.
    """
    job = await jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such job")

    if not await jobs.cancel(job_id):
        raise HTTPException(
            status_code=409,
            detail=f"Job is {job['status']} and can no longer be cancelled",
        )
    return {"cancelled": True}
