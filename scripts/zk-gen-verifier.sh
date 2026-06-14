#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.bb:$HOME/.nargo/bin:$PATH"
ROOT=/mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal
cd "$ROOT/circuits"

echo "=== ensure compiled ==="
[ -f target/vouch_eligibility.json ] || nargo compile

echo "=== write_vk (evm target: keccak + ZK) ==="
rm -rf target/vk && mkdir -p target/vk
bb write_vk -b target/vouch_eligibility.json -o target/vk -t evm
echo "--- vk dir ---"; ls -la target/vk

echo "=== write_solidity_verifier (optimized) ==="
VK=$(ls target/vk/* | head -1)
echo "using vk: $VK"
bb write_solidity_verifier -k "$VK" -o "$ROOT/contracts/src/HonkVerifier.sol" -t evm --optimized
echo "--- verifier head ---"; sed -n '1,25p' "$ROOT/contracts/src/HonkVerifier.sol"
echo "--- verifier size ---"; wc -l "$ROOT/contracts/src/HonkVerifier.sol"
echo "=== contract/library names ==="; grep -nE 'contract |library |pragma' "$ROOT/contracts/src/HonkVerifier.sol" | head
echo "=== DONE-GENV ==="
