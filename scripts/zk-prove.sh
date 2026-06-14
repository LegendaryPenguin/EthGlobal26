#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
cd /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/circuits

echo "=== node version ==="
node --version

echo "=== npm install (bb.js + noir_js) ==="
npm install --no-audit --no-fund 2>&1 | tail -8

echo "=== node prove.js ==="
node prove.js
echo "=== DONE-PROVE rc=$? ==="
