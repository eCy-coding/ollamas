#!/usr/bin/env python3
"""calibrate_hardware — per-device hardware profile for the cross-platform
benchmark (scripts domain v4).

Probes the local macOS device (CPU brand, cores, RAM, thermal class) and merges
a `calibration[<device>]` block into ~/.llm-mission-control/benchmark.json so the
ranker can normalize tok/s across machines of different power. Read-only on the
benchmark results; only adds/updates the calibration map. Std-lib only.
"""
import json
import os
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE = Path.home() / ".llm-mission-control"
REPORT = STATE / "benchmark.json"


def _sysctl(key: str) -> str | None:
    try:
        out = subprocess.run(
            ["sysctl", "-n", key], capture_output=True, text=True, timeout=5
        )
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def thermal_class(ncpu: int, mem_gb: int) -> str:
    """Coarse power tier so cross-device tok/s can be compared fairly."""
    if ncpu >= 12 and mem_gb >= 32:
        return "workstation"
    if ncpu >= 8 and mem_gb >= 16:
        return "laptop-pro"
    if ncpu >= 4:
        return "laptop"
    return "constrained"


def profile() -> dict:
    mem_bytes = _sysctl("hw.memsize")
    mem_gb = round(int(mem_bytes) / 1073741824) if mem_bytes and mem_bytes.isdigit() else 0
    ncpu_raw = _sysctl("hw.ncpu")
    ncpu = int(ncpu_raw) if ncpu_raw and ncpu_raw.isdigit() else os.cpu_count() or 0
    return {
        "device": platform.node(),
        "arch": platform.machine(),
        "cpuModel": _sysctl("machdep.cpu.brand_string") or platform.processor() or "unknown",
        "ncpu": ncpu,
        "memGb": mem_gb,
        "thermalClass": thermal_class(ncpu, mem_gb),
        "os": f"{platform.system()} {platform.release()}",
        "ts": datetime.now(timezone.utc).isoformat(),
    }


def merge_into_report(prof: dict, report_path: Path = REPORT) -> dict:
    report = {}
    if report_path.exists():
        try:
            report = json.loads(report_path.read_text())
        except (OSError, json.JSONDecodeError):
            report = {}
    calibration = report.get("calibration") or {}
    calibration[prof["device"]] = prof
    report["calibration"] = calibration
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2))
    return prof


def main() -> int:
    prof = profile()
    if "--dry-run" in sys.argv:
        print(json.dumps(prof, indent=2))
        return 0
    merge_into_report(prof)
    print(f"calibrated {prof['device']}: {prof['thermalClass']} "
          f"({prof['cpuModel']}, {prof['ncpu']}c/{prof['memGb']}GB) -> {REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
