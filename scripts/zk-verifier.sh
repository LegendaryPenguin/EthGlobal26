#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.bb:$HOME/.nargo/bin:$PATH"
cd /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/circuits

echo "=== bb top-level help ==="
bb --help 2>&1 | sed -n '1,60p' || true
echo "=== bb write_vk help ==="
bb write_vk --help 2>&1 | sed -n '1,40p' || true
echo "=== bb write_solidity_verifier help ==="
bb write_solidity_verifier --help 2>&1 | sed -n '1,40p' || true
echo "=== DONE-VHELP ==="
