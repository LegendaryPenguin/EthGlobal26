#!/usr/bin/env bash
set -euo pipefail

echo "=== installing noirup ==="
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
export PATH="$HOME/.nargo/bin:$PATH"

echo "=== installing nargo 1.0.0-beta.22 ==="
noirup -v 1.0.0-beta.22
nargo --version

echo "=== installing bbup ==="
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
export PATH="$HOME/.bb:$PATH"

echo "=== installing bb matched to noir 1.0.0-beta.22 ==="
bbup --nv 1.0.0-beta.22
bb --version

echo "=== DONE-TOOLCHAIN ==="
