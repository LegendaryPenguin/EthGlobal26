#!/usr/bin/env bash
set -uo pipefail
export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"
cd /mnt/c/Users/shiva/OneDrive/Desktop/Ethglobal/circuits

echo "=== nargo compile ==="
nargo compile && echo "compile-ok"

echo "=== print hash values (helper test) ==="
nargo test print_hash_values --show-output 2>&1 | grep -A2 -iE '0x[0-9a-f]{8}|Field|println' || true
nargo test print_hash_values --show-output 2>&1 | sed -n '1,40p'

echo "=== target listing ==="
ls -la target/ 2>/dev/null || echo "no target"
echo "=== DONE-BUILD ==="
