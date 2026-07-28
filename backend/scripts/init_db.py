import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from services.db import init_db
except ImportError:
    print("services.db not present yet — skipping tracker.db init.")
else:
    init_db()
    print("tracker.db initialized.")
