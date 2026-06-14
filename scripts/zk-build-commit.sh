#!/usr/bin/env bash
# Build the income-commitment helper circuit → app/public/commit.json (run via noir_js in-browser to
# compute income_commitment + nullifier from the borrower's dynamic income). Requires nargo on PATH.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.nargo/bin:$PATH"
cd "$ROOT/circuits-commit" && nargo compile
cp target/vouch_commit.json "$ROOT/app/public/commit.json"
echo "wrote app/public/commit.json"
