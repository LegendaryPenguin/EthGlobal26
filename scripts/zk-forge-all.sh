#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.foundry/bin:$HOME/.nargo/bin:$HOME/.bb:$PATH"
cd /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/contracts
echo "=== forge test (FULL suite) ==="
forge test 2>&1 | tail -30
echo "=== DONE-FORGEALL rc=$? ==="
