#!/usr/bin/env bash
#
# credit-report-demo.sh — the portable, person-bound credit report (Track B reputation lever).
# A human builds credit history; a second lender polls a DIFFERENT wallet of the same human and reads
# the IDENTICAL report. Pure simulation (no anvil/testnet/keys).
#
# Usage: scripts/credit-report-demo.sh   ·   Requires: foundry (forge) on PATH.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v forge >/dev/null 2>&1 || { echo "error: 'forge' not found — install Foundry (https://getfoundry.sh)"; exit 1; }
cd "$REPO_ROOT/contracts"
forge script script/CreditReportDemo.s.sol:CreditReportDemo -vv
