"""Run every check in this directory, and every module self-check.

    backend/.venv/bin/python scripts/check_all.py

There was no single command for this. Each suite ran on its own, which is
fine when you remember all of them — and is how three of them (feed dedup,
calendar sync, the agy roundtrip) sat broken for weeks after the multi-user
refactor moved the names they imported. Nothing was watching, because
watching meant remembering.

Discovery is by filename, so a new `test_*.py` is included the day it is
written. Each runs in its own process: they redirect FACET_* roots at import
time, and sharing an interpreter would mean the first one to import wins.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
PYTHON = BACKEND / ".venv" / "bin" / "python"

# Modules with a `demo()`/`__main__` self-check, run as `python -m`.
SELF_CHECKS = [
    "services.auth",
    "services.identity",
    "services.paths",
    "services.health",
    "services.jobs",
    "control.store",
]

# Needs a live, authenticated agy and writes into the real workspace. It is a
# manual check, not a gate — excluded so this command stays runnable anywhere.
MANUAL = {"test_agy_roundtrip.py"}


# `python -m services.auth` only resolves with the backend on the path, and
# relying on the caller's PYTHONPATH means this passes in one shell and fails
# in another.
ENV = {**os.environ, "PYTHONPATH": str(BACKEND)}


def run(label: str, argv: list[str]) -> tuple[str, bool, float]:
    start = time.perf_counter()
    result = subprocess.run(argv, cwd=BACKEND, capture_output=True, text=True, env=ENV)
    elapsed = time.perf_counter() - start
    ok = result.returncode == 0
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<24} {elapsed:5.1f}s")
    if not ok:
        tail = (result.stderr or result.stdout).strip().splitlines()[-6:]
        for line in tail:
            print(f"        {line}")
    return label, ok, elapsed


def main() -> int:
    print("suites")
    results = [
        run(path.stem, [str(PYTHON), str(path)])
        for path in sorted(HERE.glob("test_*.py"))
        if path.name not in MANUAL
    ]

    print("self-checks")
    env_argv = [str(PYTHON), "-m"]
    results += [run(module, env_argv + [module]) for module in SELF_CHECKS]

    failed = [label for label, ok, _ in results if not ok]
    total = sum(elapsed for _, _, elapsed in results)
    print(f"\n{len(results) - len(failed)}/{len(results)} passed in {total:.0f}s")
    if failed:
        print("failed: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
