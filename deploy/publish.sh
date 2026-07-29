#!/usr/bin/env bash
#
# Ship the current checkout to the running host.
#
#     deploy/publish.sh
#
# This exists because deploying by hand meant `rm -rf .next && npm run build`,
# on the live box, while people were using it. That deletes the running
# server's own files: every request during the build — half a minute or more —
# comes back as a Cloudflare 502, and anyone mid-session gets broken chunks
# rather than a clean error. Two people hit exactly that on 2026-07-29.
#
# So: run the checks, build into a *different* directory, and only once that
# has succeeded swap it in and restart. A failed build now changes nothing at
# all, and a successful one costs one restart — a few seconds — instead of the
# whole build.
#
# Safe to run repeatedly. Touches nothing under data/ or workspace/.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$REPO/frontend"
PYTHON="$REPO/backend/.venv/bin/python"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

step "backend checks"
env -u PYTHONPATH "$PYTHON" "$REPO/backend/scripts/check_all.py"

step "frontend checks"
cd "$FRONTEND"
npm run check
npx tsc --noEmit

step "build (into .next.incoming, so the live server keeps serving)"
rm -rf .next.incoming
NEXT_DIST_DIR=.next.incoming npm run build

# Everything below is quick and ordered so that a failure leaves the previous
# build in place rather than nothing at all.
step "swap"
rm -rf .next.previous
[ -d .next ] && mv .next .next.previous
mv .next.incoming .next

step "restart"
systemctl --user restart facet-api facet-web

# Wait for the frontend to answer before declaring success — a restart that
# fails silently is how a deploy "succeeds" onto a dead site.
for attempt in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ || true)
  if [ "$code" = "200" ]; then
    step "up after ${attempt}s"
    curl -s -o /dev/null -w 'public: %{http_code}\n' --max-time 10 \
      -H 'User-Agent: Mozilla/5.0' https://facet.nivil.dpdns.org/
    exit 0
  fi
  sleep 1
done

step "the frontend did not come back — rolling back"
rm -rf .next
mv .next.previous .next
systemctl --user restart facet-web
exit 1
