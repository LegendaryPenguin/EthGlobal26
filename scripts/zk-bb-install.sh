#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.bb:$HOME/.nargo/bin:$PATH"
echo "=== installing bb matched to noir 1.0.0-beta.22 ==="
bbup -nv 1.0.0-beta.22
echo "=== bb version ==="
bb --version
echo "=== DONE-BB ==="
