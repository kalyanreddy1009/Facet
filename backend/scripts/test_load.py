"""What the app does under concurrency, and how fast.

    backend/.venv/bin/python scripts/test_load.py

Two questions, and the first matters far more than the second.

**Does identity hold when requests overlap?** Every other suite signs one
person in, does a thing, signs the next person in. Real traffic does not
take turns. The identity of a request lives in a ContextVar, database
connections are cached per user, and queries run on threads — a mistake
anywhere in that chain shows up only when two people are in flight at once,
and it shows up as one person quietly reading another's Cabinet. So this
fires interleaved requests from several signed-in users at once and asserts
every response came back to the right person. It is a data-isolation test
that happens to be shaped like a load test.

**Is it fast enough?** The budgets below are deliberately loose — this runs
on a two-core VM, on ARM, alongside the app itself, so a tight budget would
fail on a busy afternoon and teach everyone to ignore it. They are set to
catch a regression of the kind that matters: an N+1 that turns a page into a
hundred queries, or a lock that serialises what used to be parallel.
"""

import os
import shutil
import statistics
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_TMP = Path(tempfile.mkdtemp(prefix="facet-load-"))
os.environ.update({
    "FACET_HOST_ROOT": str(_TMP / "host"),
    "FACET_USERS_ROOT": str(_TMP / "host" / "users"),
    "FACET_DATA_DIR": str(_TMP / "data"),
    "FACET_WORKSPACE_DIR": str(_TMP / "workspace"),
    "FACET_QUEUE_DB": str(_TMP / "queue.db"),
    "FACET_MULTIUSER": "1",
    "FACET_BIND_HOST": "127.0.0.1",
    "FACET_INSECURE_COOKIES": "1",
})

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from control import store  # noqa: E402
from services import auth  # noqa: E402

PASSWORD = "a perfectly ordinary passphrase"
PEOPLE = ["ana", "ben", "cleo", "dev", "eve"]

# Rows per person. Enough that a query touching all of them is measurable,
# small enough that the fixture builds in a couple of seconds.
ROWS = 40

# Wall-clock ceilings for one request, in seconds, measured at the 95th
# percentile. Generous on purpose — see the note at the top.
BUDGET = {
    "/api/applications": 0.75,
    "/api/dashboard/summary": 1.5,
    "/api/auth/me": 0.30,
}


class Person:
    """One signed-in identity, as a cookie header.

    Deliberately *not* one TestClient each. A TestClient owns an event loop,
    and `services.db` holds a module-level `asyncio.Lock` created once at
    import — awaiting it from a second loop deadlocks, which is what the first
    version of this file did, for two and a half minutes, in silence.
    Production has exactly one loop, so five clients would also have been the
    wrong shape to test: the concurrency that can actually happen is many
    requests interleaved *inside* one loop, which is what this does.
    """

    def __init__(self, client: TestClient, name: str):
        self.name = name
        self.client = client
        email = f"{name}@example.com"
        row = store.get_user_by_email(email) or store.create_user_row(email, None)
        store.set_password(row["id"], auth.hash_password(PASSWORD))
        store.set_status(row["id"], store.ACTIVE)

        client.cookies.clear()
        response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
        assert response.status_code == 200, response.text
        self.cookie = {"Cookie": f"{auth.SESSION_COOKIE}={response.cookies[auth.SESSION_COOKIE]}"}
        client.cookies.clear()

    def get(self, path: str):
        return self.client.get(path, headers=self.cookie)

    def post(self, path: str, json):
        return self.client.post(path, json=json, headers=self.cookie)


def _seed(client: TestClient) -> dict[str, Person]:
    people = {}
    for name in PEOPLE:
        person = Person(client, name)
        for index in range(ROWS):
            # The company name carries the owner's name, so a row that
            # surfaces in the wrong response is self-identifying.
            created = person.post(
                "/api/applications",
                {"company": f"{name}-corp-{index}", "role_title": "Engineer"},
            )
            assert created.status_code == 200, created.text
        people[name] = person
    return people


