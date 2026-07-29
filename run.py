#!/usr/bin/env python3
"""Facet launcher — one command, any platform.

Creates the backend venv, installs Python + Node deps, initializes the DB,
then runs the FastAPI backend and Next.js frontend together. Ctrl+C stops both.

    python run.py            # production build, then serve
    python run.py --dev      # dev servers: uvicorn --reload + next dev
    python run.py --build    # force a frontend rebuild, then serve
    python run.py --setup    # install deps only, don't launch

Production is the default deliberately. `next dev` uses roughly 3x the memory
of `next start` and recompiles on every request, and `uvicorn --reload`
restarts on file changes — which will abandon an in-flight agy run. Neither
belongs in front of anyone but you.

Two dependencies can't be auto-installed and are only checked/reported:
  - WeasyPrint's native GTK/Pango libs (PDF export). App runs without them.
  - the `agy` (Antigravity) CLI (all AI features). App runs; AI actions error.
"""

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / "backend" / ".venv"
IS_WIN = os.name == "nt"

BACKEND_PORT = 8000
FRONTEND_PORT = 3000

# Loopback by default, and deliberately.
#
# `next start` binds 0.0.0.0 unless told otherwise. On a laptop that is
# harmless; on a cloud VM with a public IP it publishes the whole app to the
# internet with no authentication in front of it, because the authentication
# is Cloudflare Access and Access is reached through the tunnel. The one
# command that is easiest to run must not be the one that exposes everything.
#
# Set FACET_BIND=0.0.0.0 to override, which is a thing you now have to do on
# purpose.
BIND_HOST = os.environ.get("FACET_BIND", "").strip() or "127.0.0.1"


def node_env() -> dict:
    """Environment for npm subprocesses.

    NEXT_TELEMETRY_DISABLED is set here rather than left to `next telemetry
    disable`, because that command writes to a per-user config file on one
    machine. "No telemetry" is a property of this application, so it travels
    with the repo. The Dockerfile sets the same variable for the same reason.
    """
    env = os.environ.copy()
    env["NEXT_TELEMETRY_DISABLED"] = "1"
    return env


def say(msg: str) -> None:
    print(f"\n\033[1;36m>> {msg}\033[0m" if not IS_WIN else f"\n>> {msg}")


def warn(msg: str) -> None:
    print(f"  ! {msg}")


def venv_python() -> Path:
    """The venv's python across venv (Scripts/bin) and conda (root) layouts."""
    for candidate in (
        VENV / "Scripts" / "python.exe",  # Windows venv
        VENV / "python.exe",              # Windows conda
        VENV / "bin" / "python",          # POSIX
    ):
        if candidate.exists():
            return candidate
    raise SystemExit(f"No python found in {VENV}")


def ensure_backend() -> Path:
    fresh = False
    if not VENV.exists() or not any(VENV.glob("**/python*")):
        say("Creating backend virtual environment...")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
        fresh = True

    py = venv_python()

    # Install if freshly created, or if a core dep is missing.
    # Check a dep from every era of this file, not just the original ones —
    # an existing venv from before the job aggregator landed has fastapi but
    # no httpx, and would otherwise be left silently broken.
    have_deps = subprocess.run(
        [str(py), "-c", "import fastapi, uvicorn, httpx, feedparser"],
        capture_output=True,
    ).returncode == 0
    if fresh or not have_deps:
        say("Installing backend dependencies...")
        subprocess.run([str(py), "-m", "pip", "install", "--upgrade", "pip"], check=True)
        subprocess.run(
            [str(py), "-m", "pip", "install", "-r", str(ROOT / "backend" / "requirements.txt")],
            check=True,
        )
    return py


def npm_cmd() -> str:
    found = shutil.which("npm") or shutil.which("npm.cmd")
    if not found:
        raise SystemExit(
            "Node.js / npm not found on PATH. Install Node 22.6+ from https://nodejs.org "
            "and re-run."
        )
    return found


def ensure_frontend(npm: str) -> None:
    node = shutil.which("node")
    if node:
        ver = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
        try:
            major = int(ver.lstrip("v").split(".")[0])
            # Next 16 needs 20.9+, but `npm run check` runs a .ts file directly
            # and that needs Node's type stripping — 22.6+. The suite is only
            # as usable as the lower of the two, so warn on the higher bar.
            if major < 22:
                warn(f"Node {ver} detected — Next.js 16 needs 20.9+, and "
                     f"`npm run check` needs 22.6+. Please upgrade.")
        except ValueError:
            pass

    if not (ROOT / "frontend" / "node_modules").exists():
        say("Installing frontend dependencies (npm install)...")
        subprocess.run([npm, "install"], cwd=str(ROOT / "frontend"), check=True)


def ensure_build(npm: str, force: bool) -> None:
    """Build the frontend for production if it hasn't been built.

    BUILD_ID is what `next start` refuses to run without, so it's the honest
    marker for "a build exists". Staleness isn't detected — a build from an
    older dependency set fails in confusing ways (`Cannot find module for
    page: /_not-found` on pages that plainly exist), so `--build` exists to
    clear it out by hand after an upgrade.
    """
    next_dir = ROOT / "frontend" / ".next"
    if force and next_dir.exists():
        say("Removing previous build...")
        shutil.rmtree(next_dir, ignore_errors=True)

    if (next_dir / "BUILD_ID").exists():
        return

    say("Building frontend for production...")
    subprocess.run([npm, "run", "build"], cwd=str(ROOT / "frontend"),
                   env=node_env(), check=True)


