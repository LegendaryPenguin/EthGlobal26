#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.foundry/bin:$HOME/.nargo/bin:$HOME/.bb:$PATH"

if ! command -v forge >/dev/null 2>&1; then
  echo "=== installing foundryup ==="
  curl -L https://foundry.paradigm.xyz | bash
  export PATH="$HOME/.foundry/bin:$PATH"
  echo "=== foundryup (installs forge/cast/anvil) ==="
  foundryup
fi
echo "=== forge version ==="
forge --version

cd /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/contracts
echo "=== ensure forge-std present ==="
if [ ! -d lib/forge-std ]; then
  forge install foundry-rs/forge-std --no-git 2>&1 | tail -5 || forge install foundry-rs/forge-std 2>&1 | tail -5
fi
echo "=== forge build ==="
forge build 2>&1 | tail -50
echo "=== DONE-FORGE rc=$? ==="
