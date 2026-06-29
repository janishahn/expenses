"""Build the native iOS app and install it on a connected device.

Wraps ``xcodebuild`` and ``devicectl`` so a fresh build can be rebuilt and
reinstalled with a single command (``uv run run-ios-device``). It uses the
Xcode project's existing automatic code-signing settings, so it reuses the
developer's current certificate and provisioning profile and does not require
re-trusting the developer on the device between reinstalls.

Nothing about a specific machine, account, or device is baked in: the target
device is discovered from ``devicectl`` (or selected with ``--device``), repo
paths are derived from this file's location, and the signing team comes from
the checked-in project configuration. macOS with Xcode is required.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NamedTuple

REPO_ROOT = Path(__file__).resolve().parents[3]
PROJECT = REPO_ROOT / "ios" / "ExpensesApp" / "ExpensesApp.xcodeproj"
SCHEME = "ExpensesApp"


class Device(NamedTuple):
    udid: str
    name: str


def paired_ios_devices(payload: dict) -> list[Device]:
    """Extract paired physical iOS devices from ``devicectl list devices`` JSON.

    ``tunnelState`` is intentionally ignored: it reads ``disconnected`` even for
    a usable wired device because the tunnel is established on demand at install
    time.
    """
    devices: list[Device] = []
    for entry in payload.get("result", {}).get("devices", []):
        hardware = entry.get("hardwareProperties", {})
        connection = entry.get("connectionProperties", {})
        if hardware.get("platform") != "iOS":
            continue
        if connection.get("pairingState") != "paired":
            continue
        udid = hardware.get("udid")
        if not udid:
            continue
        name = entry.get("deviceProperties", {}).get("name") or "iOS device"
        devices.append(Device(udid=udid, name=name))
    return devices


def select_device(devices: list[Device], requested: str | None) -> Device:
    """Pick the target device, by explicit match or as the sole connected one."""
    if requested:
        needle = requested.lower()
        matches = [
            device
            for device in devices
            if device.udid == requested or needle in device.name.lower()
        ]
        if not matches:
            raise SystemExit(f"No paired iOS device matches {requested!r}.")
        if len(matches) > 1:
            listed = ", ".join(f"{d.name} ({d.udid})" for d in matches)
            raise SystemExit(f"{requested!r} matches multiple devices: {listed}")
        return matches[0]

    if not devices:
        raise SystemExit(
            "No paired iOS device found. Connect an iPhone, unlock it, and "
            "trust this computer."
        )
    if len(devices) > 1:
        listed = ", ".join(f"{d.name} ({d.udid})" for d in devices)
        raise SystemExit(
            "Multiple paired iOS devices found. Select one with --device "
            f"(name or UDID): {listed}"
        )
    return devices[0]


def _require_macos_toolchain() -> None:
    if sys.platform != "darwin" or shutil.which("xcrun") is None:
        raise SystemExit(
            "run-ios-device requires macOS with the Xcode command-line tools."
        )


def _discover_devices() -> list[Device]:
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        out = tmp_dir / "devices.json"
        subprocess.run(
            ["xcrun", "devicectl", "list", "devices", "--json-output", str(out)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return paired_ios_devices(json.loads(out.read_text(encoding="utf-8")))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _build_settings(configuration: str) -> dict[str, str]:
    # A generic destination resolves settings without a live device tunnel, so a
    # momentary disconnect cannot break the lookup; the values are identical for
    # any iOS device of this configuration.
    result = subprocess.run(
        [
            "xcodebuild",
            "-project",
            str(PROJECT),
            "-scheme",
            SCHEME,
            "-configuration",
            configuration,
            "-destination",
            "generic/platform=iOS",
            "-showBuildSettings",
            "-json",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit(
            f"Could not read build settings (xcodebuild exited {result.returncode}).\n"
            f"{result.stderr.strip()}"
        )
    for entry in json.loads(result.stdout):
        settings = entry.get("buildSettings", {})
        if "WRAPPER_NAME" in settings and "TARGET_BUILD_DIR" in settings:
            return settings
    raise SystemExit("Could not resolve build settings for the app target.")


def _run(label: str, command: list[str]) -> None:
    print(f"\n→ {label}")
    if subprocess.run(command).returncode != 0:
        raise SystemExit(f"{label} failed.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Build the iOS app and install it on a connected device, reusing the "
            "project's existing code-signing so the developer stays trusted."
        )
    )
    parser.add_argument(
        "--device",
        help="Target device name or UDID. Defaults to the only connected device.",
    )
    parser.add_argument(
        "--configuration",
        default="Debug",
        help="Build configuration (default: Debug).",
    )
    parser.add_argument(
        "--no-launch",
        action="store_true",
        help="Install without launching the app afterwards.",
    )
    args = parser.parse_args()

    _require_macos_toolchain()
    device = select_device(_discover_devices(), args.device)
    print(f"Target device: {device.name} ({device.udid})")

    settings = _build_settings(args.configuration)
    app_path = Path(settings["TARGET_BUILD_DIR"]) / settings["WRAPPER_NAME"]
    bundle_id = settings["PRODUCT_BUNDLE_IDENTIFIER"]

    _run(
        "Building",
        [
            "xcodebuild",
            "build",
            "-project",
            str(PROJECT),
            "-scheme",
            SCHEME,
            "-configuration",
            args.configuration,
            # Generic destination keeps the build independent of the live device
            # tunnel; devicectl below is the only step that touches the device.
            "-destination",
            "generic/platform=iOS",
            "-allowProvisioningUpdates",
        ],
    )
    _run(
        "Installing",
        [
            "xcrun",
            "devicectl",
            "device",
            "install",
            "app",
            "--device",
            device.udid,
            str(app_path),
        ],
    )
    if not args.no_launch:
        _run(
            "Launching",
            [
                "xcrun",
                "devicectl",
                "device",
                "process",
                "launch",
                "--device",
                device.udid,
                bundle_id,
            ],
        )

    print(f"\nInstalled {bundle_id} on {device.name}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
