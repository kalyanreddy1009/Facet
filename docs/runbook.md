# Runbook

What to do when something is wrong. `docs/setup.md` covers configuring the
host from scratch and `deploy/README.md` is its condensed reference; this is
for after it is running.

Quick orientation: the admin portal at `admin.<your-domain>` shows host
capabilities, per-user status, queue metrics, retention and backup age. Most
questions below are answerable there first.

---

## Someone says "my cut is stuck"

1. **Portal → Queue.** Look at wait p50/p95 and what is running.
2. One agy binary means **one cut at a time**, ~12/hour worst case. A queue is
   normal; the UI shows position. A wait is not a fault.
3. If a job has been `running` far longer than 300 s, agy is wedged. Cancel it
   from the portal — that kills the process tree, not just the parent — and
   the next job starts.

```bash
sqlite3 /srv/facet/users/<slug>/data/queue.db \
  "SELECT id,status,error_kind,queued_at,started_at FROM jobs ORDER BY id DESC LIMIT 10;"
```

## Every cut is failing

Check the failure bucket on the portal — the whole point of bucketing is that
each has a different fix.

| Bucket | Means | Do this |
|---|---|---|
| `agy_missing` | not on PATH for the service user | `sudo -u facet which agy`; check `systemctl show -p User facet-api@<slug>` |
| `timeout` | agy wedged or very slow | cancel; check quota; `FACET_AGY_TIMEOUT` |
| `no_output_file` | almost always `--add-dir` | check the job dir exists and is writable |
| `bad_json` | model returned prose | usually transient; retry |
| `interrupted` | restarted mid-run | expected after a deploy |
| `internal` | a bug | `journalctl -u facet-api@<slug>` |

**The most common cause is authentication.** agy reads `~/.gemini` for a
specific OS user, so it can look fine in your shell and be unauthenticated to
the service:

```bash
sudo -u facet agy --version
systemctl show -p User facet-api@<slug>    # must be the same user
```

Then quota — ten people share one account, which is the known ceiling of this
whole design.

## A user cannot reach their instance

Work outward:

```bash
curl -s localhost:<api_port>/api/health      # backend up?
curl -sI localhost:<web_port>/               # frontend up?
systemctl status facet-api@<slug>
docker compose -p facet-<slug> ps
grep -A3 "<slug>" /etc/cloudflared/config.yml
systemctl status cloudflared
```

If the tunnel config looks wrong, **do not edit it**. It is generated from the
user table; hand edits are overwritten and drift is how a hostname ends up
pointing at someone else's port. Force a rebuild by re-provisioning that user
in the portal.

If they get a Cloudflare login loop, the Access policy names a different
address than they are signing in with.

## Disk filling up

Portal → Storage and Retention. Retention only removes exports **not**
attached to an application; anything attached is part of the record and is
never swept, at any age. Nothing is ever deleted because a disk is filling —
if you are out of space, act deliberately:

```bash
du -sh /srv/facet/users/*/          # who
du -sh /srv/facet/backups/          # bundles
```

Then prune backups (keeps the newest per user regardless), or lower
`FACET_EXPORT_TTL_DAYS` and let the daily sweep catch up.

## Restoring a user

The drill runs as a self-check, so this path is exercised, not theoretical:

```bash
cd /opt/facet/backend && .venv/bin/python -m control.backup    # proves it works
```

To restore for real:

```bash
sudo systemctl stop facet-api@<slug>          # restore refuses while it serves
docker compose -p facet-<slug> stop

.venv/bin/python -c "
from control import backup, store
b = sorted((store.HOST_ROOT/'backups').glob('<slug>-*.tar.gz'))[-1]
print(backup.verify(b))                        # check before trusting
print(backup.restore(b, force=True))           # current contents moved aside
"

sudo systemctl start facet-api@<slug>
docker compose -p facet-<slug> start
```

`force=True` moves the existing directory to `<slug>-replaced-<timestamp>`
rather than deleting it, so restoring the wrong bundle is itself undoable.

## Deleted the wrong user

Recoverable for 30 days. Portal → **Restore**. The export bundle written
before deletion is in `/srv/facet/exports/` regardless.

After the grace period `purge_expired` removes it permanently — then it is
backups only.

## Deploying an update

```bash
cd /opt/facet && sudo -u facet git pull
sudo -u facet .venv/bin/pip install -r backend/requirements.txt
sudo -u facet docker build -f frontend/Dockerfile -t facet-frontend:local .

sudo systemctl restart facet-control
for slug in $(ls /srv/facet/users); do sudo systemctl restart facet-api@$slug; done
```

A restart mid-cut abandons that agy run. Startup reconciliation turns it into
a failed job with a real message rather than a spinner that never resolves,
but check the queue is idle first if you can.

## Health checks worth having

```bash
curl -s localhost:9000/api/health | jq .capabilities
curl -s -XPOST localhost:9000/api/backups/verify | jq .all_ok
```

If `all_ok` is ever false, fix it that day. The whole point of verifying is
to learn it before the day you need a restore.

## Things that are working as designed

- **A queue with people waiting.** One agy, one cut at a time.
- **Cancel refusing on a job in another process.** It cannot signal a
  subprocess it does not own; it says so rather than marking a row for work
  that carries on.
- **Steps reported `manual`.** The host lacks that tool; the exact command is
  shown. Not a failure.
- **Delete refusing while an instance serves.** Moving data from under a live
  process does not stop it — it recreates the directory. Stop it first.
- **`workspace/` never being swept.** That is the Stone. Nothing automatic
  touches it, ever.
