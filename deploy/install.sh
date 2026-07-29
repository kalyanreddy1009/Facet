#!/usr/bin/env bash
#
# Install Facet's systemd user units for the account that runs this script.
#
#   ./deploy/install.sh
#
# Idempotent: safe to re-run after pulling changes, which is the point — the
# units embed absolute paths, so they have to be regenerated whenever the
# checkout moves rather than hand-edited in two places.
#
# No root. The units are user units (see deploy/user/facet-api@.service for
# why), so everything here lands under $HOME.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

# Where per-user instances live: their data, workspaces, exports and the one
# shared agy lock. Deliberately outside the repo, so a git operation can
# never touch a user's data.
FACET_HOST_ROOT="${FACET_HOST_ROOT:-$HOME/facet-hosts}"
FACET_BASE_DOMAIN="${FACET_BASE_DOMAIN:-facet.example}"
FACET_TUNNEL_CONFIG="${FACET_TUNNEL_CONFIG:-$HOME/.cloudflared/config.yml}"

say() { printf '\n\033[1;36m>> %s\033[0m\n' "$1"; }
warn() { printf '  ! %s\n' "$1"; }

# --- sanity ----------------------------------------------------------------

if [ "$(id -u)" -eq 0 ]; then
  warn "Running as root installs the units into root's systemd, and root is"
  warn "almost certainly not the account that ran the agy sign-in."
  warn "Re-run as the account that owns agy's credentials."
  exit 1
fi

if [ ! -x "$REPO/backend/.venv/bin/python" ]; then
  warn "No backend venv at $REPO/backend/.venv — run ./start.sh --setup first."
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  warn "systemd not found. Facet runs fine without it — provisioning will"
  warn "report each step as 'manual' and print the command to run by hand."
  exit 1
fi

# --- render ----------------------------------------------------------------

say "Installing user units into $UNIT_DIR"
mkdir -p "$UNIT_DIR" "$FACET_HOST_ROOT"

render() {  # src dst
  sed -e "s|\${FACET_ROOT}|$REPO|g" \
      -e "s|\${FACET_HOST_ROOT}|$FACET_HOST_ROOT|g" \
      -e "s|\${FACET_BASE_DOMAIN}|$FACET_BASE_DOMAIN|g" \
      -e "s|\${FACET_TUNNEL_CONFIG}|$FACET_TUNNEL_CONFIG|g" \
      "$1" > "$2"
  echo "  wrote $2"
}

# BACKEND_PORT is intentionally NOT substituted: it comes from each user's
# generated .env at runtime, which is what makes one template serve everyone.
render "$REPO/deploy/user/facet-api@.service"    "$UNIT_DIR/facet-api@.service"
render "$REPO/deploy/user/facet-control.service" "$UNIT_DIR/facet-control.service"

systemctl --user daemon-reload
echo "  daemon-reload done"

# --- agy reachability ------------------------------------------------------
#
# The units pin PATH to the list below. Checking against that list rather
# than against your shell's PATH is the whole point: agy being runnable in
# your terminal says nothing about whether the service can find it, and that
# discrepancy fails at tailoring time rather than at startup.

say "Checking agy"
UNIT_PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/usr/bin:/bin"
if AGY_AT="$(PATH="$UNIT_PATH" command -v agy 2>/dev/null)"; then
  echo "  found at $AGY_AT"
  if PATH="$UNIT_PATH" agy --version >/dev/null 2>&1; then
    echo "  runs: $(PATH="$UNIT_PATH" agy --version 2>&1 | head -1)"
  else
    warn "found but did not run — check the sign-in for this account"
  fi
else
  warn "agy is NOT on the PATH the units use:"
  warn "  $UNIT_PATH"
  if command -v agy >/dev/null 2>&1; then
    warn "It IS on your shell PATH at $(command -v agy)."
    warn "Symlink it into ~/.local/bin, or edit Environment=PATH in"
    warn "  $UNIT_DIR/facet-api@.service"
  else
    warn "Facet still runs; tailoring will report agy as unavailable."
  fi
fi

# --- lingering -------------------------------------------------------------

say "Checking lingering"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" = "yes" ]; then
  echo "  already enabled — instances survive logout and reboot"
else
  warn "Lingering is OFF. Without it every Facet instance stops the moment"
  warn "you close this SSH session. Enabling it needs root, once:"
  echo
  echo "      sudo loginctl enable-linger $USER"
  echo
fi

# --- next steps ------------------------------------------------------------

say "Installed"
cat <<EOF
  repo:       $REPO
  host root:  $FACET_HOST_ROOT
  domain:     $FACET_BASE_DOMAIN

  Start the control plane (the admin portal):

      systemctl --user enable --now facet-control
      systemctl --user status facet-control

  Then open http://127.0.0.1:9000 — over an SSH tunnel, or behind Cloudflare
  Access. It binds loopback on purpose and must not be published directly.

  Per-user backends are started by the portal when you add a user; you do not
  enable facet-api@ by hand.
EOF
