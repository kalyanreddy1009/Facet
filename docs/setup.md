# Configuring Facet on your own domain

End-to-end, from a bare Oracle VM to ten people using Facet at
`facet.yourdomain.com` — one address, one instance, each person seeing only
their own data. Follow it in order; each part depends on the one before.

`deploy/README.md` is the reference — why the architecture is shaped this
way. **This** is the walkthrough. Where they overlap, this file is the one to
follow.

Everything here was run on the target hardware: Oracle Ampere A1 (aarch64),
Ubuntu 24.04, Python 3.12, Node 22.23, Docker 29.1.

---

## Part 0 — What you need before you start

Gather these first. Everything else is derived.

| Value | Example | Where it comes from |
|---|---|---|
| **Your domain** | `nivil.dpdns.org` | You already own it |
| **Cloudflare account** | free tier | Domain's nameservers must point at Cloudflare |
| **Tunnel ID** | `6ff42ae2-765a-…` | Created in Part 5, a UUID |
| **The Facet hostname** | `facet.nivil.dpdns.org` | One name everyone shares |
| **Your admin email** | `you@gmail.com` | Gates the admin portal |
| **Each user's email** | `alice@gmail.com` | The only per-user input |
| **VM** | 2 vCPU / 12 GB / 200 GB | Oracle Always Free ARM |
| **agy account** | signed in | See Part 3 — **and read the warning there** |

Three things are **optional**:

| Value | What it buys | Default if unset |
|---|---|---|
| `CF_API_TOKEN` + `CF_ACCOUNT_ID` | Access policies created automatically | The portal prints the exact clicks |
| `JOOBLE_KEY` | Postings from LinkedIn / Indeed / Naukri | Keyless sources still work |
| `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | More job listings | Keyless sources still work |

Job-source keys are **per user**, entered in each person's own Settings page.
They are not host configuration and do not belong in any file here.

Total cost: **$0**. Cloudflare Zero Trust's free tier covers 50 users; you
need ten.

---

## Part 1 — The VM

SSH in as an ordinary user. Not root.

```bash
sudo apt update
sudo apt install -y git python3-venv docker.io docker-compose-v2 sqlite3 \
     libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 \
     shared-mime-info

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo usermod -aG docker "$USER"
```

Then **log out and back in** — the docker group only applies to new sessions.

Three of those are easy to skip and each fails in its own way:

- **`docker-compose-v2`** — `docker.io` alone has no `compose` subcommand.
  Without it every frontend step reports `manual`.
- **Node 22** — Ubuntu 24.04 ships Node 18. Next 16 will not build on it.
- **The Pango/Cairo libraries** — WeasyPrint's. Without them Facet runs
  normally and only PDF/DOCX export fails, with `/status` saying so.

Oracle images ship with little or no swap, and ten Node processes will find
that out:

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## Part 2 — Facet itself

```bash
git clone git@github.com:<you>/Facet.git ~/Facet
cd ~/Facet
./start.sh --setup
```

That creates the venv, installs Python and Node dependencies, and
initializes the database. Confirm the single-user app works before adding
anything on top:

```bash
./start.sh
```

Then from your laptop:

```bash
ssh -L 3000:127.0.0.1:3000 <vm>
```

and open `http://localhost:3000`. Stop it with Ctrl+C when satisfied.

Both processes bind **127.0.0.1**, not `0.0.0.0`. On a VM with a public IP
that is the difference between "my app" and "everyone's app" — the
authentication is Cloudflare Access, and Access lives on the far side of the
tunnel. `FACET_BIND=0.0.0.0` exists if you ever genuinely want otherwise; you
should have a reason.

---

## Part 3 — agy

The step that decides whether any of this works.

```bash
agy login          # as the SAME account that will run Facet
agy --version
```

> **Check the terms of service first.** Ten people's tailoring runs through
> one signed-in account. This is the only item that can invalidate the whole
> architecture, and no amount of engineering fixes it. Settle it before you
> invite anyone.

