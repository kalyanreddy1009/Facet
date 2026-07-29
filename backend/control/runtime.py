"""Talking to the host: systemd, docker compose, cloudflared.

Two rules shape this module.

**Command construction is pure.** Every `*_command` function returns an argv
list and touches nothing. That is what makes the interesting part testable on
a machine with no daemon, no systemd and no tunnel — which includes the
machine this was written on.

**A missing tool is not an error.** If systemd or docker or a Cloudflare
token isn't there, the step reports `manual` and hands back the exact command
to run by hand. A half-configured host should tell you what it needs, not
fail at step 7 with a traceback.
"""

import os
import shutil
import subprocess
from pathlib import Path

from services.paths import ROOT

COMPOSE_FILE = ROOT / "docker-compose.user.yml"

# Built once and shared by every instance — no per-user address is baked in
# (see docker-compose.user.yml), so one image serves everyone.
FRONTEND_IMAGE = os.environ.get("FACET_FRONTEND_IMAGE", "").strip() or "facet-frontend:local"

COMMAND_TIMEOUT = 180


class Result:
    """What happened, in a form a step can record and a UI can display."""

    def __init__(self, ok: bool, mode: str, detail: str, command: list[str] | None = None):
        self.ok = ok
        self.mode = mode          # "ran" | "manual" | "failed"
        self.detail = detail
        self.command = command or []

    def as_dict(self) -> dict:
        return {"ok": self.ok, "mode": self.mode, "detail": self.detail,
                "command": " ".join(self.command)}

    def __repr__(self) -> str:
        return f"Result({self.mode}, {self.detail!r})"


# ------------------------------------------------------------ systemd scope

def systemd_scope() -> str:
    """"user" or "system" — which systemd instance owns the per-user units.

    System units need root. The control plane deliberately does not run as
    root, so on an unprivileged host `systemctl enable` fails with
    "Interactive authentication required" — which is what happens on the
    Oracle VM this is deployed to.

    User units solve that and one other thing at the same time. They need no
    polkit and no sudo, and they run as the invoking OS user — which must be
    the user that ran the agy sign-in, because agy reads credentials out of
    that account's home directory. Under system units those two identities
    are configured separately and can silently disagree; under user units
    they cannot.

    The cost is that user units stop at logout unless lingering is enabled:
        loginctl enable-linger $USER
    `preflight()` checks for it, because without it every instance dies the
    moment the admin closes their SSH session.
    """
    override = os.environ.get("FACET_SYSTEMD_SCOPE", "").strip().lower()
    if override in ("user", "system"):
        return override
    if os.name == "nt":
        return "system"
    # Root can drive the system instance; nobody else can.
    return "system" if os.geteuid() == 0 else "user"


def systemctl(*args: str) -> list[str]:
    """The systemctl argv for this host, scope included."""
    scope = ["--user"] if systemd_scope() == "user" else []
    return ["systemctl", *scope, *args]


