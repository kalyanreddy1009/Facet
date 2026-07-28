"""Contract check for GET /api/status.

Asserts the report built by services/health.py matches the TypeScript
interfaces in frontend/src/lib/status.ts — required keys, allowed status
enums, and that `overall`/`counts` are actually derived from the checks
rather than declared.

    python scripts/test_health.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.health import GROUPS, build_report, run_check  # noqa: E402
from services.logging_setup import setup_logging  # noqa: E402

CHECK_STATUSES = {"ok", "degraded", "error", "disabled", "unknown"}
OVERALL_STATUSES = {"operational", "degraded", "down"}
LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}

REPORT_KEYS = {
    "generated_at", "overall", "uptime_seconds", "duration_ms",
    "versions", "groups", "counts", "traffic", "recent_errors",
}
CHECK_KEYS = {"key", "label", "status", "detail", "hint", "latency_ms", "last_checked", "meta"}
METRIC_KEYS = {"path", "count", "errors", "p50_ms", "p95_ms", "max_ms"}
LOG_KEYS = {"ts", "level", "logger", "message", "path", "traceback"}


def check_shape(report: dict) -> list:
    assert set(report) == REPORT_KEYS, f"StatusReport keys differ: {set(report) ^ REPORT_KEYS}"
    assert report["overall"] in OVERALL_STATUSES, report["overall"]
    assert isinstance(report["uptime_seconds"], (int, float))
    assert isinstance(report["duration_ms"], (int, float))
    assert all(isinstance(v, str) for v in report["versions"].values()), report["versions"]

    all_checks = []
    seen_keys = set()
    for group in report["groups"]:
        assert set(group) == {"key", "label", "description", "checks"}, set(group)
        assert group["label"] and group["description"], group["key"]
        assert group["checks"], f"group {group['key']} has no checks"
        for check in group["checks"]:
            assert set(check) == CHECK_KEYS, f"{check.get('key')}: {set(check) ^ CHECK_KEYS}"
            assert check["status"] in CHECK_STATUSES, check
            assert isinstance(check["key"], str) and check["key"], check
            assert isinstance(check["label"], str) and check["label"], check
            assert isinstance(check["detail"], str) and check["detail"], check
            assert isinstance(check["last_checked"], str) and "T" in check["last_checked"], check
            assert check["hint"] is None or isinstance(check["hint"], str), check
            assert isinstance(check["latency_ms"], (int, float)), check
            for k, v in check["meta"].items():
                assert isinstance(v, (str, int, float, bool, type(None))), (check["key"], k, v)
            assert check["key"] not in seen_keys, f"duplicate check key {check['key']}"
            seen_keys.add(check["key"])
            all_checks.append(check)
    return all_checks


def check_counts(report: dict, all_checks: list) -> None:
    assert set(report["counts"]) == {"ok", "degraded", "error", "disabled"}, report["counts"]
    for status, count in report["counts"].items():
        actual = sum(1 for c in all_checks if c["status"] == status)
        assert count == actual, f"counts.{status} says {count}, checks say {actual}"


def check_overall(report: dict, all_checks: list) -> None:
    core = next(g for g in report["groups"] if g["key"] == "core")["checks"]
    if any(c["status"] == "error" for c in core):
        expected = "down"
    elif any(c["status"] in ("error", "degraded") for c in all_checks):
        expected = "degraded"
    else:
        expected = "operational"
    assert report["overall"] == expected, f"overall={report['overall']}, expected {expected}"
    # `disabled` must never degrade the report.
    assert not (report["overall"] != "operational"
                and all(c["status"] in ("ok", "disabled", "unknown") for c in all_checks)), \
        "a disabled/unknown-only report must be operational"


def check_traffic_and_logs(report: dict) -> None:
    traffic = report["traffic"]
    assert set(traffic) == {"total_requests", "total_errors", "error_rate", "by_endpoint"}, traffic
    assert 0.0 <= traffic["error_rate"] <= 1.0
    for metric in traffic["by_endpoint"]:
        assert set(metric) == METRIC_KEYS, set(metric) ^ METRIC_KEYS
        assert metric["p50_ms"] <= metric["p95_ms"] <= metric["max_ms"], metric
        assert metric["errors"] <= metric["count"], metric
    for entry in report["recent_errors"]:
        assert set(entry) == LOG_KEYS, set(entry) ^ LOG_KEYS
        assert entry["level"] in LOG_LEVELS, entry


def check_isolation() -> None:
    """One exploding check must become one error check, not a 500."""
    def boom():
        raise RuntimeError("synthetic failure")

    result = run_check("test.boom", "Boom", boom)
    assert len(result) == 1, result
    assert result[0]["status"] == "error", result
    assert "synthetic failure" in result[0]["detail"], result
    assert set(result[0]) == CHECK_KEYS, set(result[0])

    # Every registered check is callable and its key is unique in its group.
    keys = [key for _, _, _, checks in GROUPS for key, _, _ in checks]
    assert len(keys) == len(set(keys)), keys


def main() -> None:
    setup_logging()
    report = asyncio.run(build_report())

    all_checks = check_shape(report)
    check_counts(report, all_checks)
    check_overall(report, all_checks)
    check_traffic_and_logs(report)
    check_isolation()

    assert report["duration_ms"] < 2000, f"report took {report['duration_ms']}ms — must be well under 2s"

    by_status = {s: sum(1 for c in all_checks if c["status"] == s) for s in CHECK_STATUSES}
    print(f"test_health: all checks passed — overall={report['overall']}, "
          f"{len(all_checks)} checks in {report['duration_ms']}ms, {by_status}")


if __name__ == "__main__":
    main()
