#!/usr/bin/env bash
#
# devnet-stop.sh — stop the persistent local devnet started by scripts/devnet.sh.

set -euo pipefail

PID_FILE="/tmp/vouch-devnet-anvil.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "No devnet pid file at $PID_FILE — nothing to stop (or it was started another way)."
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" && echo "Stopped devnet anvil (pid $PID)."
else
  echo "Devnet anvil (pid $PID) was not running."
fi
rm -f "$PID_FILE"
