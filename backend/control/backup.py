"""Backups, and the restore that proves them.

An untested backup is not a backup, so the drill is part of this module
rather than a paragraph in a runbook: `python -m control.backup` creates an
account, fills it, backs it up, destroys it, restores it, and checks the rows
came back. If that stops passing, backups are broken — and you find out on a
laptop instead of on the day you need them.

Two rules the whole design turns on.

**Never `cp` a live SQLite database.** WAL keeps recent writes in a `-wal`
sidecar, so copying the `.db` alone silently loses them. Measured on this
project once: a plain copy showed 906 rows against a live 1,166. Every
database here is copied with `VACUUM INTO`, which produces a consistent
single-file snapshot with no separate WAL to forget.

**Back up `workspace/` too.** The Stone — `profile.json` and
`master_resume.md` — is not in any database. A backup that only takes
`tracker.db` restores an account that has lost the thing every resume is cut
from.
"""

import json
import logging
import shutil
import sqlite3
import tarfile
import time
from pathlib import Path

from . import store

logger = logging.getLogger("facet.backup")

BACKUPS_DIR = store.HOST_ROOT / "backups"

# Kept by default. Long enough to notice a problem that started a while ago.
KEEP_DAYS = 30

# Tables whose row counts go in the manifest, so a restore can be verified
# rather than merely performed.
COUNTED = ("applications", "contacts", "interviews", "seen_postings")


class BackupError(Exception):
    pass


def _snapshot_db(source: Path, target: Path) -> None:
    """A consistent copy of a live SQLite database.

    VACUUM INTO rather than a file copy: see the module docstring. It also
    compacts, so snapshots are smaller than the original.
    """
    target.unlink(missing_ok=True)
    conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=30)
    try:
        conn.execute("VACUUM INTO ?", (str(target),))
    finally:
        conn.close()


def _row_counts(db_path: Path) -> dict[str, int]:
    if not db_path.exists():
        return {}
    counts = {}
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
    try:
        for table in COUNTED:
            try:
                counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.Error:
                pass  # a table this instance doesn't have yet
    finally:
        conn.close()
    return counts


