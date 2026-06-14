#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
ROOT=/mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal

echo "=== copy compiled circuit into app/public ==="
mkdir -p "$ROOT/app/public"
cp "$ROOT/circuits/target/vouch_eligibility.json" "$ROOT/app/public/vouch_eligibility.json"
ls -la "$ROOT/app/public/vouch_eligibility.json"

cd "$ROOT/app"
echo "=== npm install (app + bb.js/noir_js) ==="
npm install --no-audit --no-fund 2>&1 | tail -10

echo "=== app build (tsc -b + vite build) ==="
npm run build 2>&1 | tail -40
echo "=== DONE-APP-BUILD rc=$? ==="
