"""Package init — exists solely to make WeasyPrint importable on Windows.

WeasyPrint's native GTK/Pango/Cairo DLLs live in the conda-forge venv at
`backend/.venv/Library/bin`. They are only found if that directory is on the
DLL search path *before* weasyprint is imported. Doing it here — rather than
in the env `run.py` hands to its uvicorn subprocess — means it holds for every
launch method: `uvicorn main:app`, a script, a test, an import from anywhere.
Any `import services.<anything>` runs this first.

No-op on POSIX (where the libs come from the system loader) and no-op when the
directory doesn't exist (a plain venv install without the native libs).
"""

import os
from pathlib import Path

_DLL_DIR = Path(__file__).resolve().parent.parent / ".venv" / "Library" / "bin"

if _DLL_DIR.is_dir():
    _dll = str(_DLL_DIR)
    # WeasyPrint reads this itself (and passes it to add_dll_directory);
    # setting PATH too covers libraries that use the legacy search order.
    existing = os.environ.get("WEASYPRINT_DLL_DIRECTORIES", "")
    if _dll not in existing.split(os.pathsep):
        os.environ["WEASYPRINT_DLL_DIRECTORIES"] = (
            f"{_dll}{os.pathsep}{existing}" if existing else _dll
        )
    if _dll not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = _dll + os.pathsep + os.environ.get("PATH", "")
    if hasattr(os, "add_dll_directory"):  # Windows only
        try:
            os.add_dll_directory(_dll)
        except OSError:  # pragma: no cover — race with the is_dir() check
            pass
