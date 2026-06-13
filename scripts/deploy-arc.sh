#!/usr/bin/env bash
#
# deploy-arc.sh — deploy + seed Vouch on ARC TESTNET (chain 5042002, never mainnet), then write the
# production env for BOTH apps (borrower + lender). Loans are funded from the pool (DeployArc seeds it).
#
# Requires (export or put in scripts/.env.deploy then `set -a; . scripts/.env.deploy; set +a`):
#   DEPLOYER_PRIVATE_KEY   funded with testnet USDC from https://faucet.circle.com (gas + pool seed)
#   USDC_ADDRESS           real Arc USDC (Circle MCP / address page) — never hardcode
#   WORLD_APP_ID           World developer portal (app_...)
#   WORLD_RP_ID            World RP id (managed RP)
# Optional:
#   REGISTRY_FORWARDER     relayer address that writes setTerms (defaults to the deployer)
#   WORLD_ACTION_ID        defaults to "mint-credit-passport"
#   SEED_SENIOR_USDC / SEED_JUNIOR_USDC / DEPLOY_TO_VAULT_USDC   6-dp amounts (defaults 800/200/500e6)
#
# Usage:  scripts/deploy-arc.sh
# Requires: foundry (forge, cast) on PATH, node.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$REPO_ROOT/contracts"
ARC_RPC_URL="${ARC_RPC_URL:-https://rpc.testnet.arc.network}"

: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY (funded at faucet.circle.com)}"
: "${USDC_ADDRESS:?set USDC_ADDRESS (real Arc USDC)}"
: "${WORLD_APP_ID:?set WORLD_APP_ID}"
: "${WORLD_RP_ID:?set WORLD_RP_ID}"
export USDC_ADDRESS WORLD_APP_ID
export WORLD_ACTION_ID="${WORLD_ACTION_ID:-mint-credit-passport}"
export REGISTRY_FORWARDER="${REGISTRY_FORWARDER:-}"
export SEED_SENIOR_USDC="${SEED_SENIOR_USDC:-800000000}"
export SEED_JUNIOR_USDC="${SEED_JUNIOR_USDC:-200000000}"
export DEPLOY_TO_VAULT_USDC="${DEPLOY_TO_VAULT_USDC:-500000000}"

for bin in forge cast node; do command -v "$bin" >/dev/null 2>&1 || { echo "error: '$bin' not found"; exit 1; }; done

echo "Deploying + seeding on Arc Testnet ($ARC_RPC_URL) ..."
cd "$CONTRACTS"
forge script script/DeployArc.s.sol:DeployArc \
  --rpc-url "$ARC_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --slow

RUN="$CONTRACTS/broadcast/DeployArc.s.sol/5042002/run-latest.json"
[ -f "$RUN" ] || { echo "error: broadcast file not found ($RUN)"; exit 1; }

# Map deployed contract addresses → the VITE_* env both apps read.
read -r REGISTRY VAULT ROUTER POOL PASSPORT <<EOF
$(node -e '
const j=require(process.argv[1]);
const at=n=>{for(const t of j.transactions){if(t.contractName===n&&t.contractAddress)return t.contractAddress}return ""};
process.stdout.write([at("LoanRegistry"),at("LoanVault"),at("IncomeRouter"),at("TranchePool"),at("PassportRegistry")].join(" "));
' "$RUN")
EOF

echo "  LoanRegistry=$REGISTRY  Vault=$VAULT  Router=$ROUTER  Pool=$POOL  Passport=$PASSPORT"

# Borrower app prod env (server-side secrets go in app/.env.local, NOT here).
cat > "$REPO_ROOT/app/.env.production" <<ENVF
VITE_ARC_RPC_URL=$ARC_RPC_URL
VITE_LOAN_REGISTRY_ADDRESS=$REGISTRY
VITE_LOAN_VAULT_ADDRESS=$VAULT
VITE_INCOME_ROUTER_ADDRESS=$ROUTER
VITE_TRANCHE_POOL_ADDRESS=$POOL
VITE_PASSPORT_REGISTRY_ADDRESS=$PASSPORT
VITE_USDC_ADDRESS=$USDC_ADDRESS
VITE_WORLD_APP_ID=$WORLD_APP_ID
VITE_WORLD_RP_ID=$WORLD_RP_ID
VITE_WORLD_ACTION_ID=$WORLD_ACTION_ID
ENVF

# Lender app prod env.
cat > "$REPO_ROOT/metamask-lender/.env.production" <<ENVF
VITE_ARC_RPC_URL=$ARC_RPC_URL
VITE_TRANCHE_POOL_ADDRESS=$POOL
VITE_USDC_ADDRESS=$USDC_ADDRESS
ENVF

cat <<EOF

────────────────────────────────────────────────────────────────────────
Deployed + pool seeded on Arc Testnet. Wrote app/.env.production + metamask-lender/.env.production.

Next (the 2 links):
  Borrower (needs Node — World ID + relayer):  cd app && npm run build && npm run serve
    → also set server secrets in app/.env.local: WORLD_RP_SIGNING_KEY, RELAYER_PRIVATE_KEY
      (RELAYER must equal REGISTRY_FORWARDER and be funded with Arc gas).
  Lender (static):                              cd metamask-lender && npm run build  (deploy dist/ anywhere)

Onboard many humans: each World ID sign-in provisions its own managed wallet; the relayer mints the
passport + funds gas, and loans disburse from the seeded pool. Keep the relayer + pool funded.
See DEPLOY.md.
────────────────────────────────────────────────────────────────────────
EOF
