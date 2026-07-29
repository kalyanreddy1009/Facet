"""A cross-process advisory lock, so agy stays serialized across processes.

`asyncio.Lock` only serializes coroutines inside one interpreter. That was
enough while Facet was one process on one laptop. It stops being enough the
moment a second process can invoke agy — a separate queue worker, a reload
spawning an overlapping instance, or several per-user stacks on one host all
sharing the single authenticated CLI.

Advisory, not mandatory: it only holds against other processes that ask for
the same lock. That is exactly the guarantee needed here, since every agy
call in this codebase goes through `agy_runner`.

The lock file is never deleted. Unlinking it races — another process can be
holding a descriptor to a path that no longer resolves, and then two
"holders" both believe they are alone. An empty file costs nothing.
"""

import errno
import os
import time
from pathlib import Path

if os.name == "nt":
    import msvcrt
else:
    import fcntl


class LockTimeout(Exception):
    """The lock was held by someone else for longer than the caller waited."""


class FileLock:
    """Blocking-with-timeout advisory lock on a file.

        with FileLock(path, timeout=600):
            ...                       # only one process here at a time

    Polls rather than blocking in the kernel: Windows has no
    wait-until-available mode for a byte-range lock, so a portable
    implementation has to poll on at least one platform. Polling on both
    keeps the two paths behaving identically, and it is also what makes the
    timeout enforceable — a kernel-blocking `flock` would wait forever.
    """

    def __init__(self, path: Path | str, timeout: float = 600.0, poll: float = 0.25):
        self.path = Path(path)
        # Who holds it goes in a sidecar, not in the locked file itself.
        # Windows byte-range locks are mandatory: while the lock is held,
        # every other handle is refused a read of that byte — including the
        # diagnostic one. A separate file stays readable on both platforms.
        self.owner_path = self.path.with_name(self.path.name + ".owner")
        self.timeout = timeout
        self.poll = poll
        self._fd: int | None = None

    def _try_acquire(self) -> bool:
        assert self._fd is not None
        try:
            if os.name == "nt":
                msvcrt.locking(self._fd, msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError as exc:
            # Windows reports contention as EDEADLOCK from LK_NBLCK, POSIX as
            # EACCES/EAGAIN. Anything else is a real error worth surfacing
            # rather than retrying until the timeout expires.
            if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLOCK):
                return False
            raise

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)

        deadline = time.monotonic() + self.timeout
        while True:
            if self._try_acquire():
                # Whose lock this is, for the admin dashboard and for anyone
                # staring at a stuck queue. Best-effort: never fail the
                # acquire over a diagnostic.
                try:
                    self.owner_path.write_text(
                        f"{os.getpid()} {time.time():.0f}\n", encoding="utf-8"
                    )
                except OSError:
                    pass
                return
            if time.monotonic() >= deadline:
                os.close(self._fd)
                self._fd = None
                raise LockTimeout(
                    f"could not acquire {self.path} within {self.timeout}s "
                    f"(held by: {self.holder() or 'unknown'})"
                )
            time.sleep(self.poll)

    def release(self) -> None:
        if self._fd is None:
            return
        try:
            if os.name == "nt":
                # Unlocking must name the same byte range that was locked.
                os.lseek(self._fd, 0, os.SEEK_SET)
                msvcrt.locking(self._fd, msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
        finally:
            os.close(self._fd)
            self._fd = None

    def is_held(self) -> bool:
        """Is anyone, in any process, holding this lock right now?

        Asks the only question that has a reliable answer: can it be taken?
        If it can, we took it for the duration of this call and gave it back,
        which is why this is safe to call from a status endpoint but wrong to
        build a decision on — by the time you read the result it can already
        be stale. Use it to report, not to gate.

        A separate open file description is used on purpose, so that a lock
        held by another thread of this same process still reads as held.
        """
        fd = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o644)
            try:
                if os.name == "nt":
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(fd, fcntl.LOCK_UN)
                return False
            except OSError as exc:
                if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLOCK):
                    return True
                raise
        except OSError:
            # An unreadable lock path is not proof of anything. Reporting
            # "idle" would be a guess; reporting "busy" at worst delays a
            # status line. Neither blocks a run, since this never gates one.
            return False
        finally:
            if fd is not None:
                os.close(fd)

    def holder(self) -> str | None:
        """"<pid> <unix time>" of the last acquirer, or None.

        Diagnostic only, and deliberately not cleared on release: it answers
        "who is holding this up", which is a question asked while the lock is
        held. Treat a value here as a hint, never as proof the lock is taken.
        """
        try:
            return self.owner_path.read_text(encoding="utf-8").strip() or None
        except OSError:
            return None

    def __enter__(self) -> "FileLock":
        self.acquire()
        return self

    def __exit__(self, *exc_info) -> None:
        self.release()


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m services.filelock

    Spawns a real second process — the whole point of this module is
    behaviour *between* processes, which a single-process test cannot show.
    """
    import subprocess
    import sys
    import tempfile

    tmp = Path(tempfile.mkdtemp())
    lock_path = tmp / "demo.lock"

    # Re-entering from the same process must still work once released.
    with FileLock(lock_path):
        pass
    with FileLock(lock_path) as lock:
        assert lock.holder().startswith(str(os.getpid())), lock.holder()

    # A second process must be excluded while we hold it, and must succeed
    # once we let go.
    child = (
        "import sys,time;sys.path.insert(0,%r);"
        "from services.filelock import FileLock,LockTimeout;"
        "l=FileLock(%r,timeout=%s);"
        "\ntry:\n l.acquire();print('ACQUIRED');l.release()\n"
        "except LockTimeout:\n print('TIMEOUT')"
    )
    here = str(Path(__file__).resolve().parent.parent)

    # is_held() reports the truth from outside the holder, which is what the
    # /status "agy busy" line depends on. Checked against a lock held by
    # *another* process, because that is the case it exists for: one user
    # asking whether somebody else's tailoring run is currently in flight.
    probe = FileLock(lock_path)
    assert not probe.is_held(), "nobody holds it yet"

    with FileLock(lock_path):
        assert probe.is_held(), "a held lock must read as held"
        out = subprocess.run(
            [sys.executable, "-c", child % (here, str(lock_path), "1.0")],
            capture_output=True, text=True, timeout=60,
        )
        assert "TIMEOUT" in out.stdout, f"expected exclusion, got {out.stdout!r} {out.stderr}"

    # And probing must not have consumed the lock: released means released.
    assert not probe.is_held(), "is_held() left the lock taken"

    out = subprocess.run(
        [sys.executable, "-c", child % (here, str(lock_path), "5.0")],
        capture_output=True, text=True, timeout=60,
    )
    assert "ACQUIRED" in out.stdout, f"expected acquisition, got {out.stdout!r} {out.stderr}"

    # A timeout must not leave the descriptor dangling — after a failed
    # acquire the next one has to be able to succeed.
    holder = FileLock(lock_path)
    holder.acquire()
    try:
        FileLock(lock_path, timeout=0.5).acquire()
        raise AssertionError("expected LockTimeout")
    except LockTimeout as exc:
        assert "held by" in str(exc), str(exc)
    holder.release()
    with FileLock(lock_path, timeout=1.0):
        pass

    print("filelock: all checks passed (cross-process exclusion verified)")


if __name__ == "__main__":
    demo()