**Whoever runs `agy login` must be the account that runs Facet.** agy reads
credentials from that account's home directory. The systemd user units in
Part 4 make this true by construction — they run as whoever installs them —
which is precisely why they are user units and not system units.

---

## Part 4 — Install the units

```bash
cd ~/Facet
FACET_HOST_ROOT=$HOME/facet-hosts \
FACET_BASE_DOMAIN=facet.nivil.dpdns.org \
  ./deploy/install.sh
```

`FACET_HOST_ROOT` is where every user's data lives — instances, exports,
backups, and the shared agy lock. Deliberately outside the repo, so no git
operation can ever touch a user's career record.

The installer renders the unit templates with your real paths, reloads the
user daemon, and checks two things that otherwise fail silently:

**agy on the units' PATH.** systemd gives a service a minimal PATH that
excludes `~/.local/bin`, where agy installs. Without the fix the service
starts, reports healthy, serves every page — and says "agy CLI not found" the
first time someone tries to tailor. The installer checks against the *units'*
PATH, not your shell's, because those are different questions.

**Lingering.** If it reports lingering off, run it once:

```bash
sudo loginctl enable-linger $USER
```

Without this every instance stops the moment you close your SSH session.

Now edit the control plane's environment. Open
`~/.config/systemd/user/facet-control.service` and set:

```ini
Environment=FACET_HOST_ROOT=/home/YOU/facet-hosts
Environment=FACET_BASE_DOMAIN=facet.nivil.dpdns.org
Environment=FACET_MULTIUSER=1
Environment=FACET_BIND_HOST=127.0.0.1
Environment=FACET_TUNNEL_CONFIG=/etc/cloudflared/config.yml
Environment=FACET_TUNNEL_ID=<the UUID from Part 5>
Environment=FACET_SYSTEMD_SCOPE=user
```

You do not have the tunnel ID yet — come back after Part 5. Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now facet-control
systemctl --user status facet-control
```

---

## Part 5 — Cloudflare

### 5a. The tunnel

```bash
cloudflared tunnel login          # opens a browser; pick your domain
cloudflared tunnel create facet
```

The second command prints your **tunnel ID** — a UUID. Save it; it goes into
`FACET_TUNNEL_ID` (Part 4) and into DNS below.

```bash
sudo cloudflared service install
```

### 5b. DNS — one record, total

In the Cloudflare dashboard → **DNS**:

| Type | Name | Target | Proxy |
|---|---|---|---|
| CNAME | `facet` | `<tunnel-id>.cfargotunnel.com` | **Proxied** (orange) |

That is the whole DNS story. Everyone shares one hostname —
`facet.yourdomain.com` — and you never touch DNS again when adding a user.

The proxy must be **on**. Grey-cloud bypasses Access entirely, and Access is
your only authentication.

> **Why not a subdomain each?** Two reasons, one fatal. Cloudflare's free
> Universal SSL covers only **one** level of subdomain, so on a domain like
> `facet.nivil.dpdns.org` a per-user `alice.facet.nivil.dpdns.org` is two
> levels deep and has no certificate — HTTPS fails for every user, and the fix
> is a paid Advanced Certificate. The second reason is simply that ten
> hostnames means ten Access applications to keep in step.

### 5c. The ingress file

`/etc/cloudflared/config.yml` no longer changes when you add a user. One
hostname, two rules:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /etc/cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: facet.yourdomain.com
    path: ^/api/
    service: http://127.0.0.1:8000
  - hostname: facet.yourdomain.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Note `^/api/` comes **first**. Order is significant: cloudflared takes the
first match, so reversing those two lines sends API calls to the frontend.

Both services bind **127.0.0.1**, and that is load-bearing rather than tidy.
Facet identifies people from the `Cf-Access-Authenticated-User-Email` header
that Access sets, which is only trustworthy because cloudflared on this host
is the sole thing that can reach those ports. Bind them anywhere else and
anyone who can reach the port becomes anyone they like by typing a header.
The backend refuses to start multi-user on a non-loopback address for exactly
this reason.

The control plane **writes** that file, so it needs ownership of it:

```bash
sudo touch /etc/cloudflared/config.yml
sudo chown $USER /etc/cloudflared/config.yml
```

It does **not** reload cloudflared for you. The portal prints the command and
you run it — deliberately, since restarting the tunnel drops every user's
live connection, and that should be your decision rather than a side effect
of adding someone:

```bash
sudo systemctl reload cloudflared
```

If you would rather not type a password each time, allow exactly that one
command:

```bash
echo "$USER ALL=(root) NOPASSWD: /bin/systemctl reload cloudflared" \
  | sudo tee /etc/sudoers.d/facet-cloudflared
