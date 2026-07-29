# Host setup

Bringing up a multi-user Facet on one Linux VM. See `PLAN.md` for why the
architecture is shaped this way; this is the operational sequence.

> **Setting this up for the first time?** Follow **`docs/setup.md`** instead.
> It walks the whole thing end to end — domain, Cloudflare, Access, users —
> with the values to collect up front and a verification checklist. This file
> is the condensed reference for someone who has done it before.

Target: Oracle Always Free ARM (2 vCPU / 12 GB / 200 GB), Ubuntu 24.04,
behind Cloudflare Tunnel + Access on your own domain. Cost: $0.

Every step below has been run on that hardware (aarch64, Ubuntu 24.04,
Python 3.12, Node 22, Docker 29). Where something was verified, it says so.

## The shape

```
Cloudflare Tunnel + Access  ──►  nothing is published on any interface
   admin.facet.example      ──►  127.0.0.1:9000   control plane  [you only]
   facet.facet.example/api/ ──►  127.0.0.1:8000   backend        [everyone]
   facet.facet.example/     ──►  127.0.0.1:3000   frontend       [everyone]
```

**One hostname, one instance, everyone.** Access authenticates at the edge
and sets `Cf-Access-Authenticated-User-Email`; the backend maps that address
to a user and serves that user's directory. Each person has their own
`tracker.db` under `users/<slug>/`, so isolation is a property of the
filesystem rather than of every query remembering a `WHERE` clause.

Per-user subdomains were the earlier design and could not work: Cloudflare's
free Universal SSL covers a single level of subdomain, so on a domain like
`facet.nivil.dpdns.org` a per-user `alice.facet.…` has no certificate at all.

Trusting that header is only sound because both services bind **127.0.0.1**,
so cloudflared on this host is the sole thing that can reach them. The
backend refuses to start multi-user on any other address rather than warning
about it.

The backend is **native** rather than containerised — `PLAN.md` D6: it shells
out to `agy`, whose credentials live in `~/.gemini` for one OS user and
cannot be reached from a container. The cross-process lock in
`services/filelock.py` still serializes every agy run against that single
authenticated CLI.

`/api/*` is routed by the tunnel, not by Next, which bakes rewrite
destinations at *build* time.

## Everything runs as one ordinary user

Not a dedicated `facet` system account, and not root. The account that runs
Facet **must** be the account that ran the agy sign-in, because agy reads
credentials out of that account's home directory. Making them the same
account by construction removes an entire class of "authenticated in my
shell, unauthenticated in the service" failure.

That is also why the units are systemd **user** units rather than system
units: they need no root and no polkit, and they run as whoever installed
them. A control plane that is not root simply cannot drive the system
instance — `systemctl enable` fails with *Interactive authentication
required*, which is exactly what happened here before the switch.

The one cost is lingering (step 4). Without it, every instance stops when you
close your SSH session.

## 1. Base

```bash
sudo apt update
sudo apt install -y git python3-venv docker.io docker-compose-v2 \
     libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
     shared-mime-info

# Node 22.6+ — Ubuntu 24.04 ships 18, which Next 16 will not build on.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo usermod -aG docker "$USER"   # log out and back in for this to take effect
```

The Pango/Cairo libraries are WeasyPrint's. Without them Facet still runs and
only PDF/DOCX export fails, with `/status` reporting exactly that — but you
want them.

Oracle images ship with little or no swap, and ten node processes will find
that out:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Facet

```bash
git clone <your-repo> ~/Facet
cd ~/Facet
./start.sh --setup          # creates the venv, installs deps, initializes the DB
```

`./start.sh` with no arguments runs the single-user app on :3000/:8000 —
useful to confirm the checkout works before adding the multi-user layer.
Both processes bind **127.0.0.1** by default; on a public-IP VM that matters,
and `FACET_BIND=0.0.0.0` exists if you ever genuinely want otherwise.

## 3. agy — the step that decides whether any of this works

```bash
agy login          # as the SAME account that will run Facet
agy --version
```

**Check the terms first.** Ten people's tailoring runs through one signed-in
account. That is the only item that can invalidate this whole plan, and no
amount of engineering fixes it.

## 4. Install the units

```bash
cd ~/Facet
FACET_HOST_ROOT=$HOME/facet-hosts \
FACET_BASE_DOMAIN=facet.example \
  ./deploy/install.sh
```

The installer renders `deploy/user/*.service` with your real paths, reloads
the user daemon, and then checks two things that fail silently otherwise:

- **agy on the units' PATH.** systemd gives a service a minimal PATH that
  does not include `~/.local/bin`, where agy installs. Without the
  `Environment=PATH=` line in the unit, every instance starts, looks healthy,
  serves every page — and reports "agy CLI not found" the first time anyone
  tries to tailor. Observed exactly that.
- **Lingering.** If it is off the installer tells you to run, once:

  ```bash
  sudo loginctl enable-linger $USER
  ```

Then start the control plane:

```bash
systemctl --user enable --now facet-control
systemctl --user status facet-control
```

