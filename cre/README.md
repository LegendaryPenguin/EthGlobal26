# /cre — Chainlink CRE workflow (the decision layer)

Stage 3. The underwriting spine: **HTTP trigger → Confidential HTTP to the Confidential AI
sandbox → DON consensus → EVM Write `LoanRegistry.setTerms(Terms)` through the Forwarder.**
It never touches the money. See `docs/04-chainlink-integration.md`.

## Covers two tracks from one workflow
- **Best CRE workflow** — the trigger → callback → write pipeline.
- **Confidential AI Attester** — ≥1 real confidential inference over sample payout data; the
  `LoanVault` consumes the resulting `attestationRef`.
- (Bonus) **Connect the World** — a price/FX feed read *inside* the rate contract (on-chain
  state change), not in the frontend.

## Build notes
- Write the workflow in the **CRE TypeScript SDK**, compile with the **CRE CLI**.
- A successful **simulation** qualifies for the track — the Chainlink team deploys it live during
  the event. Don't burn time fighting deploy access (docs/04).
- After deploy/sim, take the resulting **Forwarder address** and call
  `LoanRegistry.setForwarder(forwarder)` so the seam trusts it.
- CRE callbacks are **stateless**; pass state via the trigger payload / on-chain reads.
- Keep all sensitive data inside the Confidential HTTP path — never log it, never write it
  on-chain (Golden Rule #2).

## The contract it writes
`LoanRegistry.setTerms((address,bytes32,uint256,uint16,uint8,bytes32,uint64,bool))` —
frozen ABI lives in `contracts/src/interfaces/ILoanRegistry.sol`. Build the report encoding
against that struct exactly. A mirror of that ABI lives in `src/abi.ts`.

## What's in here (Stage 3 scaffold)
This is a **runnable local simulation** of the workflow. The CRE CLI and the live Confidential AI
endpoint are NOT used here — a deterministic **mock attester** stands in so the whole pipeline runs
and is tested offline. Files:
- `src/types.ts` — `IncomePayload` (private, never leaves the layer), `UnderwritingResult`, `Terms`.
- `src/underwrite.ts` — `confidentialUnderwrite(payload)` = the mock Confidential-AI call. Pure risk
  policy in `evaluatePolicy` + a keccak256 `attestationRef` over the **verdict** (not the income).
- `src/abi.ts` — frozen `setTerms`/`getTerms` ABI.
- `src/buildReport.ts` — `Terms` struct + `encodeSetTerms` (viem `encodeFunctionData`) = the calldata
  the EVM-Write capability submits through the Forwarder.
- `src/workflow.ts` — trigger → underwrite → buildReport, each step annotated with the real CRE
  capability it replaces.
- `src/sim.ts` — the `npm run sim` demo (two applicants: one approved, one declined).
- `test/` — `node --test` suites: `policy` (verdict correctness), `encoding` (calldata round-trip
  vs the ABI), `privacy` (the income payload never leaks to any log/output/calldata).

### Risk policy (mock attester)
Decline gates: history `< 3 months`, or DTI `> 0.45`. Otherwise a `riskBand` 0–4 (A–E) is derived
from DTI, history depth, and income volatility; APR is `[8, 12, 18, 26, 36]%` by band. Principal is
capped at `min(requested, 6 × avg monthly income)` and tightened for worse bands. Declines write
`approved = false` (the LoanVault disburses nothing).

### How the income payload is kept private
- Only `confidentialUnderwrite` reads raw income; it returns the verdict only (no raw figures).
- `attestationRef` is a hash over the **verdict + passportId**, never over the income.
- `Terms`/calldata carry only the verdict. `test/privacy.test.ts` captures every console channel and
  asserts the raw payload never appears in any output, the workflow result, or the on-chain calldata.

## Run the simulation
```
cd cre
npm install
npm test        # node --test: policy + encoding + privacy (19 tests)
npm run sim     # prints each verdict + the setTerms calldata that would go through the Forwarder
npm run typecheck
```
Node 22+ (uses `--experimental-strip-types` to run TS directly; no build step needed for the sim).

## Swap for the live CRE run
Replace the mock with the real capabilities (grep for the `REAL:` markers in `src/`):

| Sim (now) | Live CRE run |
| --- | --- |
| `confidentialUnderwrite` runs `evaluatePolicy` locally | CRE **Confidential HTTP** POST of the payload to `CONFIDENTIAL_AI_API_URL` (auth `CONFIDENTIAL_AI_API_KEY`), inside the TEE; parse the attested verdict + real `attestationRef` from the response |
| single executor, consensus is a no-op | DON **BFT consensus** on the returned verdict (runtime-handled) |
| `buildReport` returns calldata; `sim.ts` just prints it | CRE **EVM Write**: wrap `calldata` in a DON-signed report and submit to `LOAN_REGISTRY_ADDRESS` **through `CRE_FORWARDER_ADDRESS`** |
| `onApplication` called directly | register against the CRE **HTTP trigger** (`cre.on(cre.triggers.http(...))`) — see the sketch at the bottom of `src/workflow.ts` |
| run with `node`/`npm` | compile + simulate with the **CRE CLI**, then the Chainlink team deploys the simulated workflow live |

Required env for the live run (already documented in `docs/04` and the root `.env.example`):
```
CONFIDENTIAL_AI_API_URL=     # sandbox endpoint from the Confidential AI track
CONFIDENTIAL_AI_API_KEY=
LOAN_REGISTRY_ADDRESS=       # deployed on Arc; the EVM-Write target
CRE_FORWARDER_ADDRESS=       # the Forwarder; call LoanRegistry.setForwarder(it) so the seam trusts it
```
After the sim/deploy yields the **Forwarder address**, call `LoanRegistry.setForwarder(forwarder)`
so on-chain writes are accepted.

## Links
- CRE docs: https://docs.chain.link/cre
- Confidential HTTP (TS): https://docs.chain.link/cre/capabilities/confidential-http-ts
- CRE templates: https://github.com/smartcontractkit/cre-templates