sudo chmod 440 /etc/sudoers.d/facet-cloudflared
```

### 5d. Access — the actual authentication

Cloudflare dashboard → **Zero Trust** → **Access** → **Applications**.

One self-hosted application, covering everyone:

| Field | Value |
|---|---|
| Application name | `Facet` |
| Session duration | 24 hours (or your preference) |
| Subdomain / domain | `facet` / `yourdomain.com` |
| Policy name | `the ten of us` |
| Action | Allow |
| Include | **Emails** → every user's address, one per line |

Then one more for yourself, for the admin portal:

| Field | Value |
|---|---|
| Application name | `Facet — admin` |
| Subdomain / domain | `admin` / `yourdomain.com` |
| Include | **Emails** → `you@gmail.com` |

**List addresses individually.** A policy that includes a whole domain
(`@gmail.com`) lets every Gmail user in the world past the only
authentication this deployment has.

Access decides *whether* someone gets in. Facet decides *whose data they
see*, by matching the email Access reports against its own user table. Both
have to say yes: an address in the Access policy but not registered in Facet
gets a clean "you have no Facet on this host" rather than somebody else's
tracker.

Adding a user is therefore two steps that must both happen — add them in the
admin portal, and add their address to this one policy.

To automate this instead, set `CF_ACCOUNT_ID` and `CF_API_TOKEN` in the
control plane's unit. The token needs **Access: Apps and Policies — Edit**.
This is opt-in on purpose: a token with Access-write can rewrite who can
reach what.

---

## Part 6 — Build the frontend image, once

```bash
cd ~/Facet
docker build -f frontend/Dockerfile -t facet-frontend:local .
```

About three minutes on the free-tier VM; ~308 MB. One image serves everybody
— no per-user address is baked into it, which is exactly why cloudflared
routes `/api/*` by path rather than letting Next proxy it.

Rebuild after a frontend change, then restart each user's container from the
portal.

---

## Part 7 — Add users

Open the portal. Before the tunnel is confirmed working, reach it over SSH:

```bash
ssh -L 9000:127.0.0.1:9000 <vm>
```

→ `http://localhost:9000`. Once Access is set up,
`https://admin.yourdomain.com`.

Enter an email. That creates the registry row and the person's directories
under `$FACET_HOST_ROOT/users/<slug>/`. Their database is created the first
time they actually load a page — **no restart, no new port, no DNS, no
ingress change.** One instance serves everyone.

Then add the same address to the Access policy from Part 5d. Both steps are
required and they fail in opposite directions, which is deliberate:

| Registered in Facet | In the Access policy | What happens |
|---|---|---|
| yes | yes | They use Facet |
| yes | no | Stopped at Access — they never reach Facet |
| no | yes | Reach Facet, told they have no account here |
| no | no | Stopped at Access |

There is no combination that shows one person another's data. The failure
modes are all "locked out", never "let in as somebody else".

Then send each person the same URL — `https://facet.yourdomain.com`. They
sign in with the email you allowed, import a resume, and start.

### Migrating your own existing data

If you have been using Facet single-user, your record is in the repo's
`data/` and `workspace/`. Move it into your own account:

```bash
cd ~/Facet/backend
./.venv/bin/python scripts/migrate_to_multiuser.py --owner you@gmail.com
./.venv/bin/python scripts/migrate_to_multiuser.py --owner you@gmail.com --apply
```

The first run is a dry run. The second copies — and it **copies**, leaving
the originals exactly where they are. The database goes through SQLite's
`VACUUM INTO` rather than `cp`, because a live WAL database keeps recent
commits in a sidecar file and a plain file copy silently loses them. Row
counts are compared before and after, and a mismatch aborts.

Delete the originals yourself, once you have signed in and confirmed the
record looks right.

---

## Part 8 — Backups and retention

Retention runs on its own. The defaults:

| Setting | Default | Meaning |
|---|---|---|
| `FACET_EXPORT_TTL_DAYS` | 30 | Unreferenced exports swept after this |
| `FACET_JOB_TTL_DAYS` | 90 | Finished job rows dropped after this |
| `FACET_QUOTA_MB` | 2048 | Per-user soft quota |

Exports still referenced by a tracker row are **never** swept, whatever their
age. The quota **warns and never deletes** — silently removing someone's
resumes to save disk is not a trade this makes.

Backups are nightly, via `VACUUM INTO` rather than `cp`. That distinction is
not pedantry: SQLite's WAL keeps recent writes in a sidecar file, and a plain
copy loses them. Measured on this project — a `cp` produced 906 rows against
a live 1,166.

**Run the restore drill before you rely on any of it:**

```bash
cd ~/Facet/backend
./.venv/bin/python -m control.backup
```

That creates an account, fills it, backs it up, **destroys it**, restores it,
and verifies the rows came back — against a throwaway directory, never your
real data. An untested backup is not a backup.

Pull bundles off the VM regularly. A backup that only exists on the machine
it protects is not a backup either:

```bash
rsync -avz <vm>:~/facet-hosts/backups/ ~/facet-backups/
```

---

## Part 9 — Verify

Work down this list. Each line has failed for real at some point.

```bash
# 1. Units are up
systemctl --user list-units 'facet-*'

# 2. Nothing is published on a public interface — all 127.0.0.1
ss -tln | grep -E ':(3000|8000|9000|31[0-9][0-9]|81[0-9][0-9])'

# 3. agy is visible to the SERVICE, not just your shell
curl -s http://127.0.0.1:8101/api/agy/health

# 4. Every instance shares ONE lock — this must print exactly one line
grep -h FACET_AGY_LOCK ~/facet-hosts/users/*/.env | sort -u

