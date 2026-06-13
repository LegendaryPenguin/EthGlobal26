# Vouch — Go live on Arc Testnet (2 links, pool-connected, many humans)

Testnet only (chain `5042002`, never mainnet). Two public surfaces, connected by the pool: the
**borrower** app (identity-first, World ID → managed wallet → claim) and the **lender** app
(MetaMask → fund Senior/Junior tranche). Borrower loans disburse from the lender pool capital.

## What only you can provide (the live blockers)
1. **Funded Arc deployer key** — a private key with testnet USDC from <https://faucet.circle.com>
   (pays gas + seeds the pool). → `DEPLOYER_PRIVATE_KEY`.
2. **Real Arc USDC address** — from the Circle MCP server / address page → `USDC_ADDRESS`
   (never hardcode, Golden Rule #5).
3. **World ID production app** — from the World developer portal: `WORLD_APP_ID`, `WORLD_RP_ID`,
   and the RP signing key `WORLD_RP_SIGNING_KEY` (server-side only).
4. **A relayer key** funded with Arc gas — mints passports, writes `setTerms`, funds each human's
   managed wallet → `RELAYER_PRIVATE_KEY`; its address = `REGISTRY_FORWARDER`.
5. **A host** for the two links (below).

## Step 1 — deploy + seed the pool (contracts)
```bash
export DEPLOYER_PRIVATE_KEY=0x...      # funded with testnet USDC
export USDC_ADDRESS=0x...              # real Arc USDC
export WORLD_APP_ID=app_...            # World portal
export WORLD_RP_ID=...                 # World RP id
export REGISTRY_FORWARDER=0x...        # the relayer's address (defaults to deployer)
# optional pool seed sizes (6-dp): defaults $800 senior / $200 junior / $500 deployed to vault
scripts/deploy-arc.sh
```
This deploys all contracts, **seeds the TranchePool and deploys that capital into the LoanVault**
(so loans are funded by the pool), and writes `app/.env.production` + `metamask-lender/.env.production`.

## Step 2 — host the two links (Vercel — recommended)

Two Vercel projects from this one repo (set each project's **Root Directory** in the dashboard):

**Borrower** — Root Directory `app`. Vercel auto-detects Vite; `app/api/world/*.ts` deploy as
serverless functions (the World ID + relayer endpoints — config in `app/vercel.json`). Set env vars
in the Vercel project (Settings → Environment Variables):
- Public (inlined at build): `VITE_WORLD_APP_ID`, `VITE_WORLD_RP_ID`, `VITE_WORLD_ACTION_ID`,
  `VITE_ARC_RPC_URL`, `VITE_USDC_ADDRESS`, `VITE_LOAN_REGISTRY_ADDRESS`, `VITE_LOAN_VAULT_ADDRESS`,
  `VITE_INCOME_ROUTER_ADDRESS`, `VITE_TRANCHE_POOL_ADDRESS`, `VITE_PASSPORT_REGISTRY_ADDRESS`
- Secret (runtime only — NOT `VITE_`, so never bundled into the browser): `WORLD_RP_SIGNING_KEY`,
  `RELAYER_PRIVATE_KEY` (the relayer must be the LoanRegistry forwarder AND funded with Arc gas).
- Copy these from your local `app/.env.local` (already filled in).

**Lender** — Root Directory `metamask-lender`. Pure static Vite (`metamask-lender/vercel.json`). Env
(optional — it has live-Arc fallbacks baked in): `VITE_ARC_RPC_URL`, `VITE_TRANCHE_POOL_ADDRESS`,
`VITE_USDC_ADDRESS`.

That's your two public links. Pushes to the repo auto-deploy (preview per branch, prod on the
default branch) — easy to iterate. The contracts are already live, so the links work immediately.

> The same handlers also run under `vite dev` (local) and the host-agnostic `npm run serve` — so you
> can develop locally and ship to Vercel with no code change (`readJson` accepts both raw + parsed bodies).

## Step 2b — alternative hosts
- **Borrower** (`app/`) needs a **Node host** (Render / Railway / Fly / a VM) because the World ID +
  relayer logic runs server-side:
  ```bash
  cd app
  # app/.env.local (server secrets, NOT committed):
  #   WORLD_RP_SIGNING_KEY=...      RELAYER_PRIVATE_KEY=0x...   (RELAYER == REGISTRY_FORWARDER, funded)
  npm ci && npm run build && npm run serve      # serves SPA + /api/world/* on $PORT (default 8080)
  ```
  Point your host at `npm run serve` (the host-agnostic server in `app/server/standalone.ts`).
- **Lender** (`metamask-lender/`) is **static** — deploy `dist/` to any static host
  (Vercel/Netlify/Cloudflare Pages/GitHub Pages):
  ```bash
  cd metamask-lender && npm ci && npm run build   # publish dist/
  ```

## Step 3 — onboard many humans
Each World ID sign-in provisions its **own custodial managed wallet** (derived from the session
nullifier + server secret), mints a passport, and gets terms — no MetaMask, no per-user setup. To
keep onboarding flowing, keep funded:
- the **relayer** (Arc gas — it pays for every mint / setTerms / wallet top-up), and
- the **pool** (USDC — every claim disburses from it; top up via the lender app or
  `TranchePool.deposit` + `deployToVault`).
A locked-out human (prior default) is rejected on re-onboard — anti-respawn by design.

## Verify it's real (judge evidence)
Every action emits a real Arc tx; the borrower app's **On-chain receipts** panel and the lender
app's Activity both link hashes to `https://testnet.arcscan.app/tx/…`. Reproduce the full loop
locally first with `scripts/demo-local.sh` (then `cast receipt <hash>`), or `scripts/devnet.sh`
for a clickable local devnet.

## Still mock (improve later)
Real income ingestion + Confidential AI TEE encryption (Base64-mocked; beta API lacks `/v1/key`),
the in-browser ZK gate (see `circuits/ZK-RESEARCH.md` — bb.js UltraHonk plan), and the production
CRE-DON deploy.