Per-user backends are started by the portal when you add a user. You never
enable `facet-api@` by hand.

## 5. Build the frontend image, once

```bash
cd ~/Facet
docker build -f frontend/Dockerfile -t facet-frontend:local .
```

Verified on arm64: `node:24-alpine` has an aarch64 variant, the build takes
about three minutes on the free-tier VM, and the result is ~308 MB. The
backend deliberately uses Debian rather than Alpine — musl plus Pango/Cairo
is a fight not worth having for WeasyPrint.

> **Docker group ≈ root.** Your account is in the `docker` group so the
> control plane can manage frontend containers. Acceptable on a single-admin
> box that is Access-gated and audit-logged; not something to widen casually.

## 6. Cloudflare

```bash
cloudflared tunnel login
cloudflared tunnel create facet
sudo cloudflared service install
```

DNS: one wildcard `CNAME *.facet.example → <tunnel-id>.cfargotunnel.com`,
proxied, covers every user at once.

The ingress file is **generated** by the control plane from the user table
and rebuilt whenever a user changes. Do not hand-edit it: an incremental
scheme drifts the moment one edit half-fails, and drift means a hostname
pointing at the wrong port — one person's Facet served to another.

Point `FACET_TUNNEL_CONFIG` at wherever cloudflared reads its config, and
give your account write access to that file plus the right to reload
cloudflared. Grant those two narrowly rather than running anything as root.

Access: one application per hostname, one policy allowing exactly one email
address. The portal prints the exact steps per user. Automate later by
setting `CF_API_TOKEN` and `CF_ACCOUNT_ID` (`PLAN.md` D8 keeps this opt-in —
a token with Access-write is a real capability).

Gate `admin.facet.example` to your address only.

## 7. Add users

```
https://admin.facet.example
```

Email in, and the rest follows: their directories, their database, the
tunnel ingress (unchanged — it does not name users), the Access policy, and a
health check. No port, no env file, no systemd unit, no container: one
instance serves everybody, so adding a person does not start anything.

Their database is created on their first request, so a user added while the
service is running needs no restart. Steps that need a tool the host lacks
report `manual` with the exact command rather than failing.

Before the tunnel exists you can reach the portal over SSH:

```bash
ssh -L 9000:127.0.0.1:9000 <vm>
```

## 8. Backups

```bash
# Never `cp` a live database — WAL keeps recent writes in a sidecar and a
# plain copy silently loses them. Measured: a cp showed 906 rows against a
# live 1,166.
for db in ~/facet-hosts/users/*/data/tracker.db; do
  sqlite3 "$db" "VACUUM INTO '$HOME/facet-hosts/backups/$(basename $(dirname $(dirname $db)))-$(date +%F).db'"
done
```

`control/backup.py` does this properly — bundle, manifest, row counts and a
`verify` that reports corruption instead of raising on it. Back up
`~/facet-hosts/users/*/workspace/` too: that is the Stone, and it is not in
the database.

**Do a restore drill.** `backend/.venv/bin/python -m control.backup` runs one
against a throwaway host root: backs up, destroys, restores, verifies. An
untested backup is not a backup.

## Operational notes

- **Throughput.** One agy binary at a 300s worst case is roughly 12 cuts an
  hour. Measured here: a real tailoring run is ~25 s, and two instances
  submitting simultaneously serialized cleanly (25 s and 49.8 s). Fine for
  ten people cutting a few resumes a week. Show queue position or the wait
  reads as a bug.
- **The agy lock must be shared.** Every user's `.env` gets
  `FACET_AGY_LOCK=<host-root>/agy.lock`. If that is ever unset, each instance
  falls back to a lock inside its *own* data directory and serializes
  nobody — ten instances would call one CLI at once. `control.provision`'s
  self-check asserts this, because nothing else notices until two real users
  collide.
- **Cloudflare free tier cuts a request at 100 seconds** — time to first
  byte. This is why tailoring is queued and polled rather than awaited. Do
  not "simplify" it back into a blocking request.
- **Oracle reclaims idle Always Free instances.** Ten users plus a 6-hour
  scheduler stays above the threshold, but know the policy exists.
- You are now a data controller for other people's resumes. Deletion must
  actually delete (it does, after a 30-day grace period), and `RULES.md`'s
  truthfulness contract is a promise you are making to strangers.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Interactive authentication required` | Units installed as system units, or `FACET_SYSTEMD_SCOPE=system` without root. Use user units. |
| Instance healthy, tailoring says agy missing | `Environment=PATH=` missing from the unit; agy is in `~/.local/bin`. Re-run `deploy/install.sh`. |
| Everything stops when you log out | Lingering off: `sudo loginctl enable-linger $USER`. |
| Provisioning fails at `health_check` | The backend genuinely did not bind. `journalctl --user -u facet-api@<slug> -n 50`. |
| `docker: unknown command: compose` | `docker.io` alone lacks the v2 plugin. `sudo apt install docker-compose-v2`. |
| Frontend build dies on syntax | Node < 22.6. Check `node --version`. |
