"""All agy subprocess logic lives here.

Known bug: `agy -p` silently prints nothing to stdout when stdout is not a
real terminal (i.e. from any subprocess). The pipeline must NEVER depend on
capturing agy's stdout — every call uses the file-handoff pattern instead:
write input files, delete any stale output, run agy with an instruction that
tells it exactly which file to write, then read that file back from disk.
"""

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

from services.filelock import FileLock, LockTimeout
from services.paths import DATA_DIR, RULES_PATH, WORKSPACE_DIR as WORKSPACE

logger = logging.getLogger("facet.agy")

# One agy run at a time, across every process on this host. See filelock.py
# for why an asyncio.Lock isn't enough any more.
AGY_LOCK_PATH = Path(os.environ.get("FACET_AGY_LOCK", "").strip() or DATA_DIR / "agy.lock")

# Scratch for per-run input/output. Operational state, not the user's record:
# safe to delete wholesale, and swept after every run.
JOBS_DIR = Path(os.environ.get("FACET_JOBS_DIR", "").strip() or DATA_DIR / "jobs")

# The binary is looked up on PATH by default, which is right on a normal
# install. In a container — or anywhere agy isn't on PATH — point
# FACET_AGY_BIN at it instead of assuming a location that only exists on one
# machine.
AGY_BIN = os.environ.get("FACET_AGY_BIN", "agy")

# Long-running model calls; overridable because "slow" differs between a
# laptop and a throttled container.
AGY_TIMEOUT_SECONDS = int(os.environ.get("FACET_AGY_TIMEOUT", "300"))
# Claude-branded models (claude-sonnet-4-6, claude-opus-4-6-thinking) were
# quota-exhausted on this account at build time; gemini-3.1-pro-high is a
# full pro-tier model with separate quota — a reasonable fit for the
# truthfulness-critical work in Sections 5-6, unlike the lighter flash
# tiers. Revisit once Claude-model quota is reliably available again.
AGY_MODEL = os.environ.get("FACET_AGY_MODEL", "gemini-3.1-pro-high")


class AgyError(Exception):
    def __init__(self, message: str, hint: str):
        super().__init__(message)
        self.message = message
        self.hint = hint


class AgyBusyError(Exception):
    """agy was already running and the caller would not wait.

    Retained for callers that still want fail-fast semantics. The normal path
    is now the queue in services/jobs.py, which waits instead of rejecting —
    "busy, try again later" is a reasonable answer for one person and a
    hostile one for several.
    """


def prepare_job_dir(job_id: int | str, files: dict[str, str],
                    copy_from_workspace: tuple[str, ...] = ()) -> Path:
    """Stage one agy run's inputs in a directory containing nothing else.

    This is what closes the overwrite race. `tailor.py` used to write
    `workspace/job_description.md` *before* acquiring the agy lock, so a
    second request could replace it while the first run was mid-read — the
    failure being a resume tailored against somebody else's job description,
    silently, with no error. Staging per job, inside the lock, in an empty
    directory makes that unrepresentable rather than merely unlikely.

    It also tightens `--add-dir`: agy is handed exactly this job's files
    instead of the whole workspace.
    """
    job_dir = JOBS_DIR / str(job_id)
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)
    job_dir.mkdir(parents=True, exist_ok=True)

    for name in copy_from_workspace:
        source = RULES_PATH if name == "RULES.md" else WORKSPACE / name
        if source.exists():
            shutil.copy2(source, job_dir / name)

    for name, content in files.items():
        (job_dir / name).write_text(content, encoding="utf-8")

    return job_dir


def cleanup_job_dir(job_id: int | str) -> None:
    shutil.rmtree(JOBS_DIR / str(job_id), ignore_errors=True)


def sweep_orphan_job_dirs(keep: set[str] | None = None) -> int:
    """Remove scratch directories left by runs that died mid-flight.

    Called at startup. A crash between `prepare_job_dir` and `cleanup_job_dir`
    otherwise leaks a directory per incident, forever.
    """
    if not JOBS_DIR.exists():
        return 0
    removed = 0
    for entry in JOBS_DIR.iterdir():
        if entry.is_dir() and (keep is None or entry.name not in keep):
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
    return removed