def check_optional(py: Path) -> None:
    say("Checking optional dependencies")
    # Importing `services` first is what puts the venv's native DLL directory
    # on the search path (see backend/services/__init__.py) — testing a bare
    # `import weasyprint` reported export as broken when it actually works.
    weasy_ok = subprocess.run(
        [str(py), "-c", "import services, weasyprint"],
        cwd=str(ROOT / "backend"),
        capture_output=True,
    ).returncode == 0
    print("  PDF export (WeasyPrint):", "ready" if weasy_ok else
          "unavailable — native GTK/Pango libs missing. App runs; PDF/DOCX export won't.")
    print("  AI engine (agy CLI):     ",
          "ready" if shutil.which("agy") else
          "not found on PATH. App runs; tailoring/extraction will error until installed.")


def port_in_use(port: int) -> bool:
    """True if something already holds this port on localhost.

    Without this the servers start, silently fail to bind, and you end up
    talking to whatever was already there — which looks exactly like the new
    code not taking effect. Failing loudly here saves that hunt.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.6)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def check_ports() -> None:
    busy = [p for p in (BACKEND_PORT, FRONTEND_PORT) if port_in_use(p)]
    if not busy:
        return

    say("Port already in use")
    for port in busy:
        what = "backend" if port == BACKEND_PORT else "frontend"
        warn(f"port {port} ({what}) is already serving something")
    print("\n  Facet is probably already running — try http://localhost:3000 first.")
    print("  If it's a stale process, stop it and re-run:")
    if IS_WIN:
        ports = " ".join(str(p) for p in busy)
        print(f"    for %p in ({ports}) do @for /f \"tokens=5\" %a in "
              f"('netstat -ano ^| findstr :%p ^| findstr LISTENING') do taskkill /PID %a /F")
    else:
        print(f"    kill $(lsof -t {' '.join(f'-i:{p}' for p in busy)})")
    raise SystemExit(1)


def backend_env(py: Path) -> dict:
    env = os.environ.copy()
    dll_dir = VENV / "Library" / "bin"  # conda-forge WeasyPrint layout
    if dll_dir.exists():
        env["WEASYPRINT_DLL_DIRECTORIES"] = str(dll_dir)
        env["PATH"] = str(dll_dir) + os.pathsep + env.get("PATH", "")
    return env


def stop_tree(proc: subprocess.Popen) -> None:
    """Ask a whole process group to stop.

    On POSIX the group exists because Popen was given start_new_session; the
    signal reaches npm's children, which is the point. On Windows there are
    no groups, so taskkill /T walks the tree instead.
    """
    try:
        if IS_WIN:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T"],
                           capture_output=True, timeout=15)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (OSError, ProcessLookupError, subprocess.SubprocessError):
        proc.terminate()  # the group is already gone; the direct child may not be


def kill_tree(proc: subprocess.Popen) -> None:
    """Same, without asking. Only after stop_tree has been given its timeout."""
    try:
        if IS_WIN:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           capture_output=True, timeout=15)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (OSError, ProcessLookupError, subprocess.SubprocessError):
        proc.kill()


def main() -> None:
    dev = "--dev" in sys.argv

    py = ensure_backend()
    npm = npm_cmd()
    ensure_frontend(npm)

    say("Initializing tracker database...")
    subprocess.run([str(py), str(ROOT / "backend" / "scripts" / "init_db.py")], check=True)

    check_optional(py)

    if "--setup" in sys.argv:
        say("Setup complete. Run `python run.py` to launch.")
        return

    if not dev:
        ensure_build(npm, force="--build" in sys.argv)

    check_ports()

    mode = "dev" if dev else "production"
    say(f"Starting Facet ({mode}) — backend :{BACKEND_PORT}, frontend "
        f":{FRONTEND_PORT}  (Ctrl+C stops both)")

    backend_cmd = [str(py), "-m", "uvicorn", "main:app",
                   "--host", BIND_HOST, "--port", str(BACKEND_PORT)]
    if dev:
        backend_cmd.append("--reload")

    # npm is a launcher: it spawns the real `next` process as a child and
    # exits the signal chain there. Terminating npm alone leaves next holding
    # port 3000, so the next `./start.sh` dies on "address already in use"
    # pointing at a process that looks like nobody started it. Own the whole
    # group, the same way services/agy_runner.py owns agy's.
    new_session = not IS_WIN

    frontend_cmd = [npm, "run", "dev" if dev else "start", "--",
                    "-H", BIND_HOST, "-p", str(FRONTEND_PORT)]

    backend = subprocess.Popen(
        backend_cmd, cwd=str(ROOT / "backend"), env=backend_env(py),
        start_new_session=new_session,
    )
    frontend = subprocess.Popen(
        frontend_cmd, cwd=str(ROOT / "frontend"), env=node_env(),
        start_new_session=new_session,
    )

    print(f"\n  Frontend: http://{BIND_HOST}:{FRONTEND_PORT}")
    print(f"  Backend:  http://{BIND_HOST}:{BACKEND_PORT}")
    print("  Extension: chrome://extensions -> Developer Mode -> Load unpacked ->",
          ROOT / "extension", "\n")

    # Ctrl+C is not the only way this gets stopped.
    #
    # SIGTERM is what systemd, `kill`, and every process supervisor send, and
    # its default action ends the interpreter outright — the `finally` below
    # never runs, and both children are left holding their ports. Turning it
    # into the same exception the keyboard raises means one teardown path
    # serves every way of asking this to stop.
    def _on_term(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, _on_term)
    if not IS_WIN:
        signal.signal(signal.SIGHUP, _on_term)  # the SSH session going away

    try:
        while backend.poll() is None and frontend.poll() is None:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in (frontend, backend):
            if p.poll() is None:
                stop_tree(p)
        for p in (frontend, backend):
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                kill_tree(p)


if __name__ == "__main__":
    main()
