"""Every filesystem location Facet uses, in one place.

Before this module, ten modules each computed their own paths from
`Path(__file__).parent.parent.parent`, which hardcoded one rule: data lives
inside the repo. That is right for a laptop and wrong for a host serving
several people, where each one's data lives under its own directory.

The environment variables below move `data/` and `workspace/` anywhere. When
unset the defaults reproduce the old behaviour exactly, so a local checkout
with no environment set behaves as it always has.

Imported by `logging_setup`, which main.py loads before anything else — so
this module must not import from `services`.
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent


def _dir(env_var: str, default: Path) -> Path:
    """An override wins only if it is actually set to something."""
    value = os.environ.get(env_var, "").strip()
    return Path(value).expanduser().resolve() if value else default


# The three roots. Everything else is derived, so a deployment only ever
# needs to set these.
DATA_DIR = _dir("FACET_DATA_DIR", ROOT / "data")
WORKSPACE_DIR = _dir("FACET_WORKSPACE_DIR", ROOT / "workspace")
TEMPLATES_DIR = _dir("FACET_TEMPLATES_DIR", ROOT / "templates")

# data/ — per-user state. Gitignored, backed up, never in an image layer.
DB_PATH = DATA_DIR / "tracker.db"
SETTINGS_PATH = DATA_DIR / "settings.json"
FEEDS_PATH = DATA_DIR / "feeds.json"
CALENDAR_CONFIG_PATH = DATA_DIR / "calendar_config.json"
EXPORTS_DIR = DATA_DIR / "exports"
LOG_DIR = DATA_DIR / "logs"
LOG_PATH = LOG_DIR / "facet.log"

# workspace/ — the Stone and the agy file-handoff scratch.
PROFILE_PATH = WORKSPACE_DIR / "profile.json"
MASTER_RESUME_PATH = WORKSPACE_DIR / "master_resume.md"
RULES_PATH = WORKSPACE_DIR / "RULES.md"
JOB_DESCRIPTION_PATH = WORKSPACE_DIR / "job_description.md"
TAILORED_FIELDS_PATH = WORKSPACE_DIR / "tailored_fields.json"


def demo() -> None:
    """Self-check:  backend/.venv/bin/python -m services.paths"""
    # Defaults land inside the repo — the pre-override behaviour.
    assert DB_PATH == ROOT / "data" / "tracker.db", DB_PATH
    assert PROFILE_PATH == ROOT / "workspace" / "profile.json", PROFILE_PATH

    # Derived paths must follow their root, or a deployment that moves DATA_DIR
    # would move the database and silently leave exports behind.
    assert EXPORTS_DIR.parent == DATA_DIR
    assert LOG_PATH.parent == LOG_DIR == DATA_DIR / "logs"
    assert MASTER_RESUME_PATH.parent == WORKSPACE_DIR

    # An override is honoured; empty or whitespace is treated as unset, so a
    # blank line in an env file can't silently relocate someone's data.
    os.environ["FACET_TEST_DIR"] = str(Path.home() / "facet-test")
    assert _dir("FACET_TEST_DIR", ROOT) != ROOT
    os.environ["FACET_TEST_DIR"] = "   "
    assert _dir("FACET_TEST_DIR", ROOT) == ROOT
    del os.environ["FACET_TEST_DIR"]
    assert _dir("FACET_DEFINITELY_UNSET_VAR", ROOT) == ROOT

    print("paths ok")
    print(f"  data:      {DATA_DIR}")
    print(f"  workspace: {WORKSPACE_DIR}")
    print(f"  templates: {TEMPLATES_DIR}")


if __name__ == "__main__":
    demo()