def _run_agy_sync(instruction: str, output_filename: str,
                  work_dir: Path | None = None) -> str:
    work_dir = work_dir or WORKSPACE
    work_dir.mkdir(parents=True, exist_ok=True)
    output_path = work_dir / output_filename
    if output_path.exists():
        output_path.unlink()

    full_instruction = (
        f"{instruction}\n\n"
        f"Write your entire output to the file `{output_filename}` in the "
        "current directory. Do not rely on printing to the terminal — "
        "stdout is not read by the caller."
    )

    try:
        # Held across the whole subprocess: agy is one CLI with one
        # authenticated session, and on a shared host every process contends
        # for it. Waiting up to two runs' worth beats failing a queued job
        # that was only ever going to be second in line.
        with FileLock(AGY_LOCK_PATH, timeout=AGY_TIMEOUT_SECONDS * 2):
            result = subprocess.run(
                [
                    AGY_BIN,
                    "-p",
                    full_instruction,
                    "--mode=accept-edits",
                    "--model",
                    AGY_MODEL,
                    # No terminal is attached to this subprocess, so there is
                    # no way for agy's own permission prompts to be answered —
                    # the backend is the sole caller of agy in this app,
                    # always in this narrow file-handoff shape, so
                    # auto-approving here is equivalent to what
                    # --mode=accept-edits already implies.
                    "--dangerously-skip-permissions",
                    # Without this, agy inconsistently writes to its own
                    # internal ~/.gemini/antigravity-cli/scratch/ instead of
                    # the real cwd — reproduced repeatedly regardless of model
                    # or invocation method. Explicitly trusting the working
                    # directory as an agy workspace fixed it reliably across
                    # every retest.
                    #
                    # Scoped to the job directory, not the whole workspace:
                    # agy is handed this run's inputs and nothing else.
                    "--add-dir",
                    str(work_dir),
                ],
                cwd=str(work_dir),
                timeout=AGY_TIMEOUT_SECONDS,
                capture_output=True,
            )
    except LockTimeout as exc:
        raise AgyError(
            "AI engine busy",
            f"another run held the engine for longer than "
            f"{AGY_TIMEOUT_SECONDS * 2}s ({exc}).",
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise AgyError(
            "AI engine timed out",
            f"agy did not finish within {AGY_TIMEOUT_SECONDS}s and was killed.",
        ) from exc
    except FileNotFoundError as exc:
        raise AgyError(
            "AI engine not found",
            "check that `agy` is installed, authenticated, and has quota remaining",
        ) from exc

    if not output_path.exists() or output_path.stat().st_size == 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        raise AgyError(
            "AI engine produced no output",
            stderr
            or "check that `agy` is installed, authenticated, and has quota remaining",
        )

    return output_path.read_text(encoding="utf-8")


async def run_agy(instruction: str, output_filename: str,
                  work_dir: Path | None = None) -> str:
    """Run agy in the file-handoff pattern, off the FastAPI event loop.

    Waits for the engine rather than rejecting: callers arrive through the
    queue, which already guarantees they are in line. Serialization is the
    cross-process lock in `_run_agy_sync`, so this holds across every process
    sharing the host's single authenticated CLI.

    `work_dir` should be a directory holding only this run's files — see
    `prepare_job_dir`. It defaults to the shared workspace for the few
    callers that predate the queue.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, _run_agy_sync, instruction, output_filename, work_dir
    )


def parse_json_output(text: str) -> dict:
    """agy is told to output raw JSON, but strip code fences and retry once
    before erroring (Section 15) — models occasionally wrap output in
    ```json anyway."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        try:
            return json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise AgyError(
                "AI engine returned malformed JSON",
                "the output couldn't be parsed even after stripping code fences",
            ) from exc


def demo() -> None:
    """Self-check:  backend/.venv/python.exe -m services.agy_runner

    Covers the job-directory staging only — no agy call. The real round trip
    is scripts/test_agy_roundtrip.py, which needs an authenticated CLI.
    """
    import tempfile

    global JOBS_DIR, WORKSPACE, RULES_PATH
    root = Path(tempfile.mkdtemp())
    JOBS_DIR = root / "jobs"
    WORKSPACE = root / "workspace"
    RULES_PATH = WORKSPACE / "RULES.md"
    WORKSPACE.mkdir(parents=True)
    RULES_PATH.write_text("rules", encoding="utf-8")
    (WORKSPACE / "profile.json").write_text('{"name":"x"}', encoding="utf-8")

    job_dir = prepare_job_dir(
        7, {"job_description.md": "a JD"}, copy_from_workspace=("RULES.md", "profile.json")
    )
    assert (job_dir / "job_description.md").read_text(encoding="utf-8") == "a JD"
    assert (job_dir / "RULES.md").read_text(encoding="utf-8") == "rules"
    assert (job_dir / "profile.json").exists()

    # Nothing but this job's files — that scoping is what makes --add-dir a
    # boundary rather than a formality.
    assert sorted(p.name for p in job_dir.iterdir()) == [
        "RULES.md", "job_description.md", "profile.json",
    ]

    # Two jobs cannot see each other's inputs. This is the overwrite race
    # that used to exist in the shared workspace, asserted away.
    other = prepare_job_dir(8, {"job_description.md": "a different JD"})
    assert (job_dir / "job_description.md").read_text(encoding="utf-8") == "a JD"
    assert other != job_dir

    # A missing optional input is skipped, not fatal — RULES.md may not exist
    # in a fresh checkout, and that must not break a cut.
    RULES_PATH.unlink()
    bare = prepare_job_dir(9, {}, copy_from_workspace=("RULES.md",))
    assert not (bare / "RULES.md").exists()

    # Re-staging the same id starts clean, so a retry can't inherit a partial
    # directory from the attempt that failed.
    stale = prepare_job_dir(7, {"job_description.md": "retry"})
    assert not (stale / "profile.json").exists()
    assert (stale / "job_description.md").read_text(encoding="utf-8") == "retry"

    cleanup_job_dir(7)
    assert not (JOBS_DIR / "7").exists()
    cleanup_job_dir(7)  # idempotent — a failed run may clean up twice

    assert sweep_orphan_job_dirs(keep={"8"}) == 1  # removes 9, keeps 8
    assert (JOBS_DIR / "8").exists()
    assert sweep_orphan_job_dirs() == 1
    assert list(JOBS_DIR.iterdir()) == []

    print("agy_runner: all checks passed (job staging isolated)")


def check_agy_health() -> tuple[bool, str]:
    """Startup health check — agy --version. Called once at FastAPI startup."""
    try:
        result = subprocess.run(
            [AGY_BIN, "--version"], capture_output=True, timeout=10, text=True
        )
    except FileNotFoundError:
        return False, (
            f"agy CLI not found ({AGY_BIN})"
            if AGY_BIN != "agy"
            else "agy CLI not found on PATH"
        )
    except subprocess.TimeoutExpired:
        return False, "agy --version timed out"

    if result.returncode == 0:
        return True, result.stdout.strip()
    return False, result.stderr.strip() or "agy --version returned a non-zero exit code"


if __name__ == "__main__":
    demo()
