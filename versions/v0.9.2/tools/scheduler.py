#!/usr/bin/env python3
"""Local multi-profile browser launcher & authenticated callback waiter.

No Douyin credential collection or private endpoints. Standard browser navigation only.
"""
from __future__ import annotations
import argparse
import hmac
import json
import logging
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET_URL = "https://www.douyin.com/chat"
ACCOUNT_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,60}$")
STATUSES = {"DONE", "FAILED", "UNKNOWN", "STOPPED", "BLOCKED"}


def load_config(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Config must be an object")
    when = str(data.get("send_time", "20:30"))
    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", when):
        raise ValueError("send_time must be HH:MM")
    port = int(data.get("callback_port", 7788))
    if not 1024 <= port <= 65535:
        raise ValueError("callback_port out of range")
    token = data.get("callback_token", "")
    if not isinstance(token, str) or len(token) < 24:
        raise ValueError("Set callback_token to a random secret of >=24 characters via manager.py")
    accounts = data.get("accounts", [])
    if not isinstance(accounts, list):
        raise ValueError("accounts must be an array")
    seen = set()
    for a in accounts:
        if not isinstance(a, dict) or not ACCOUNT_PATTERN.fullmatch(str(a.get("id", ""))):
            raise ValueError("Invalid account id")
        if a["id"] in seen:
            raise ValueError("Duplicate account id")
        seen.add(a["id"])
        profile = a.get("profile_dir")
        if not isinstance(profile, str) or not profile.strip():
            raise ValueError(f"Missing profile_dir for {a['id']}")
    return data


def resolve_browser(name: str) -> str:
    if Path(name).is_file():
        return str(Path(name).resolve())
    command = shutil.which(name)
    if command:
        return command
    if sys.platform == "win32":
        base = [os.environ.get("PROGRAMFILES", ""), os.environ.get("PROGRAMFILES(X86)", ""), os.environ.get("LOCALAPPDATA", "")]
        candidates = [Path(p) / "Google/Chrome/Application/chrome.exe" for p in base if p] + [Path(p) / "Microsoft/Edge/Application/msedge.exe" for p in base if p]
    elif sys.platform == "darwin":
        candidates = [Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), Path("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")]
    else:
        candidates = []
        for item in ("google-chrome", "chromium", "chromium-browser", "microsoft-edge"):
            match = shutil.which(item)
            if match:
                return match
    for file in candidates:
        if file.is_file():
            return str(file)
    raise FileNotFoundError(f"Browser executable not found: {name}")


def make_handler(secret: str, events: queue.Queue):
    class CallbackHandler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def do_POST(self):
            if self.path != "/done":
                self.send_error(404)
                return
            received = self.headers.get("X-Spark-Token", "")
            if not hmac.compare_digest(received.encode("utf-8"), secret.encode("utf-8")):
                self.send_error(403)
                return
            try:
                n = int(self.headers.get("Content-Length", "0"))
                if n <= 0 or n > 2048:
                    raise ValueError("invalid payload size")
                payload = json.loads(self.rfile.read(n).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("not object")
                aid = payload.get("account", "")
                if not isinstance(aid, str) or not ACCOUNT_PATTERN.fullmatch(aid):
                    raise ValueError("invalid account")
                if payload.get("status") not in STATUSES:
                    raise ValueError("invalid status")
                for key in ("confirmed", "failed", "unknown"):
                    v = payload.get(key)
                    if type(v) is not int or not 0 <= v <= 1000:
                        raise ValueError("invalid counter")
                millis = int(payload.get("at", 0))
                if abs(time.time() * 1000 - millis) > 60000:
                    raise ValueError("stale callback")
            except (ValueError, TypeError, KeyError, json.JSONDecodeError, UnicodeDecodeError):
                self.send_error(400)
                return
            events.put({"account": aid, "status": payload["status"], "confirmed": payload["confirmed"], "failed": payload["failed"], "unknown": payload["unknown"], "received": time.time()})
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"accepted":true}')
    return CallbackHandler


def start_callback_server(config: dict):
    events: queue.Queue = queue.Queue()
    server = ThreadingHTTPServer(("127.0.0.1", int(config["callback_port"])), make_handler(config["callback_token"], events))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, events


def launch_account(account: dict, config_path: Path, dry_run=False):
    browser = resolve_browser(str(account.get("browser") or "chrome")) if not dry_run else str(account.get("browser") or "chrome")
    profile = Path(account["profile_dir"]).expanduser()
    if not profile.is_absolute():
        profile = (config_path.parent / profile).resolve()
    if dry_run:
        return None, [browser, f"--user-data-dir={profile}", "--new-window", TARGET_URL]
    profile.mkdir(parents=True, exist_ok=True)
    args = [browser, f"--user-data-dir={profile}", "--new-window", TARGET_URL]
    logging.info("Launching account=%s profile=%s", account["id"], profile)
    # No shell and no password/token arguments; Chrome profile remains on this machine.
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return proc, args


def run_once(config_path: Path, chosen_account: str | None = None, dry_run=False) -> list[dict]:
    config = load_config(config_path)
    accounts = [a for a in config["accounts"] if a.get("enabled", True) and (not chosen_account or a["id"] == chosen_account)]
    if not accounts:
        logging.warning("No eligible accounts")
        return []
    server = None
    events = queue.Queue()
    if not dry_run:
        server, events = start_callback_server(config)
    results = []
    try:
        for a in accounts:
            proc, args = launch_account(a, config_path, dry_run)
            if dry_run:
                logging.info("DRY RUN %s: %s", a["id"], args)
                results.append({"account": a["id"], "status": "DRY_RUN"})
                continue
            started = time.time()
            deadline = started + max(15, min(3600, int(config.get("timeout_seconds", 300))))
            done = None
            while time.time() < deadline:
                try:
                    event = events.get(timeout=min(1.0, max(.05, deadline - time.time())))
                except queue.Empty:
                    continue
                if event["account"] == a["id"] and event["received"] >= started:
                    done = event
                    break
                logging.warning("Ignoring unexpected callback for account=%s", event["account"])
            status = done["status"] if done else "TIMEOUT"
            logging.info("Finished account=%s status=%s", a["id"], status)
            results.append({"account": a["id"], "status": status, "confirmed": done["confirmed"] if done else 0})
            # Never close unrelated Chrome processes; only an owned process and only when explicitly enabled.
            if config.get("close_launched_browser", False) and proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    logging.warning("Launched browser did not exit; leaving it running")
            time.sleep(max(0, min(60, int(config.get("between_accounts_seconds", 2)))))
    finally:
        if server:
            server.shutdown()
            server.server_close()
    return results


def seconds_to_next_clock(clock: str) -> float:
    hh, mm = map(int, clock.split(":"))
    now = datetime.now()
    target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def main():
    ap = argparse.ArgumentParser(description="Local multi-profile Douyin Spark scheduler")
    ap.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--daemon", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--account")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    config_path = args.config.expanduser().resolve()
    try:
        config = load_config(config_path)
        if not args.daemon:
            print(json.dumps(run_once(config_path, args.account, args.dry_run), ensure_ascii=False, indent=2))
            return
        logging.info("Scheduler started. Local send time=%s", config["send_time"])
        while True:
            config = load_config(config_path)
            seconds = seconds_to_next_clock(config["send_time"])
            logging.info("Next run in %.1f minutes", seconds / 60)
            time.sleep(seconds)
            run_once(config_path, args.account, args.dry_run)
            time.sleep(2)
    except (OSError, ValueError, KeyboardInterrupt) as e:
        logging.error("Scheduler stopped: %s", str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
