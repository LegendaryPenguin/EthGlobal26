# ZK Eligibility Demo — Frontend Handoff

How to make the in-browser Noir/UltraHonk eligibility proof **visibly work** on the deployed
frontend, so a demo audience watches the circuit run, verify, and reject a forgery on screen.

> TL;DR: the proof runs client-side in `BorrowFlow` Step 1. It already works. To make it *fast and
> smooth* when deployed, you must serve two cross-origin isolation headers (COOP/COEP) so bb.js can
> use multi-threaded WASM. Everything else is already wired.

---

## 1. What the demo shows

In the borrow flow (the `#get` section), **Step 1 · Prove eligibility privately**:

1. Click **Prove eligibility** → runs the real Noir circuit through the UltraHonk prover in the
   browser. The monthly income is a **private witness** — it never enters React state, the network,
   or any log.
2. A proof panel appears showing:
   - **🔒 Private** (income, blinding, secret) shown as `•••••` — "never sent".
   - **🌐 Public** — the only values shared: `threshold`, `default-list root`, `income commitment`,
     `nullifier`. Caption: *"there is no income figure here."*
   - The **real proof artifact** (size in KB + truncated hex).
3. **Verify proof** → runs the same UltraHonk verifier the backend / on-chain gate uses → **✓ Verified**.
4. **Try to forge it** → flips one byte of the proof and re-verifies → **✗ Rejected — unforgeable**.

That accept-truth / reject-forgery pair is the proof that the proof *means something*.

---

## 2. Files involved

| File | Role |
| --- | --- |
| `app/src/zk/eligibility.ts` | `proveEligibility()` (in-browser proof), `verifyEligibilityProof()`, `tamperProofHex()`. Income witness lives here and never leaves. |
| `app/src/hooks/useProveEligibility.ts` | React hook: `prove`, `verify`, `forge` + status/verdict state. |
| `app/src/components/BorrowFlow.tsx` | `ZkProofPanel` (the visible demo panel) + 2-step gate UI. |
| `app/src/styles.css` | `.zk-*` styles + `.btn--danger`. |
| `app/public/vouch_eligibility.json` | Compiled circuit artifact the browser fetches. **Must be present.** |
| `app/server/verifyEligibility.ts` | Server-side gate (policy re-bind + nullifier replay) used by `/api/world/signin`. |

If `app/public/vouch_eligibility.json` is missing, regenerate it from `circuits/` (see
`circuits/ZK-RESEARCH.md`) and copy it in:

```bash
# from repo root, after compiling the circuit
cp circuits/target/vouch_eligibility.json app/public/vouch_eligibility.json
```

---

## 3. Run it locally

```bash
cd app
npm install
npm run dev
```

Open the printed URL and scroll to / click the **Get advance** (`#get`) section, then click
**Prove eligibility**.

Env (`app/.env.local`) — only needed for the full World ID sign-in, NOT for the ZK panel:

```
VITE_WORLD_APP_ID=app_xxxxxxxxxxxxxxxx   # required only to show Step 2 (sign-in)
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
```

The ZK proof panel (prove / verify / forge) works **without** any env vars.

---

## 4. Make proving FAST on the deployed site (important)

bb.js proves much faster with multi-threaded WASM, which the browser only allows when the page is
**cross-origin isolated**. That requires these response headers on the HTML/asset responses:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them: proving still works but is single-threaded (~45s). With them: a few seconds.

> ⚠️ Trade-off: COEP `require-corp` can break third-party embeds that don't send CORP/CORS headers.
> The World ID `IDKitSessionWidget` is the one to watch. Test sign-in after enabling. If the widget
> breaks, either (a) keep headers off and pre-click "Prove eligibility" before narrating, or
> (b) scope the headers to only the route(s) that prove. For most demos, pre-clicking is the safest.

### Vercel — `vercel.json`

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

### Netlify — `public/_headers` (or `netlify.toml`)

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### Cloudflare Pages — `public/_headers`

Same syntax as Netlify above.

### Local Vite (already supported)

To preview the fast path locally, add to `app/vite.config.ts` under `server` (and `preview`):

```ts
server: {
  headers: {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  },
},
```

(Leave this OUT of the committed config if it interferes with World ID locally; add it only when
demoing the proof speed.)

---

## 5. Build & deploy

```bash
cd app
npm run build      # outputs dist/
```

Deploy `app/dist/` to your host. Ensure:

1. `vouch_eligibility.json` is served at the site root (it lives in `public/`, so Vite copies it).
2. The COOP/COEP headers above are configured (for fast proving).
3. WASM is served with `Content-Type: application/wasm` (Vercel/Netlify do this automatically).

---

## 6. Demo script (30 seconds)

1. Click **Prove eligibility** → "this generates a real zero-knowledge proof in my browser, now."
2. Point at the two columns → "my income never left the device — only these public values did, and
   none of them is my income."
3. Click **Verify proof** → "✓ the verifier accepts it."
4. Click **Try to forge it** → "✗ I tampered one byte and it's instantly rejected — unforgeable."

Pro tip: if headers aren't enabled, click **Prove eligibility** ~45s before you start narrating so
the panel is already up; verify/forge are fast regardless.

---

## 7. Honest caveats (for Q&A)

- **Fixed demo witness.** The browser proves against a fixed, issuer-published income credential
  (commitment `INCOME_COMMITMENT`). The privacy property — income is a private witness — is real
  regardless. Productionising means deriving the commitment from a signed credential for the
  borrower's real figure. See `circuits/ZK-RESEARCH.md` and `TODO(credential)` in
  `circuits/src/main.nr`.
- **Proving speed** depends on the COOP/COEP headers (above).
- The same proof is verified three ways in this repo: in-browser (this panel), server-side
  (`app/server/verifyEligibility.ts`), and on-chain (`contracts/src/EligibilityGate.sol` +
  `HonkVerifier.sol`, tested in `contracts/test/EligibilityGate.t.sol`).
