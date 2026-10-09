"""Shared Playwright launcher for local, mock-only browser suites."""
import os
from pathlib import Path
import sys


EXECUTABLE_ENV = "PLAYWRIGHT_CHROMIUM_EXECUTABLE"


def launch_chromium(playwright, timeout_ms=10000):
    """Launch Playwright's managed Chromium, with an optional local override."""
    kwargs = {
        "headless": True,
        "args": ["--disable-gpu", "--disable-background-networking"],
        "timeout": timeout_ms,
    }
    if sys.platform.startswith("linux"):
        kwargs["args"].extend(("--no-sandbox", "--disable-dev-shm-usage"))

    executable = os.environ.get(EXECUTABLE_ENV)
    if executable:
        executable_path = Path(executable).expanduser()
        if not executable_path.is_file():
            raise FileNotFoundError(
                f"{EXECUTABLE_ENV} must point to an existing Chromium executable file; "
                f"got {executable!r}"
            )
        kwargs["executable_path"] = str(executable_path)

    return playwright.chromium.launch(**kwargs)
