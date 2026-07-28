"""One-off manual check for Task 2's validation step. Not part of the app."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.agy_runner import WORKSPACE, run_agy, check_agy_health  # noqa: E402

WORKSPACE.mkdir(parents=True, exist_ok=True)


async def main():
    ok, detail = check_agy_health()
    print(f"health check: available={ok} detail={detail!r}")
    if not ok:
        return

    input_path = WORKSPACE / "dummy_input.txt"
    input_path.write_text("banana", encoding="utf-8")

    output_path = WORKSPACE / "dummy_output.txt"
    if output_path.exists():
        output_path.unlink()

    instruction = (
        "Read the file `dummy_input.txt` in the current directory. "
        "It contains a single word. Write that word in uppercase, and only "
        "that word with no other text, to `dummy_output.txt`."
    )

    result = await run_agy(instruction, "dummy_output.txt")
    print("output file contents:", repr(result))
    assert "BANANA" in result, f"expected BANANA in output, got {result!r}"
    print("ROUNDTRIP OK")


asyncio.run(main())
