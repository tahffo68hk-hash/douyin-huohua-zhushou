"""Mock-only regression tests for the local Playwright browser launcher."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


TESTS = Path(__file__).resolve().parent
SUITES = (
    "browser-smoke.py",
    "browser-v03.py",
    "browser-v04.py",
    "browser-v05.py",
)


def load_browser_support():
    module_path = TESTS / "browser_support.py"
    if not module_path.is_file():
        raise AssertionError("tests/browser_support.py shared launcher is missing")
    spec = importlib.util.spec_from_file_location("browser_support", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BrowserSupportTests(unittest.TestCase):
    def test_all_browser_suites_use_the_shared_launcher(self):
        for suite in SUITES:
            with self.subTest(suite=suite):
                source = (TESTS / suite).read_text(encoding="utf-8")
                self.assertRegex(source, r"from\s+browser_support\s+import\s+launch_chromium")
                self.assertRegex(source, r"launch_chromium\s*\(")
                self.assertNotIn("executable_path=", source)
                self.assertNotIn("/usr/bin/chromium", source)

    def test_v05_decodes_downloaded_json_as_utf8(self):
        source = (TESTS / "browser-v05.py").read_text(encoding="utf-8")
        self.assertEqual(source.count(".read_text(encoding='utf-8')"), 2)

    def test_managed_browser_is_default_without_pinned_executable(self):
        support = load_browser_support()
        browser = object()
        fake_playwright = type("Playwright", (), {})()
        fake_playwright.chromium = type(
            "Chromium", (), {"launch": lambda self, **kwargs: (browser, kwargs)}
        )()

        with patch.dict(os.environ, {}, clear=True), patch.object(support.sys, "platform", "win32"):
            result, kwargs = support.launch_chromium(fake_playwright, timeout_ms=4321)

        self.assertIs(result, browser)
        self.assertNotIn("executable_path", kwargs)
        self.assertTrue(kwargs["headless"])
        self.assertEqual(kwargs["timeout"], 4321)

    def test_valid_explicit_executable_is_used(self):
        support = load_browser_support()
        browser = object()
        launch_calls = []
        fake_playwright = type("Playwright", (), {})()
        fake_playwright.chromium = type(
            "Chromium", (), {"launch": lambda self, **kwargs: launch_calls.append(kwargs) or browser}
        )()

        with tempfile.NamedTemporaryFile() as executable:
            with patch.dict(os.environ, {"PLAYWRIGHT_CHROMIUM_EXECUTABLE": executable.name}), patch.object(
                support.sys, "platform", "win32"
            ):
                result = support.launch_chromium(fake_playwright)

        self.assertIs(result, browser)
        self.assertEqual(launch_calls[0]["executable_path"], executable.name)

    def test_invalid_explicit_executable_fails_with_environment_variable_name(self):
        support = load_browser_support()
        launch_calls = []
        fake_playwright = type("Playwright", (), {})()
        fake_playwright.chromium = type(
            "Chromium", (), {"launch": lambda self, **kwargs: launch_calls.append(kwargs)}
        )()
        invalid_path = str(TESTS / "missing-chromium-executable")

        with patch.dict(os.environ, {"PLAYWRIGHT_CHROMIUM_EXECUTABLE": invalid_path}), self.assertRaisesRegex(
            (FileNotFoundError, ValueError), "PLAYWRIGHT_CHROMIUM_EXECUTABLE"
        ):
            support.launch_chromium(fake_playwright)

        self.assertEqual(launch_calls, [])

    def test_linux_only_arguments_are_scoped_to_linux(self):
        support = load_browser_support()
        for platform_name, expect_linux_args in (("linux", True), ("win32", False)):
            with self.subTest(platform=platform_name):
                launch_calls = []
                fake_playwright = type("Playwright", (), {})()
                fake_playwright.chromium = type(
                    "Chromium", (), {"launch": lambda self, **kwargs: launch_calls.append(kwargs)}
                )()
                with patch.dict(os.environ, {}, clear=True), patch.object(
                    support.sys, "platform", platform_name
                ):
                    support.launch_chromium(fake_playwright)
                args = launch_calls[0].get("args", [])
                linux_only = {"--no-sandbox", "--disable-dev-shm-usage"}
                self.assertEqual(linux_only.issubset(args), expect_linux_args)
                if not expect_linux_args:
                    self.assertTrue(linux_only.isdisjoint(args))


if __name__ == "__main__":
    unittest.main(verbosity=2)
