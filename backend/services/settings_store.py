"""User settings — currently just optional API keys for the job aggregators
that require one (Adzuna, Jooble). Stored next to feeds.json, never in git.

Keys are optional by design: every keyless provider works without this file,
and a missing key disables exactly one provider instead of erroring.
"""

import json
import os

from services import paths

DEFAULTS = {
    "adzuna_app_id": "",
    "adzuna_app_key": "",
    "adzuna_country": "in",
    "jooble_key": "",
    "default_location": "",
    "enabled_sources": [],  # empty = all available sources
}


def load_settings() -> dict:
    settings = dict(DEFAULTS)
    if paths.SETTINGS_PATH.exists():
        try:
            settings.update(json.loads(paths.SETTINGS_PATH.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass  # corrupt file shouldn't take the app down — fall back to defaults

    # Env vars win over the file so a key can be supplied without writing it to disk.
    for key, env in (
        ("adzuna_app_id", "ADZUNA_APP_ID"),
        ("adzuna_app_key", "ADZUNA_APP_KEY"),
        ("jooble_key", "JOOBLE_KEY"),
    ):
        if os.environ.get(env):
            settings[key] = os.environ[env]

    return settings


def save_settings(patch: dict) -> dict:
    settings = load_settings()
    settings.update({k: v for k, v in patch.items() if k in DEFAULTS})
    paths.SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    paths.SETTINGS_PATH.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return settings


def redacted(settings: dict) -> dict:
    """What the frontend is allowed to see — whether a key is set, never its value."""
    out = {k: v for k, v in settings.items() if not k.endswith(("_key", "_app_id"))}
    out["adzuna_configured"] = bool(settings.get("adzuna_app_id") and settings.get("adzuna_app_key"))
    out["jooble_configured"] = bool(settings.get("jooble_key"))
    return out
