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


# The per-user frontend container and backend systemd unit are gone.
#
# One instance serves everyone now, so there is no `facet-alice` compose
# project and no `facet-api@alice.service` to start, stop or tear down.
# Facet runs as a single service, managed the ordinary way — `systemctl
# --user restart facet` — rather than through the control plane.
#
# Suspending or deleting a user is a status change plus closing their
# database handle (see control.provision.quiesce), not a process operation.

def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m control.runtime

    Command construction only. Nothing is executed, which is the point —
    these have to be right on a host this was never run on.
    """
    # Scope is a prefix on every systemctl call, and it is the whole reason
    # this module exists: the control plane is not root, so `systemctl start`
    # without --user fails with "Interactive authentication required".
    scope = ["--user"] if systemd_scope() == "user" else []
    assert systemctl("restart", "facet") == ["systemctl", *scope, "restart", "facet"]

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
    result = run(["systemctl", "reload", "cloudflared"], "reload tunnel",
                 available=False)
    assert result.ok and result.mode == "manual", result
    # The detail must carry the command too — it is what the portal displays,
    # and "run by hand" without the command cannot be acted on.
    assert "systemctl reload cloudflared" in result.detail, result.detail

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