def _systemd_reachable() -> bool:
    """`systemctl` on PATH does not mean we can drive it. A user instance
    needs a live session bus; a system instance needs root."""
    try:
        return subprocess.run(
            systemctl("show-environment"), capture_output=True, timeout=10,
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def lingering_enabled() -> bool:
    """Whether user units survive logout. Meaningless for system scope."""
    if systemd_scope() != "user":
        return True
    try:
        proc = subprocess.run(
            ["loginctl", "show-user", str(os.geteuid()), "-p", "Linger", "--value"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return proc.stdout.strip().lower() == "yes"


# ------------------------------------------------------------ capabilities

def has(tool: str) -> bool:
    return shutil.which(tool) is not None


def capabilities() -> dict[str, bool]:
    """What this host can actually do.

    Reported on the admin portal so a step landing in manual mode is
    explained by something visible, rather than looking like a failure.
    """
    return {
        "systemd": has("systemctl") and os.name != "nt" and _systemd_reachable(),
        "docker": has("docker") and _docker_daemon_up(),
        "cloudflared": has("cloudflared"),
        "cloudflare_api": bool(os.environ.get("CF_API_TOKEN", "").strip()),
    }


def _docker_daemon_up() -> bool:
    """`docker` on PATH does not mean a daemon is reachable — a client with
    no engine behind it is the normal state on a dev machine."""
    try:
        return subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True, timeout=10,
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def run(command: list[str], what: str, available: bool) -> Result:
    """Execute, or explain what to run by hand."""
    if not available:
        # The command goes in the detail, not just the structured field: this
        # string is what the admin portal shows, and "run by hand" without
        # saying what to run is a instruction that can't be followed.
        return Result(True, "manual", f"{what}:\n    {' '.join(command)}", command)
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=COMMAND_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as exc:
        return Result(False, "failed", f"{what}: {exc}", command)

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[:400] or f"exit {proc.returncode}"
        return Result(False, "failed", f"{what}: {detail}", command)
    return Result(True, "ran", (proc.stdout or what).strip()[:200] or what, command)


# ---------------------------------------------------------------- frontend

def compose_command(slug: str, env_file: Path, *args: str) -> list[str]:
    return [
        "docker", "compose",
        "-p", f"facet-{slug}",
        "--env-file", str(env_file),
        "-f", str(COMPOSE_FILE),
        *args,
    ]


def compose_up(slug: str, env_file: Path, available: bool) -> Result:
    return run(compose_command(slug, env_file, "up", "-d"),
               f"start {slug}'s frontend", available)


def compose_stop(slug: str, env_file: Path, available: bool) -> Result:
    return run(compose_command(slug, env_file, "stop"),
               f"stop {slug}'s frontend", available)


def compose_start(slug: str, env_file: Path, available: bool) -> Result:
    return run(compose_command(slug, env_file, "start"),
               f"start {slug}'s frontend", available)


def compose_down(slug: str, env_file: Path, available: bool) -> Result:
    # No `-v`: volumes are bind mounts to the user's data directory, and
    # `down -v` on a project that ever had named volumes is the kind of flag
    # that removes something irreplaceable. Data removal is deletion's job,
    # where it is deliberate, confirmed and reversible.
    return run(compose_command(slug, env_file, "down"),
               f"remove {slug}'s frontend", available)


# ----------------------------------------------------------------- backend

def unit_name(slug: str) -> str:
    return f"facet-api@{slug}.service"


def systemctl_command(action: str, slug: str) -> list[str]:
    return systemctl(action, unit_name(slug))


def service_start(slug: str, available: bool) -> Result:
    return run(systemctl("enable", "--now", unit_name(slug)),
               f"start {slug}'s backend", available)


def service_stop(slug: str, available: bool) -> Result:
    return run(systemctl_command("stop", slug), f"stop {slug}'s backend", available)


def service_restart(slug: str, available: bool) -> Result:
    return run(systemctl_command("restart", slug), f"restart {slug}'s backend", available)


def service_disable(slug: str, available: bool) -> Result:
    return run(systemctl("disable", "--now", unit_name(slug)),
               f"remove {slug}'s backend service", available)


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m control.runtime

    Command construction only. Nothing is executed, which is the point —
    these have to be right on a host this was never run on.
    """
    env = Path("/srv/facet/users/alice/.env")

    up = compose_command("alice", env, "up", "-d")
    assert up[:4] == ["docker", "compose", "-p", "facet-alice"], up
    assert "--env-file" in up and str(env) in up, up
    assert up[-2:] == ["up", "-d"], up
    # The compose file must be named explicitly: the working directory is the
    # control plane's, not the repo's, and the default lookup would find the
    # wrong file or none.
    assert str(COMPOSE_FILE) in up, up

    # `down -v` would remove volumes. Data removal belongs to deletion.
    assert "-v" not in compose_command("alice", env, "down")

    # The project name is what isolates one user's containers from another's.
    assert compose_command("bob", env, "ps")[3] == "facet-bob"

    assert unit_name("alice") == "facet-api@alice.service"

    # Scope is a prefix on every systemctl call, so asserting it once here
    # covers stop/start/restart/disable alike.
    scope = ["--user"] if systemd_scope() == "user" else []
    assert systemctl_command("stop", "bob") == \
        ["systemctl", *scope, "stop", "facet-api@bob.service"]
    # enable --now, so an instance survives a host reboot rather than needing
    # someone to remember to start it.
    assert service_start("alice", available=False).command == \
        ["systemctl", *scope, "enable", "--now", "facet-api@alice.service"]

    # An explicit override must win over the euid-derived default, since that
    # is how a root-run deployment opts back into system units.
    before = os.environ.get("FACET_SYSTEMD_SCOPE")
    try:
        os.environ["FACET_SYSTEMD_SCOPE"] = "user"
        assert systemctl("stop", "x") == ["systemctl", "--user", "stop", "x"]
        os.environ["FACET_SYSTEMD_SCOPE"] = "system"
        assert systemctl("stop", "x") == ["systemctl", "stop", "x"]
        # Junk falls back to the default rather than producing a bad argv.
        os.environ["FACET_SYSTEMD_SCOPE"] = "banana"
        assert systemctl("stop", "x")[:2] in (["systemctl", "--user"], ["systemctl", "stop"])
    finally:
        if before is None:
            os.environ.pop("FACET_SYSTEMD_SCOPE", None)
        else:
            os.environ["FACET_SYSTEMD_SCOPE"] = before

    # An unavailable tool yields a manual step that still succeeds and still
    # tells you the command — a missing daemon must not fail provisioning.
    result = compose_up("alice", env, available=False)
    assert result.ok and result.mode == "manual", result
    assert "docker compose" in result.as_dict()["command"]
    # The detail must carry the command too — it is what the portal displays,
    # and "run by hand" without the command cannot be acted on.
    assert "docker compose -p facet-alice" in result.detail, result.detail

    # A command that genuinely fails is reported as failed, not manual.
    broken = run(["definitely-not-a-real-binary-xyz"], "probe", available=True)
    assert not broken.ok and broken.mode == "failed", broken

    caps = capabilities()
    assert set(caps) == {"systemd", "docker", "cloudflared", "cloudflare_api"}
    assert all(isinstance(v, bool) for v in caps.values())

    print("control.runtime: all checks passed")
    print(f"  capabilities here: {caps}")


if __name__ == "__main__":
    demo()
