"""All agy subprocess logic lives here.

Known bug: `agy -p` silently prints nothing to stdout when stdout is not a
real terminal (i.e. from any subprocess). The pipeline must NEVER depend on
capturing agy's stdout — every call uses the file-handoff pattern instead:
write input files, delete any stale output, run agy with an instruction that
tells it exactly which file to write, then read that file back from disk.
"""

import asyncio
import json
import os
import re
import subprocess

from services.paths import WORKSPACE_DIR as WORKSPACE

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
    """Raised when a caller tries to run agy while another run is in
    flight — agy is a single CLI process, it can only do one thing at a
    time (Section 14). Routers should turn this into an HTTP 409."""


_agy_lock = asyncio.Lock()


def _run_agy_sync(instruction: str, output_filename: str) -> str:
    output_path = WORKSPACE / output_filename
    if output_path.exists():
        output_path.unlink()

    full_instruction = (
        f"{instruction}\n\n"
        f"Write your entire output to the file `{output_filename}` in the "
        "current directory. Do not rely on printing to the terminal — "
        "stdout is not read by the caller."
    )

    try:
        result = subprocess.run(
            [
                AGY_BIN,
                "-p",
                full_instruction,
                "--mode=accept-edits",
                "--model",
                AGY_MODEL,
                # No terminal is attached to this subprocess, so there is no
                # way for agy's own permission prompts to be answered — the
                # backend is the sole caller of agy in this app, always in
                # this narrow file-handoff shape, so auto-approving here is
                # equivalent to what --mode=accept-edits already implies.
                "--dangerously-skip-permissions",
                # Without this, agy inconsistently writes to its own
                # internal ~/.gemini/antigravity-cli/scratch/ instead of
                # the real cwd — reproduced repeatedly regardless of model
                # or invocation method. Explicitly trusting WORKSPACE as an
                # agy workspace dir fixed it reliably across every retest.
                "--add-dir",
                str(WORKSPACE),
            ],
            cwd=str(WORKSPACE),
            timeout=AGY_TIMEOUT_SECONDS,
            capture_output=True,
        )
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


async def run_agy(instruction: str, output_filename: str) -> str:
    """Run agy in the file-handoff pattern, off the FastAPI event loop.
    Raises AgyBusyError immediately (no queueing) if another run is already
    in flight — only one agy run is ever in flight at a time."""
    if _agy_lock.locked():
        raise AgyBusyError()

    async with _agy_lock:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, _run_agy_sync, instruction, output_filename
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