def backup_user(slug: str, dest: Path | None = None) -> Path:
    """One user, one tarball, plus a manifest describing what is inside."""
    paths = store.user_paths(slug)
    if not paths["home"].exists():
        raise BackupError(f"no instance at {paths['home']}")

    root = dest or BACKUPS_DIR
    root.mkdir(parents=True, exist_ok=True)

    # The stamp is only second-granular, so two backups of one user inside
    # the same second would otherwise land on the same filename and the
    # second would silently replace the first. That is a backup destroying a
    # backup, which is the one thing this module must never do. A suffix is
    # cheaper than the alternative: an admin taking a manual snapshot just
    # before a risky change, in the same second as the nightly timer, and
    # ending up with one bundle where they believed they had two.
    stamp = time.strftime("%Y%m%d-%H%M%S")
    if (root / f"{slug}-{stamp}.tar.gz").exists():
        for suffix in range(2, 100):
            if not (root / f"{slug}-{stamp}-{suffix}.tar.gz").exists():
                stamp = f"{stamp}-{suffix}"
                break
        else:
            raise BackupError(f"too many backups of {slug} in one second")

    staging = root / f".{slug}-{stamp}.staging"
    staging.mkdir(parents=True, exist_ok=True)

    try:
        manifest = {
            "slug": slug,
            "created_at": time.time(),
            "created_at_iso": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "rows": {},
            "files": [],
        }

        for name in ("tracker.db", "queue.db"):
            source = paths["data"] / name
            if not source.exists():
                continue
            _snapshot_db(source, staging / name)
            if name == "tracker.db":
                manifest["rows"] = _row_counts(staging / name)
            manifest["files"].append(f"data/{name}")

        # Plain files: settings (this user's own API keys), feeds, exports.
        for name in ("settings.json", "feeds.json", "calendar_config.json"):
            source = paths["data"] / name
            if source.exists():
                shutil.copy2(source, staging / name)
                manifest["files"].append(f"data/{name}")

        if paths["exports"].exists():
            shutil.copytree(paths["exports"], staging / "exports", dirs_exist_ok=True)
            manifest["files"].append("data/exports/")

        # The Stone. Not in any database, and the thing every resume is cut
        # from — a backup without it restores an account that has lost its
        # source of truth.
        if paths["workspace"].exists():
            shutil.copytree(paths["workspace"], staging / "workspace", dirs_exist_ok=True)
            manifest["files"].append("workspace/")

        (staging / "manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )

        bundle = root / f"{slug}-{stamp}.tar.gz"
        with tarfile.open(bundle, "w:gz") as tar:
            tar.add(staging, arcname=slug)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    logger.info("[Facet] backed up %s -> %s (%s bytes)", slug, bundle.name,
                bundle.stat().st_size)
    return bundle


def backup_all(dest: Path | None = None) -> dict:
    """Every active account. One failure does not stop the others."""
    results = {"ok": [], "failed": {}}
    for user in store.list_users():
        try:
            bundle = backup_user(user["slug"], dest)
            results["ok"].append(bundle.name)
        except Exception as exc:  # noqa: BLE001 — one bad account must not
            results["failed"][user["slug"]] = str(exc)  # stop the rest
            logger.exception("[Facet] backup failed for %s", user["slug"])
    return results


def read_manifest(bundle: Path) -> dict:
    with tarfile.open(bundle, "r:gz") as tar:
        for member in tar.getmembers():
            if member.name.endswith("manifest.json"):
                extracted = tar.extractfile(member)
                if extracted is None:
                    break
                return json.loads(extracted.read())
    raise BackupError(f"{bundle.name} has no manifest")


def verify(bundle: Path) -> dict:
    """Check a bundle is actually restorable, without restoring it.

    Reads the manifest, unpacks the databases to a temporary place, runs
    SQLite's own integrity check, and confirms the row counts still match
    what was recorded. A backup that cannot answer these is not a backup.
    """
    import tempfile

    manifest = read_manifest(bundle)
    report = {"bundle": bundle.name, "slug": manifest["slug"], "ok": True,
              "rows": manifest.get("rows", {}), "problems": []}

    scratch = Path(tempfile.mkdtemp())
    try:
        with tarfile.open(bundle, "r:gz") as tar:
            tar.extractall(scratch)
        root = scratch / manifest["slug"]

        tracker = root / "tracker.db"
        if not tracker.exists():
            report["ok"] = False
            report["problems"].append("tracker.db missing from the bundle")
            return report

        # A database damaged badly enough that SQLite will not even open it
        # raises here rather than returning a verdict. That is still an
        # answer, and it is this function's answer to give: verify() reports,
        # it does not propagate. Letting the exception out turned the one
        # call that exists to detect corruption into a crash whenever it
        # found some.
        try:
            conn = sqlite3.connect(tracker)
            try:
                result = conn.execute("PRAGMA integrity_check").fetchone()[0]
                if result != "ok":
                    report["ok"] = False
                    report["problems"].append(f"integrity check: {result}")
            finally:
                conn.close()

            actual = _row_counts(tracker)
        except sqlite3.Error as exc:
            report["ok"] = False
            report["problems"].append(f"tracker.db is unreadable: {exc}")
            return report

        for table, expected in manifest.get("rows", {}).items():
            if actual.get(table) != expected:
                report["ok"] = False
                report["problems"].append(
                    f"{table}: manifest says {expected}, bundle has {actual.get(table)}"
                )

        if "workspace/" in manifest.get("files", []) and not (root / "workspace").exists():
            report["ok"] = False
            report["problems"].append("workspace listed in the manifest but absent")
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    return report


def restore(bundle: Path, slug: str | None = None, force: bool = False) -> dict:
    """Put a bundle back.

    Refuses to overwrite an existing instance unless forced, and refuses
    outright while that instance is serving — restoring underneath a live
    process is the same mistake as deleting underneath one, and ends the same
    way, with the process recreating what you just replaced.

    The existing directory is moved aside rather than deleted, so a restore
    that turns out to be the wrong bundle is itself undoable.
    """
    manifest = read_manifest(bundle)
    target_slug = slug or manifest["slug"]
    paths = store.user_paths(target_slug)

    user = next((u for u in store.list_users(include_deleted=True)
                 if u["slug"] == target_slug), None)
    if user is not None:
        from . import provision

        # Restoring used to require stopping this user's backend. With one
        # shared instance that would mean taking Facet down for everybody to
        # restore one person's backup, which is not a trade worth making.
        #
        # Instead: refuse while they are still being served, and otherwise
        # close their database handle so nothing writes into the directory
        # about to be replaced. An open SQLite connection follows the inode,
        # so a restore under a live handle leaves the old data being written
        # to a file no longer reachable by name.
        if user["status"] == store.ACTIVE:
            raise BackupError(
                f"{target_slug} is still active — suspend the account first. "
                f"Restoring under a live account would race their own writes."
            )
        provision.quiesce(user)

    if paths["home"].exists():
        if not force:
            raise BackupError(
                f"{paths['home']} already exists; pass force to replace it "
                f"(the current contents are moved aside, not deleted)"
            )
        aside = paths["home"].with_name(
            f"{target_slug}-replaced-{time.strftime('%Y%m%d-%H%M%S')}"
        )
        shutil.move(str(paths["home"]), str(aside))

    import tempfile

    scratch = Path(tempfile.mkdtemp())
    try:
        with tarfile.open(bundle, "r:gz") as tar:
            tar.extractall(scratch)
        source = scratch / manifest["slug"]

        paths["data"].mkdir(parents=True, exist_ok=True)
        for name in ("tracker.db", "queue.db", "settings.json", "feeds.json",
                     "calendar_config.json"):
            if (source / name).exists():
                shutil.copy2(source / name, paths["data"] / name)

        if (source / "exports").exists():
            shutil.copytree(source / "exports", paths["exports"], dirs_exist_ok=True)
        if (source / "workspace").exists():
            shutil.copytree(source / "workspace", paths["workspace"], dirs_exist_ok=True)
        (paths["data"] / "logs").mkdir(parents=True, exist_ok=True)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

    restored = _row_counts(paths["data"] / "tracker.db")
    logger.info("[Facet] restored %s from %s", target_slug, bundle.name)
    return {"slug": target_slug, "rows": restored,
            "matches_manifest": restored == manifest.get("rows", {})}


def prune(dest: Path | None = None, keep_days: int = KEEP_DAYS,
          dry_run: bool = True) -> dict:
    """Drop bundles past the retention window, always keeping the newest one
    per user — a pruning rule that can leave an account with no backup at all
    is worse than keeping too much."""
    root = dest or BACKUPS_DIR
    result = {"removed": [], "kept_newest": [], "dry_run": dry_run}
    if not root.exists():
        return result

    by_slug: dict[str, list[Path]] = {}
    for bundle in root.glob("*.tar.gz"):
        by_slug.setdefault(bundle.name.rsplit("-", 2)[0], []).append(bundle)

    cutoff = time.time() - keep_days * 86400
    for slug, bundles in by_slug.items():
        newest = max(bundles, key=lambda p: p.stat().st_mtime)
        result["kept_newest"].append(newest.name)
        for bundle in bundles:
            if bundle == newest or bundle.stat().st_mtime >= cutoff:
                continue
            result["removed"].append(bundle.name)
            if not dry_run:
                bundle.unlink(missing_ok=True)
    return result


def status(dest: Path | None = None) -> dict:
    """Newest backup per user and how old it is — for the dashboard.

    A backup system nobody looks at is a backup system that stopped working
    three weeks ago.
    """
    root = dest or BACKUPS_DIR
    rows = []
    for user in store.list_users():
        bundles = sorted(root.glob(f"{user['slug']}-*.tar.gz")) if root.exists() else []
        newest = max(bundles, key=lambda p: p.stat().st_mtime) if bundles else None
        rows.append({
            "slug": user["slug"],
            "latest": newest.name if newest else None,
            "age_hours": round((time.time() - newest.stat().st_mtime) / 3600, 1)
            if newest else None,
            "bytes": newest.stat().st_size if newest else 0,
            "count": len(bundles),
        })
    return {"users": rows, "dir": str(root), "keep_days": KEEP_DAYS}


def demo() -> None:
    """The restore drill:  backend/.venv/bin/python -m control.backup

    Not a unit test of the helpers — an actual round trip. Creates an
    account, fills it with data, backs it up, destroys the data, restores it,
    and checks what came back. This is the thing that makes the backups
    trustworthy, so it runs like any other self-check.
    """
    import tempfile

    from . import provision

    root = Path(tempfile.mkdtemp()) / "host"
    store.HOST_ROOT = root
    store.CONTROL_DB = root / "control.db"
    store.USERS_DIR = root / "users"
    store.EXPORTS_DIR = root / "exports"
    store.DELETED_DIR = root / "deleted"
    store._connection = None
    store.init_control_db()

    from . import cloudflare
    cloudflare.TUNNEL_CONFIG = root / "cloudflared.yml"

    # Same reason as control.provision.demo: the drill provisions a fictional
    # user, and on a host with real systemd that would enable real units.
    from . import runtime
    real_capabilities = runtime.capabilities
    runtime.capabilities = lambda: {k: False for k in real_capabilities()}

    backups = root / "backups"

    user = provision.create_user("drill@example.com", "Drill", "test")
    paths = store.user_paths(user["slug"])

    # Fill the instance with the things a real one holds.
    conn = sqlite3.connect(paths["tracker_db"])
    conn.executemany(
        "INSERT INTO applications (company, role_title, resume_path) VALUES (?, ?, ?)",
        [("Stripe", "Engineer", "stripe.pdf"), ("Linear", "Engineer", "linear.pdf")],
    )
    conn.execute("INSERT INTO seen_postings (posting_hash, company, title) "
                 "VALUES ('h1', 'Acme', 'Dev')")
    conn.commit()
    conn.close()

    paths["exports"].mkdir(parents=True, exist_ok=True)
    (paths["exports"] / "stripe.pdf").write_bytes(b"%PDF resume")
    (paths["workspace"] / "profile.json").write_text('{"name":"Drill"}', encoding="utf-8")
    (paths["workspace"] / "master_resume.md").write_text("# Drill", encoding="utf-8")
    (paths["data"] / "settings.json").write_text('{"jooble_key":"secret"}', encoding="utf-8")

    # --- back up -----------------------------------------------------------
    bundle = backup_user(user["slug"], backups)
    assert bundle.exists() and bundle.stat().st_size > 0

    manifest = read_manifest(bundle)
    assert manifest["rows"]["applications"] == 2, manifest
    assert manifest["rows"]["seen_postings"] == 1, manifest
    assert "workspace/" in manifest["files"], manifest

    report = verify(bundle)
    assert report["ok"], report
    assert report["problems"] == [], report

    # --- destroy -----------------------------------------------------------
    # Not a gentle delete: wipe the instance the way a failed disk would.
    shutil.rmtree(paths["home"])
    assert not paths["tracker_db"].exists()

    # --- restore -----------------------------------------------------------
    # An active account is refused: restoring underneath somebody who is
    # using Facet would race their own writes. Suspending is the precondition
    # now that there is no per-user process to stop.
    try:
        restore(bundle)
        raise AssertionError("restoring over an active account should be refused")
    except BackupError as exc:
        assert "suspend" in str(exc).lower(), exc

    from . import provision

    provision.suspend(user["id"], "drill")
    outcome = restore(bundle)
    assert outcome["matches_manifest"], outcome
    assert outcome["rows"]["applications"] == 2, outcome

    # Everything is actually back, not just the database.
    conn = sqlite3.connect(paths["tracker_db"])
    companies = {r[0] for r in conn.execute("SELECT company FROM applications")}
    conn.close()
    assert companies == {"Stripe", "Linear"}, companies
    assert (paths["exports"] / "stripe.pdf").read_bytes() == b"%PDF resume"
    assert (paths["workspace"] / "profile.json").exists(), "the Stone must come back"
    assert (paths["workspace"] / "master_resume.md").read_text(encoding="utf-8") == "# Drill"
    assert "secret" in (paths["data"] / "settings.json").read_text(encoding="utf-8")

    # --- guards ------------------------------------------------------------
    # Restoring over a live instance must refuse rather than replace it.
    try:
        restore(bundle)
        raise AssertionError("expected a refusal to overwrite")
    except BackupError as exc:
        assert "already exists" in str(exc), exc

    # Forced, the current contents are moved aside rather than deleted, so a
    # restore of the wrong bundle is itself undoable.
    restore(bundle, force=True)
    assert any(p.name.startswith(f"{user['slug']}-replaced-")
               for p in store.USERS_DIR.iterdir()), "previous contents must be kept"

    # Two backups in the same second are two bundles, not one. Asserted
    # explicitly because the only thing that used to enforce it was the
    # host being slow enough that the clock ticked in between.
    twin = backup_user(user["slug"], backups)
    assert twin != bundle, "a same-second backup overwrote the previous one"
    assert bundle.exists() and twin.exists(), (bundle, twin)
    assert verify(twin)["ok"]
    twin.unlink()

    # A corrupt bundle is caught by verify, not discovered during a restore.
    broken = backups / "broken-20200101-000000.tar.gz"
    broken.write_bytes(b"not a tarball")
    try:
        verify(broken)
        raise AssertionError("expected a corrupt bundle to be rejected")
    except (BackupError, tarfile.TarError, OSError):
        pass

    # A tampered database fails the integrity check rather than restoring.
    tampered = backup_user(user["slug"], backups)
    data = bytearray(tampered.read_bytes())
    data[len(data) // 2] ^= 0xFF
    tampered.write_bytes(bytes(data))
    try:
        result = verify(tampered)
        assert not result["ok"], result
    except (tarfile.TarError, OSError, EOFError):
        pass  # corruption caught even earlier, which is fine
    tampered.unlink()

    # --- pruning -----------------------------------------------------------
    old = backups / f"{user['slug']}-20200101-000000.tar.gz"
    shutil.copy2(bundle, old)
    import os as _os
    ancient = time.time() - 400 * 86400
    _os.utime(old, (ancient, ancient))

    plan = prune(backups, keep_days=30, dry_run=True)
    assert old.name in plan["removed"], plan
    assert old.exists(), "a dry run must not delete"
    prune(backups, keep_days=30, dry_run=False)
    assert not old.exists()

    # The newest bundle is never pruned, however old it gets — a rule that
    # can leave an account with no backup at all is worse than keeping too
    # much.
    for bundle_path in backups.glob(f"{user['slug']}-*.tar.gz"):
        _os.utime(bundle_path, (ancient, ancient))
    prune(backups, keep_days=1, dry_run=False)
    remaining = list(backups.glob(f"{user['slug']}-*.tar.gz"))
    assert len(remaining) == 1, remaining

    state = status(backups)
    assert state["users"][0]["latest"] is not None
    assert state["users"][0]["age_hours"] is not None

    runtime.capabilities = real_capabilities
    print("backup: restore drill passed - backed up, destroyed, restored, verified")


if __name__ == "__main__":
    demo()
