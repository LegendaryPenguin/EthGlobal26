#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.foundry/bin:$HOME/.nargo/bin:$HOME/.bb:$PATH"
cd /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/contracts
echo "=== forge test (EligibilityGate) ==="
forge test --match-path "test/EligibilityGate.t.sol" -vv 2>&1 | tail -45
echo "=== DONE-FTEST rc=$? ==="
