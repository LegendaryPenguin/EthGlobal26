# 04 · Chainlink Integration (the decision layer)

Chainlink's only job: take the borrower's private income, get a trustworthy verdict from the AI,
and write that verdict on-chain so the Arc contracts can trust it. **It never touches the money.**
One CRE workflow is the spine and covers two prize tracks; a price-feed read adds a third.

## What CRE is (mental model)
Chainlink Runtime Environment (CRE) is an orchestration layer. You write a **Workflow** in the CRE
**TypeScript or Go SDK**, compile it with the **CRE CLI**, and run it on a Decentralized Oracle
Network (DON). A workflow is **trigger → callback**: a trigger fires, your callback runs logic and
invokes **capabilities**, the DON reaches **BFT consensus** on every capability result, and the
workflow can **write on-chain** via a signed report through a Forwarder.

Capabilities we use:
- **Confidential HTTP** — call an external API with sensitive data without exposing it on public
  nodes. This is how we reach the Confidential AI inference endpoint.
- **EVM Write** — produce a signed report and write it on-chain through the **Forwarder** into a
  consumer contract. This is how the verdict reaches `LoanRegistry.setTerms`.
- **Triggers** — HTTP trigger (borrower applies) or EVM-log trigger (on an `Applied` event).
- (optional) **HTTP / Data feeds** for the price-feed read.

**Hackathon shortcut:** a successful **simulation** via the CRE CLI qualifies for the track, and the
Chainlink team will deploy your simulated workflow to the live network for you during the event.
Simulation makes real API + real public-EVM calls, so you can demo end-to-end. Do not burn time
fighting deploy access.

## Our workflow (`/cre`)
1. **Trigger** — HTTP trigger when a borrower submits an application (or EVM-log on `Applied`).
2. **Confidential HTTP** — POST the borrower's income payload to the Confidential AI inference API
   (sandbox). Inputs are real financial data; they never hit a public node.
3. **Consensus** — the DON agrees on the attested result (approve/amount/apr/band + attestationRef).
4. **EVM Write** — build a signed report and write `LoanRegistry.setTerms(Terms)` through the
   Forwarder. `LoanRegistry` must trust the Forwarder address (set in constructor/setter).
Result: no workflow → no loan. That is "meaningfully used," verbatim to the rubric.

## Confidential AI Attester (same workflow = second track)
- Use the provided **Confidential AI inference APIs**; submit ≥1 confidential inference in the
  sandbox over **real sensitive inputs** (payout history / financial docs).
- Our `LoanRegistry`/`LoanVault` **consumes the attestation** (`attestationRef` + verification)
  before disbursing.
- Make the "private input → on-chain verdict" real, not a toy boolean. Chainlink's own workshop for
  this track is an undercollateralized lending app — we are building exactly that.

## Connect the World (bonus, third track)
A Chainlink data feed must cause an **on-chain state change** (reading in a frontend doesn't count).
Our rate logic reads a **Price Feed / Data Stream** (a benchmark or FX rate, useful for localized
loans in EURC) **inside the contract** when finalizing the APR — a real state change. With CRE +
Confidential AI + a feed, that's three Chainlink services used meaningfully (bonus points).

## Boundaries / gotchas
- CRE callbacks are **stateless** — pass state via the trigger payload or on-chain reads; don't
  assume persistence between executions.
- On-chain writes go through **reports + a Forwarder-trusted consumer contract** — budget time for
  report/struct encoding and wiring the Forwarder address into `LoanRegistry`.
- Keep all sensitive data inside the Confidential HTTP path; never log it or write it on-chain.
- We move cross-chain **money** with Circle's CCTP/Gateway, **not** Chainlink CCIP — keeps each
  sponsor's track clean and unambiguous.

## Env (add to `.env`)
```
CRE_WORKFLOW_NAME=vouch-underwriter
CONFIDENTIAL_AI_API_URL=     # sandbox endpoint from the Chainlink Confidential AI track
CONFIDENTIAL_AI_API_KEY=
LOAN_REGISTRY_ADDRESS=       # deployed on Arc
CRE_FORWARDER_ADDRESS=       # set as authorized writer on LoanRegistry
```

## Links to fetch as needed
- CRE docs: https://docs.chain.link/cre
- Confidential HTTP (TS): https://docs.chain.link/cre/capabilities/confidential-http-ts
- CRE templates repo: https://github.com/smartcontractkit/cre-templates
- Compliant Private Transfer demo (pattern reference): https://github.com/smartcontractkit/Compliant-Private-Transfer-Demo
- Chainlink docs root: https://docs.chain.link
