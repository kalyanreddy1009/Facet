"""Status history: the trigger that records it, and the funnel that reads it.

    backend/.venv/bin/python scripts/test_application_events.py

Two things are being proven, and the first matters more than it looks.

1. HISTORY IS RECORDED BY THE DATABASE, NOT BY THE ROUTERS. Status is written
   from at least two places — PATCH /api/applications/{id} and the cutting
   pipeline's own `UPDATE applications SET status = 'Cut'` — and any future
   third. A history that depends on each author remembering to append is a
   history with holes in it, so the test below writes status the way the
   pipeline does, in raw SQL that goes nowhere near the router, and asserts
   the event appears anyway.

2. THE FUNNEL COUNTS REJECTIONS AT THE STAGE THEY REACHED. It previously had
   to drop them, because a row sitting at 'Rejected' could not say where it
   had been. That removed the worst outcomes from the response-rate
   denominator and quietly flattered it.
"""

import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Redirect the roots BEFORE importing anything that reads them — see the long
# note in test_feed_dedup.py about why this cannot be a monkeypatch.
_TMP = Path(tempfile.mkdtemp(prefix="facet-events-"))
os.environ["FACET_DATA_DIR"] = str(_TMP / "data")
os.environ["FACET_WORKSPACE_DIR"] = str(_TMP / "workspace")
os.environ["FACET_QUEUE_DB"] = str(_TMP / "data" / "queue.db")

import services.db as db  # noqa: E402
from routers.tracker import dashboard_summary  # noqa: E402
from services import paths  # noqa: E402

_tmp = paths.DB_PATH
assert str(_TMP) in str(_tmp), f"the test is pointed at {_tmp}, which is not a scratch database"
db.init_db()

failures = 0


def ok(condition: bool, message: str) -> None:
    global failures
    if not condition:
        print(f"  FAIL  {message}")
        failures += 1


async def new_application(company: str) -> int:
    return await db.execute(
        "INSERT INTO applications (company, role_title) VALUES (?, ?)", (company, "Engineer")
    )


async def statuses(app_id: int) -> list[str]:
    rows = await db.fetch_all(
        "SELECT status FROM application_events WHERE application_id = ? ORDER BY occurred_at, id",
        (app_id,),
    )
    return [row["status"] for row in rows]


async def set_status(app_id: int, status: str) -> None:
    """Deliberately raw SQL, exactly as routers/tailor.py writes it. If the
    history depended on going through the router, this call would produce
    nothing and the assertions below would catch it."""
    await db.execute("UPDATE applications SET status = ? WHERE id = ?", (status, app_id))


async def main() -> int:
    # --- The trigger ------------------------------------------------------
    app_id = await new_application("Northwind")
    ok(await statuses(app_id) == ["Saved"], "creating an application records its opening status")

    await set_status(app_id, "Cut")
    await set_status(app_id, "Set")
    ok(
        await statuses(app_id) == ["Saved", "Cut", "Set"],
        f"a raw UPDATE must still be recorded; got {await statuses(app_id)}",
    )

    # Writing the same value is not a change and must not add a row, or a
    # repeated PATCH from a client would inflate the history.
    await set_status(app_id, "Set")
    ok(len(await statuses(app_id)) == 3, "re-writing the same status records nothing")

    # Updating another column must not fabricate a status event.
    await db.execute("UPDATE applications SET notes = 'hello' WHERE id = ?", (app_id,))
    ok(len(await statuses(app_id)) == 3, "a non-status update records nothing")

    # --- The funnel counts a rejection where it actually died -------------
    rejected_late = await new_application("Kestrel")
    for status in ("Cut", "Set", "Interviewing", "Rejected"):
        await set_status(rejected_late, status)

    rejected_early = await new_application("Halden")
    for status in ("Cut", "Set", "Rejected"):
        await set_status(rejected_early, status)

    summary = await dashboard_summary()
    ok(summary["rejected_count"] == 2, "both rejections are counted")
    ok(
        summary["rejected_from"] == {"Interviewing": 1, "Set": 1},
        f"each rejection lands at the stage it reached; got {summary['rejected_from']}",
    )
    # All three reached Set; only the one that got an interview reached
    # Interviewing. Under the old status-only logic the two rejected rows were
    # dropped entirely and this read 1/1 = 100%.
    ok(summary["funnel"]["Set"] == 3, f"rejections still count as sent; got {summary['funnel']}")
    ok(
        abs(summary["response_rate"] - 1 / 3) < 1e-9,
        f"rejections belong in the denominator; got {summary['response_rate']}",
    )

    # --- Backfill: rows that predate the history table ---------------------
    legacy = await new_application("Copperline")
    await set_status(legacy, "Cut")
    await set_status(legacy, "Set")
    await set_status(legacy, "Offer")
    # Erase its history to stand in for a row created before this table
    # existed, leaving only the current status behind.
    await db.execute("DELETE FROM application_events WHERE application_id = ?", (legacy,))
    ok(await statuses(legacy) == [], "history cleared for the backfill case")

    conn = db._get_connection()
    db._migrate(conn)
    conn.commit()

    seeded = await db.fetch_all(
        "SELECT status, note FROM application_events WHERE application_id = ?", (legacy,)
    )
    ok(len(seeded) == 1, f"backfill seeds exactly one event; got {len(seeded)}")
    ok(seeded[0]["status"] == "Offer", "backfill records the status the row actually has")
    ok(
        seeded[0]["note"] and "backfilled" in seeded[0]["note"],
        "a backfilled row says so, rather than passing as observed history",
    )

    # Running the migration again must not seed a second time.
    db._migrate(conn)
    conn.commit()
    ok(len(await statuses(legacy)) == 1, "backfill is idempotent")

    # And the funnel must still credit it with every earlier stage, from its
    # current status alone — this is the case that would break if 'reached'
    # were computed from recorded events only.
    summary = await dashboard_summary()
    ok(
        summary["funnel"] == {"Cut": 4, "Set": 4, "Interviewing": 2, "Offer": 1},
        f"a backfilled row counts at every stage below it; got {summary['funnel']}",
    )

    # --- A rejection with no history at all -------------------------------
    orphan = await new_application("Ardent")
    await set_status(orphan, "Rejected")
    await db.execute("DELETE FROM application_events WHERE application_id = ?", (orphan,))
    summary = await dashboard_summary()
    ok(
        summary["rejected_from"].get("unknown") == 1,
        f"an unknowable stage is reported as unknown, not guessed; got {summary['rejected_from']}",
    )

    if failures:
        print(f"application events: {failures} check(s) failed")
        return 1
    print("application events: trigger records every write, funnel counts rejections honestly")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
