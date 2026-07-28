# Host setup

Bringing up a multi-user Facet on one Linux VM. See `PLAN.md` for why the
architecture is shaped this way; this is the operational sequence.

Target: Oracle Always Free ARM (2 vCPU / 12 GB / 200 GB), Ubuntu, behind
Cloudflare Tunnel + Access on your own domain. Cost: $0.

## The shape

```
Cloudflare Tunnel + Access  ──►  nothing is published on any interface
   admin.facet.example      ──►  127.0.0.1:9000   control plane   [you only]
   alice.facet.example/api/ ──►  127.0.0.1:8101   native backend  [alice only]
   alice.facet.example/     ──►  127.0.0.1:3101   frontend container
```

The backend is **native**, the frontend is **containerised**. That split is
`PLAN.md` D6: the backend shells out to `agy`, whose credentials live in
`~/.gemini` for one OS user and cannot be reached from a container. The
cross-process lock in `services/filelock.py` is what keeps every instance
serialized against the single authenticated CLI.

`/api/*` is routed by the tunnel, not by Next. Next bakes rewrite
destinations at *build* time, so a Next-side proxy would mean one image build
per user. Letting cloudflared match on path means no per-user address is baked
in anywhere and one image serves everybody.

## 1. Base

```bash
sudo adduser --system --group facet
sudo apt update && sudo apt install -y python3.12-venv git docker.io docker-compose-v2
sudo usermod -aG docker facet

# Oracle images ship with little or no swap, and ten node processes will
# find that out.
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Facet

```bash
sudo git clone <your-repo> /opt/facet
sudo chown -R facet:facet /opt/facet
sudo -u facet python3 -m venv /opt/facet/backend/.venv
sudo -u facet /opt/facet/backend/.venv/bin/pip install -r /opt/facet/backend/requirements.txt
sudo -u facet mkdir -p /srv/facet && sudo chown facet:facet /srv/facet
```

## 3. agy — the step that decides whether any of this works

```bash
sudo -u facet -i     # MUST be this user; agy reads ~/.gemini
agy login
agy --version        # confirm before going further
```

**Check the terms first.** Ten people's tailoring runs through one signed-in
account. That is the only item that can invalidate this whole plan, and no
amount of engineering fixes it.

Verify systemd sees the same user: `systemctl show -p User facet-api@alice`.
A mismatch looks authenticated in your shell and unauthenticated to the
service.

## 4. Build the frontend image, once

```bash
cd /opt/facet
sudo -u facet docker build -f frontend/Dockerfile -t facet-frontend:local .
```

arm64 note: `node:24-alpine` and `python:3.11-slim` both have arm64 variants.
The backend deliberately uses Debian, not Alpine — musl plus Pango/Cairo is a
fight not worth having for WeasyPrint.

## 5. systemd

```bash
sudo cp /opt/facet/deploy/facet-api@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

Then the control plane itself (bound to loopback, reached only via the
tunnel):

```ini
# /etc/systemd/system/facet-control.service
[Unit]
Description=Facet control plane
After=network-online.target

[Service]
Type=exec
User=facet
WorkingDirectory=/opt/facet/backend
Environment=FACET_HOST_ROOT=/srv/facet
Environment=FACET_BASE_DOMAIN=facet.example
Environment=FACET_TUNNEL_CONFIG=/etc/cloudflared/config.yml
Environment=FACET_TUNNEL_ID=<your-tunnel-id>
ExecStart=/opt/facet/backend/.venv/bin/python -m control.app
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

The control plane needs write access to `/etc/cloudflared/config.yml` and the
right to `systemctl reload cloudflared`. Grant those two narrowly rather than
running it as root.

> **Docker group ≈ root.** `facet` is in the `docker` group so the control
> plane can manage frontend containers. Acceptable on a single-admin box that
> is Access-gated and audit-logged; not something to widen casually.

## 6. Cloudflare

```bash
cloudflared tunnel login
cloudflared tunnel create facet
sudo cloudflared service install
```

DNS: one wildcard `CNAME *.facet.example → <tunnel-id>.cfargotunnel.com`,
proxied, covers every user at once.

`/etc/cloudflared/config.yml` is **generated** by the control plane from the
user table and rebuilt whenever a user changes. Do not hand-edit it: an
incremental scheme drifts the moment one edit half-fails, and drift means a
hostname pointing at the wrong port — one person's Facet served to another.

Access: one application per hostname, one policy allowing exactly one email
address. The portal prints the exact steps per user. Automate later by setting
`CF_API_TOKEN` and `CF_ACCOUNT_ID` (`PLAN.md` D8 keeps this opt-in — a token
with Access-write is a real capability).

Gate `admin.facet.example` to your address only.

## 7. Add users

```
https://admin.facet.example
```

Email in, everything else derived. Steps that need a tool the host lacks
report `manual` with the exact command rather than failing.

## 8. Backups

```bash
# Never `cp` a live database — WAL keeps recent writes in a sidecar and a
# plain copy silently loses them. Measured: a cp showed 906 rows against a
# live 1,166.
for db in /srv/facet/users/*/data/tracker.db; do
  sqlite3 "$db" "VACUUM INTO '/srv/facet/backups/$(basename $(dirname $(dirname $db)))-$(date +%F).db'"
done
```

Back up `/srv/facet/users/*/workspace/` too — that is the Stone, and it is
not in the database. **Do a restore drill.** An untested backup is not a
backup.

## Operational notes

- **Throughput.** One agy binary at a 300s worst case is roughly 12 cuts an
  hour. Fine for ten people cutting a few resumes a week. Show queue position
  or the wait reads as a bug.
- **Cloudflare free tier cuts a request at 100 seconds.** This is why
  tailoring is queued and polled rather than awaited. Do not "simplify" it
  back into a blocking request.
- **Oracle reclaims idle Always Free instances.** Ten users plus a 6-hour
  scheduler stays above the threshold, but know the policy exists.
- You are now a data controller for other people's resumes. Deletion must
  actually delete (it does, after a 30-day grace period), and `RULES.md`'s
  truthfulness contract is a promise you are making to strangers.
