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
against that struct exactly.

## Links
- CRE docs: https://docs.chain.link/cre
- Confidential HTTP (TS): https://docs.chain.link/cre/capabilities/confidential-http-ts
- CRE templates: https://github.com/smartcontractkit/cre-templates
