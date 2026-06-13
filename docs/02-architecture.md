# 02 · Architecture

## The one diagram in words
`Borrower data (private) → Confidential AI in TEE (Chainlink) → CRE workflow writes verdict
on-chain → LoanRegistry (the seam) → LoanVault on Arc disburses USDC → IncomeRouter collects
repayment from future income → reputation updates the ERC-8004 passport.` Lenders fund the
TranchePool from any chain via Gateway/CCTP. (An Excalidraw diagram of this flow exists — reuse it
for sponsor submissions that require an architecture diagram.)

## The seam (build this first)
`LoanRegistry` is the contract boundary between the **decision layer** (Chainlink) and the
**money layer** (Arc). Freeze this interface on day one; everything else builds against it.

```solidity
// LoanRegistry.sol  — the single source of truth for loan terms
struct Terms {
    address borrower;     // wallet that receives funds
    bytes32 passportId;   // ERC-8004 identity-bound id (one per human)
    uint256 principal;    // USDC, 6 decimals
    uint16  aprBps;       // e.g. 1000 = 10.00%
    uint8   riskBand;     // 0=A .. n
    bytes32 attestationRef; // ref/hash of the Chainlink confidential attestation
    uint64  expiry;       // terms valid until
    bool    approved;
}

// Only the Chainlink CRE Forwarder may call this (set forwarder in constructor / setter).
function setTerms(Terms calldata t) external onlyForwarder;

function getTerms(address borrower) external view returns (Terms memory);
```

- **Chainlink side** WRITES `setTerms` (via the CRE Forwarder, see docs/04).
- **Arc LoanVault** READS `getTerms` to decide whether/what to disburse.
- This decoupling is why two people/agents can build the halves simultaneously.

## On-chain vs off-chain (the privacy boundary)
| Lives off-chain / in TEE | Lives on-chain |
|---|---|
| Raw income, payout history, financial docs | The attestation verdict only (approved/amount/apr/band/ref) |
| The AI model + inference | The loan terms, balances, repayment state |
| The ZK witness (income figure) | The ZK proof + its on-chain verification result |
| (optional) encrypted docs on Walrus | The ERC-8004 passport + reputation score |

**Rule:** if a value would reveal someone's actual income, it must not be written on-chain.

## Components
- **PassportRegistry (ERC-8004)** — mints one passport per verified human; stores reputation/score;
  exposes "is this human in good standing / what's their limit." Updated by repayment outcomes.
- **LoanRegistry** — the seam (above).
- **LoanVault (Arc)** — holds pooled USDC; on a borrower's claim, checks `getTerms` + a valid
  attestation, then disburses. Tracks per-loan balance + amortization schedule.
- **IncomeRouter (Arc)** — intercepts incoming payouts: deducts the scheduled repayment, forwards
  the remainder to the borrower. (Multi-step settlement.)
- **TranchePool (Arc)** — senior/junior deposit accounting + yield waterfall (see docs/01 math).
- **CRE workflow (Chainlink)** — the underwriting pipeline; calls Confidential AI; writes setTerms.
- **Noir eligibility circuit (ProveKit)** — client-side proof gating underwriting.
- **Frontend** — borrower app, lender "Earn" surface, mock creator-payout dashboard.

## Two user flows (sequence)
**Borrow:** app → World ID verify (mint/lookup passport) → generate Noir eligibility proof in
browser → verify proof on-chain (gate) → CRE workflow triggers → Confidential AI verdict →
`setTerms` written → borrower calls `LoanVault.claim()` → USDC disbursed.

**Repay (auto):** creator platform pays out → `IncomeRouter.onPayout()` splits → repayment to
LoanVault → remainder to borrower → on full repay, PassportRegistry score ↑ and limit ladders up.

**Lend:** lender deposits USDC (any chain → Arc via Gateway/CCTP) → chooses Senior or Junior →
TranchePool credits position → yield accrues from borrower interest per the waterfall →
withdraw routes back to home chain.

## Default handling (state, not narrative)
PassportRegistry tracks loan status. Late → small temporary score penalty (heals on repayment).
Default-then-cure → repay + penalty → partial recovery, re-enter at low limit. Walk away → passport
flagged; locked out until cured; new wallets from the same human map to the same flagged passport.
