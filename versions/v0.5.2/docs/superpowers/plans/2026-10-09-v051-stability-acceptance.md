# V0.5.1 Stability Acceptance Implementation Plan

> **For agentic workers:** Follow the scoped implementation steps below. The source ZIP was extracted to a separate, non-Git workspace; do not initialize a repository or alter the neighboring Electron repository.

**Goal:** Produce an installable V0.5.1 package with a portable local browser test runner and an evidence-based acceptance report.

**Architecture:** Keep userscript runtime behavior unchanged unless review uncovers a reproducible P0/P1 defect. Route all mock browser tests through one Playwright launcher that uses its managed Chromium by default and an optional explicit executable override. Keep real-Douyin claims separate from local mock results.

**Tech Stack:** JavaScript userscript, Node.js tests, Python unittest, Playwright Chromium, PowerShell packaging.

## Global Constraints

- Do not send messages, enable automation, or change user account/browser configuration.
- Preserve the existing spark-full:v2: storage namespace and fail-closed identity/send behavior.
- Real message sending requires a specific target, exact payload, count, and explicit approval; none is approved in this task yet.
- Do not collect or publish cookies, tokens, private messages, contact names, or identifiable screenshots.
- Do not push or alter the neighboring Git repository.

---

### Task 1: Make the local browser suite portable

**Files:**
- Create: tests/browser_support.py
- Create: tests/test_browser_support.py
- Modify: tests/browser-smoke.py
- Modify: tests/browser-v03.py
- Modify: tests/browser-v04.py
- Modify: tests/browser-v05.py
- Modify: package.json

**Interface:** launch_chromium(playwright, timeout_ms=...) starts a headless Playwright-managed Chromium by default; PLAYWRIGHT_CHROMIUM_EXECUTABLE may select an existing explicit executable.

- [ ] Add a regression check proving all four browser suites use the shared launcher; run it and confirm it fails against the current hard-coded Linux path.
- [ ] Add unit coverage for managed-browser default, explicit executable override, and invalid override; run it and confirm expected failures before implementation.
- [ ] Implement the shared launcher with Linux-only sandbox flags applied only on Linux.
- [ ] Replace the four pinned launch calls and include the new regression checks in npm run test:browser.
- [ ] Run the full browser suite and confirm all mock scenarios pass without contacting Douyin.

### Task 2: Prepare the V0.5.1 release and acceptance record

**Files:**
- Modify: douyin-spark-full.user.js
- Modify: package.json
- Modify: README.md
- Modify: CHANGELOG.md
- Modify: docs/RELEASE_MANIFEST.txt
- Create: docs/TEST_REPORT_V051.md
- Create: douyin-spark-full-v0.5.1.zip at the workspace root

- [ ] Set package and userscript version metadata to 0.5.1.
- [ ] Document the portable Playwright requirement and confirmed V0.5.1 changes in Chinese.
- [ ] Record the live browser observation as read-only evidence: the opened Douyin page showed a different legacy panel, so it does not verify injection of the supplied V0.5.0/V0.5.1 script.
- [ ] Fill the requested PASS / FAIL / BLOCKED / NOT_TESTED matrix using fresh command output; identify mock-only versus real-page evidence.
- [ ] Re-run all release gates, regenerate mock screenshots, and build the ZIP from the complete project source.
- [ ] Verify archive contents, package checksum manifest, and final workspace state.