# 5. Ingress routes /api before the catch-all
grep -A2 'path:' /etc/cloudflared/config.yml

# 6. The whole test suite
cd ~/Facet/backend
for m in services.filelock services.jobs services.retention \
         control.provision control.runtime control.backup; do
  ./.venv/bin/python -m $m
done
```

**Check 4 is the one people skip.** If it prints more than one line, each
instance has its own private lock and serializes nobody — ten users would run
ten concurrent agy processes against one authenticated CLI. Nothing breaks
until two real people tailor at the same moment, and then it breaks quietly.

Then the isolation check — the one that matters most on a shared instance:

```bash
cd backend && ./.venv/bin/python scripts/test_multiuser.py
```

It writes as one user, reads as another, and asserts the second sees nothing
of the first — through the real database, workspace and queue code paths.

Finally, from a browser that is **not** signed in as an allowed email, open
`https://facet.yourdomain.com`. You should be stopped by Access. If you see
Facet, your policy is wrong — fix it before anyone uploads a resume.

---

## Config reference

Host-level, set in `~/.config/systemd/user/facet-control.service`:

| Variable | Default | What it does |
|---|---|---|
| `FACET_HOST_ROOT` | *(required)* | Where all user instances live |
| `FACET_BASE_DOMAIN` | *(required)* | The single hostname everyone shares |
| `FACET_MULTIUSER` | *(off)* | On: identity required, per-user data. Off: original single-user layout |
| `FACET_BIND_HOST` | `127.0.0.1` | Must stay loopback while `FACET_MULTIUSER` is on — the app refuses otherwise |
| `FACET_USERS_ROOT` | `$FACET_HOST_ROOT/users` | Per-user homes; must match the control plane's layout |
| `FACET_TUNNEL_CONFIG` | `/etc/cloudflared/config.yml` | Generated ingress file |
| `FACET_TUNNEL_ID` | *(empty)* | UUID from `cloudflared tunnel create` |
| `FACET_SYSTEMD_SCOPE` | `user` unless root | `user` or `system` |
| `FACET_CONTROL_PORT` | `9000` | Admin portal port |
| `FACET_FRONTEND_IMAGE` | `facet-frontend:local` | Image the portal starts |
| `CF_ACCOUNT_ID` | *(empty)* | Optional Access automation |
| `CF_API_TOKEN` | *(empty)* | Optional; needs Access-write |

