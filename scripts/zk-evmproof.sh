#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
cd /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/circuits
cp /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/scripts/zk-gen-evmproof.mjs ./_evmproof.mjs
node ./_evmproof.mjs
rc=$?
rm -f ./_evmproof.mjs
echo "rc=$rc"