def check_identity_holds_when_requests_overlap(people: dict[str, Person]) -> None:
    """The check this file exists for."""
    def read(name: str) -> tuple[str, list]:
        return name, people[name].get("/api/applications").json()

    wrong = []
    # Several rounds: a ContextVar leak is a race, and a race that loses once
    # in twenty passes a single-shot test.
    with ThreadPoolExecutor(max_workers=len(PEOPLE) * 2) as pool:
        for _ in range(8):
            work = [pool.submit(read, name) for name in PEOPLE for _ in range(2)]
            for future in work:
                name, rows = future.result()
                assert len(rows) == ROWS, f"{name} saw {len(rows)} rows, expected {ROWS}"
                for row in rows:
                    if not row["company"].startswith(f"{name}-corp-"):
                        wrong.append(f"{name} was shown {row['company']}")
    assert not wrong, "identity leaked under concurrency:\n  " + "\n  ".join(wrong[:10])
    print(f"  isolation:  {len(PEOPLE) * 2 * 8} overlapping reads, every row went to its owner")


def check_a_write_during_reads_stays_in_its_own_database(
    people: dict[str, Person]
) -> None:
    """SQLite has one writer. The danger is not slowness, it is a write
    landing in whichever database the thread happened to have open."""
    def write(name: str) -> None:
        response = people[name].post(
            "/api/applications",
            {"company": f"{name}-corp-concurrent", "role_title": "Engineer"},
        )
        assert response.status_code == 200, response.text

    with ThreadPoolExecutor(max_workers=len(PEOPLE)) as pool:
        list(pool.map(write, PEOPLE))

    for name, person in people.items():
        rows = person.get("/api/applications").json()
        mine = [r for r in rows if r["company"] == f"{name}-corp-concurrent"]
        assert len(mine) == 1, f"{name} has {len(mine)} of their own concurrent write"
        assert len(rows) == ROWS + 1, f"{name} sees {len(rows)} rows after one write each"
    print("  writes:     five simultaneous writes, each in the right database")


def check_response_times(people: dict[str, Person]) -> None:
    person = people[PEOPLE[0]]
    slow = []
    for path, ceiling in BUDGET.items():
        samples = []
        for _ in range(20):
            start = time.perf_counter()
            response = person.get(path)
            samples.append(time.perf_counter() - start)
            assert response.status_code == 200, f"{path} -> {response.status_code}"
        samples.sort()
        p95 = samples[int(len(samples) * 0.95) - 1]
        median = statistics.median(samples)
        if p95 > ceiling:
            slow.append(f"{path}: p95 {p95 * 1000:.0f}ms, budget {ceiling * 1000:.0f}ms")
        else:
            print(f"  timing:     {path} median {median * 1000:.0f}ms, p95 {p95 * 1000:.0f}ms")
    assert not slow, "over budget:\n  " + "\n  ".join(slow)


def check_a_burst_does_not_drop_anything(people: dict[str, Person]) -> None:
    """200 requests as fast as five threads can issue them. Nothing may fail,
    and nothing may 5xx — a queue that sheds load silently is worse than one
    that is slow."""
    def hit(index: int) -> int:
        return people[PEOPLE[index % len(PEOPLE)]].get("/api/auth/me").status_code

    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=10) as pool:
        codes = list(pool.map(hit, range(200)))
    elapsed = time.perf_counter() - start

    assert all(code == 200 for code in codes), f"{codes.count(200)}/200 succeeded"
    print(f"  burst:      200 requests in {elapsed:.1f}s, none dropped")


def main_() -> None:
    with TestClient(main.app) as client:
        people = _seed(client)
        check_identity_holds_when_requests_overlap(people)
        check_a_write_during_reads_stays_in_its_own_database(people)
        check_response_times(people)
        check_a_burst_does_not_drop_anything(people)
    print("load: all checks passed")


if __name__ == "__main__":
    try:
        main_()
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
