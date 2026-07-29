"""Task 10 validation: all three confidence tiers, past/no-match exclusion,
and dedup across two runs — against a local test .ics fixture (a real,
dereferenceable file:// URL, run through the actual fetch+parse+match code
path — not a mocked function call). Sets up its own fixtures and cleans up
after itself; safe to re-run.
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# A scratch root, set before any import reads it.
#
# This file used to run against whatever database `services.db.DB_PATH`
# pointed at — which, after paths moved to `services.paths`, was the real
# one. It opens by DELETEing rows and then inserting fixture applications, so
# every run edited live data. It has not run at all since that import broke,
# which is the only reason there is nothing to clean up.
_TMP = Path(tempfile.mkdtemp(prefix="facet-calendar-"))
os.environ["FACET_DATA_DIR"] = str(_TMP / "data")
os.environ["FACET_WORKSPACE_DIR"] = str(_TMP / "workspace")
os.environ["FACET_QUEUE_DB"] = str(_TMP / "data" / "queue.db")

import services.calendar_sync as calendar_sync  # noqa: E402
from services.db import init_db  # noqa: E402
from services.paths import DB_PATH  # noqa: E402

assert str(_TMP) in str(DB_PATH), f"pointed at {DB_PATH}, which is not a scratch database"

ICS_PATH = Path(__file__).resolve().parent / "test_calendar.ics"
ICS_URL = f"file:///{ICS_PATH.as_posix()}"

init_db()

import sqlite3  # noqa: E402

conn = sqlite3.connect(str(DB_PATH))
conn.execute("DELETE FROM contacts WHERE email = 'alex@highconf.example'")
conn.execute("DELETE FROM applications WHERE company IN ('HighConf Co', 'MedConf Co')")
conn.execute(
    "DELETE FROM suggested_interviews WHERE uid LIKE 'test-%@facet-test'"
)
conn.execute(
    "DELETE FROM interviews WHERE round_name = 'Phone Screen' AND application_id NOT IN (SELECT id FROM applications)"
)
conn.commit()

high_app = conn.execute(
    "INSERT INTO applications (company, role_title, company_domain) VALUES (?, ?, ?)",
    ("HighConf Co", "Engineer", "highconf.example"),
).lastrowid
conn.execute(
    "INSERT INTO contacts (application_id, name, email) VALUES (?, ?, ?)",
    (high_app, "Alex Recruiter", "alex@highconf.example"),
)
med_app = conn.execute(
    "INSERT INTO applications (company, role_title, company_domain) VALUES (?, ?, ?)",
    ("MedConf Co", "Engineer", "medconf.example"),
).lastrowid
conn.commit()
conn.close()

calendar_sync.save_calendar_config(ICS_URL)

print("=== run 1 ===")
result1 = calendar_sync.run_calendar_sync()
print(result1)
assert result1["new_suggestions"] == 3, f"expected 3 new suggestions, got {result1}"

print("=== run 2 (dedup check) ===")
result2 = calendar_sync.run_calendar_sync()
print(result2)
assert result2["new_suggestions"] == 0, f"expected 0 new on rerun, got {result2}"

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row
rows = conn.execute(
    "SELECT * FROM suggested_interviews WHERE dismissed = 0 ORDER BY scheduled_at"
).fetchall()
by_confidence = {r["confidence"]: dict(r) for r in rows}

assert by_confidence["high"]["application_id"] == high_app
assert by_confidence["high"]["contact_id"] is not None
assert by_confidence["medium"]["application_id"] == med_app
assert by_confidence["medium"]["contact_id"] is None
assert by_confidence["low"]["application_id"] is None
assert by_confidence["low"]["contact_id"] is None

no_match = conn.execute(
    "SELECT 1 FROM suggested_interviews WHERE uid = 'test-no-match-1@facet-test'"
).fetchone()
assert no_match is None, "non-interview-shaped, unmatched event should never be inserted"

past_event = conn.execute(
    "SELECT 1 FROM suggested_interviews WHERE uid = 'test-past-event-1@facet-test'"
).fetchone()
assert past_event is None, "past events should be excluded regardless of match confidence"

conn.close()
print("ALL CALENDAR SYNC CHECKS PASSED")