Per-instance, **generated** into each user's `.env` — do not hand-edit:

| Variable | What it does |
|---|---|
| `FACET_DATA_DIR` | This user's database, exports, logs |
| `FACET_WORKSPACE_DIR` | This user's Stone — profile and master resume |
| `FACET_AGY_LOCK` | **Shared across all users.** The serialization point |
| `FRONTEND_PORT` / `BACKEND_PORT` | `3100 + id` / `8100 + id` |

Behaviour, optional anywhere:

| Variable | Default | What it does |
|---|---|---|
| `FACET_BIND` | `127.0.0.1` | Loopback. Change only with a reason |
| `FACET_AGY_BIN` | `agy` | Path to the CLI |
| `FACET_AGY_MODEL` | `gemini-3.1-pro-high` | Model for tailoring |
| `FACET_AGY_TIMEOUT` | `300` | Seconds before a run is abandoned |
| `FACET_EXPORT_TTL_DAYS` | `30` | Unreferenced export sweep |
| `FACET_JOB_TTL_DAYS` | `90` | Finished job row sweep |
| `FACET_QUOTA_MB` | `2048` | Per-user soft quota, warns only |

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Interactive authentication required` | System units without root. Use user units; `FACET_SYSTEMD_SCOPE=user`. |
| Instance healthy, tailoring says agy missing | `Environment=PATH=` missing from the unit. Re-run `deploy/install.sh`. |
| Everything stops when you log out | `sudo loginctl enable-linger $USER` |
| Provisioning fails at `health_check` | The backend did not bind. `journalctl --user -u facet-api@<slug> -n 50` |
| `docker: unknown command: compose` | `sudo apt install docker-compose-v2` |
| Frontend build fails on syntax | Node < 22.6. `node --version` |
| Tailoring times out at ~100s | Cloudflare free tier cuts at 100s **time-to-first-byte**. Tailoring is queued and polled for this reason — do not "simplify" it into a blocking request. |
| Two users' runs interfere | Check 4 above. The agy lock is not shared. |
| Access lets the wrong person in | A policy includes a domain rather than one email. |
| Portal reachable from the internet | It binds loopback; if it is reachable, something is publishing it. |

More failure modes, by symptom: `docs/runbook.md`.

---

## What not to do

- **Do not publish any port.** Everything binds `127.0.0.1`; Access is the
  only authentication and it is reached through the tunnel.
- **Do not hand-edit the ingress file.** It is regenerated from the user
  table.
- **Do not `cp` a live database.** Use `VACUUM INTO`, or `control/backup.py`.
- **Do not put one policy on a whole email domain.**
- **Do not skip the restore drill.**
- **Do not add users before settling agy's terms** for one account serving
  ten people.

You are now a data controller for other people's resumes. Deletion must
actually delete — it does, after a 30-day recoverable grace period — and
`RULES.md`'s truthfulness contract is a promise you are making to strangers.
