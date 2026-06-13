#!/usr/bin/env bash
#
# respawn-demo.sh — the Track B money-shot, headless: verified human borrows → defaults → locked out
# → a fresh wallet (same human) is rejected on-chain. Pure simulation (no anvil, no testnet, no keys).
#
# Usage: scripts/respawn-demo.sh
# Requires: foundry (forge) on PATH.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v forge >/dev/null 2>&1 || { echo "error: 'forge' not found — install Foundry (https://getfoundry.sh)"; exit 1; }

cd "$REPO_ROOT/contracts"
forge script script/RespawnDemo.s.sol:RespawnDemo -vv
