# 05 · World Integration (identity + ZK)

Two core tracks here: **World ID** (Track B) and **ProveKit** (Track D). Both are load-bearing —
World ID is the anti-respawn spine; the Noir proof is the privacy gate before underwriting.

## World ID (Track B — $2,500)
**Why it's load-bearing:** without proof-of-human, defaulters respawn with new wallets and the whole
lending model collapses. This is the textbook "product breaks without proof of human" case.

What to build:
- Verify with **World ID 4.0** at onboarding using **IDKit** on the frontend.
- **Validate the proof in a smart contract** (the track explicitly requires backend or on-chain
  validation — do NOT validate only client-side). The World ID contract verifies the zero-knowledge
  proof and the nullifier.
- Use the **nullifier hash** as the one-human key: it maps a verified human to exactly one
  `PassportRegistry` passport. A second wallet from the same human resolves to the same passport
  (and the same standing/flag).
- Pick an `action` id for "mint/bind credit passport" so the nullifier is scoped to our app.

Flow: frontend IDKit widget → get proof → call `PassportRegistry.verifyAndMint(signal, root,
nullifierHash, proof)` → contract calls the World ID verifier → on success, mint/lookup passport.

**Demo money-shot:** a "defaulter" opens a fresh wallet, tries to borrow, and is rejected live —
visible sybil resistance.

Links:
- World ID docs: https://docs.world.org/world-id/overview
- IDKit example: https://idkit-js-example.vercel.app/

## ProveKit / Noir (Track D — $2,500)
**Why it's load-bearing (and distinct from the Confidential AI):** the borrower **asserts** a fact
they can prove (income ≥ threshold, not on a default list) without revealing the figure; the
Confidential AI is an independent **judgment** on data they can't self-attest. Self-sovereign claim
+ independent assessment — complementary, not redundant.

What to build (`/circuits`):
- A **Noir** eligibility circuit proving something like
  `monthly_income >= threshold AND not_on_default_list`, taking a signed income credential as a
  private input and the threshold as a public input.
- **Compile the circuit to R1CS**, generate a **WHIR or Groth16 proof client-side** (in the
  borrower's browser), and **verify it in at least one target environment** — our backend or
  on-chain via a verifier contract. (These three are the explicit track requirements.)
- Wire it as the **gate before underwriting**: `LoanRegistry`/the CRE trigger only proceeds if the
  proof verified.

**Demo money-shot:** generate the proof live in-browser; show the gate open and the income figure
never leaving the device.

Links:
- ProveKit: https://provekit.org/
- ProveKit docs: https://docs.provekit.atheon.xyz/
- Benchmarks/examples: https://provekit.atheon.xyz/benchmarks/

## AgentKit (Track A — $7,500, STRETCH only)
Not a natural fit for credit on its own; include only if ahead of schedule and a teammate owns it.
Angle: give each borrower a **credit agent** (human-backed via **Delegated World ID**) that watches
income and files repayments; give every newly verified human **one free AI credit assessment** as
the "trial / initial usage" mechanic the track requires. This agent also pairs with Arc's Agentic
Economy stretch (it pays per inference via x402). Build B and D first.
- AgentKit docs: https://docs.world.org/agents/agent-kit

## Env (add to `.env`)
```
WORLD_APP_ID=
WORLD_ACTION_ID=          # e.g. "mint-credit-passport"
WORLD_ID_VERIFIER_ADDRESS= # on-chain verifier used by PassportRegistry
```
