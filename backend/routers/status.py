"""The service dashboard endpoints. Shape is fixed by frontend/src/lib/status.ts."""

from fastapi import APIRouter, Query

from services.health import build_report
from services.logging_setup import recent_errors

router = APIRouter()


@router.get("/api/status")
async def status():
    return await build_report()


@router.get("/api/status/logs")
async def status_logs(
    limit: int = Query(50, ge=1, le=200),
    level: str | None = Query(None, description="Floor level: WARNING, ERROR, CRITICAL"),
):
    return {"entries": recent_errors(limit=limit, level=level)}
