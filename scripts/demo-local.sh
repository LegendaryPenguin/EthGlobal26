#!/usr/bin/env bash
#
# demo-local.sh — run the full Vouch lifecycle end-to-end against a throwaway local anvil node.
#
# No Arc RPC, no Circle API key, no World ID app required: the demo deploys a mock 6-decimal USDC
# and a mock World ID verifier, then drives lender funding -> capital deployment -> borrower
# onboarding -> CRE verdict -> claim -> income-routed repayment -> reputation ladder. See
# contracts/script/DemoLocal.s.sol for the step-by-step logic.
#
# Usage:  scripts/demo-local.sh
# Requires: foundry (anvil, forge, cast) on PATH.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
RPC_URL="http://127.0.0.1:8545"
# Arc's chain id (5042002) so the local node mirrors the target network (Golden Rule #3).
CHAIN_ID=5042002
# Account #0's well-known anvil key — only ever used to broadcast to this local throwaway node.
DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

for bin in anvil forge cast; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: '$bin' not found — install Foundry (https://getfoundry.sh)"; exit 1; }
done

echo "Starting anvil (chain id $CHAIN_ID) ..."
anvil --chain-id "$CHAIN_ID" --silent &
ANVIL_PID=$!

cleanup() {
  if kill -0 "$ANVIL_PID" >/dev/null 2>&1; then
    echo ""
    echo "Stopping anvil (pid $ANVIL_PID) ..."
    kill "$ANVIL_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# Wait for the RPC to accept requests (up to ~10s).
for i in $(seq 1 50); do
  if cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then break; fi
  if [ "$i" -eq 50 ]; then echo "error: anvil did not become ready"; exit 1; fi
  sleep 0.2
done
echo "anvil ready."
echo ""

cd "$CONTRACTS_DIR"
forge script script/DemoLocal.s.sol:DemoLocal \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PK" \
  --broadcast \
  -v

echo ""
echo "Demo complete."
