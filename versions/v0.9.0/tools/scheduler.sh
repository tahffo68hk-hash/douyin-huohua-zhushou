#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-daemon}"
if [[ "$MODE" == "daemon" ]]; then
  exec python3 "$HERE/scheduler.py" --config "$HERE/config.json" --daemon
elif [[ "$MODE" == "once" ]]; then
  exec python3 "$HERE/scheduler.py" --config "$HERE/config.json" --once
else
  echo "Usage: ./scheduler.sh [daemon|once]" >&2; exit 2
fi
