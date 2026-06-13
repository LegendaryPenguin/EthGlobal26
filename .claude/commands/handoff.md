---
description: Load the Vouch project handoff — current state, architecture, how to build/test/run, and what's next.
---

You are picking up the **Vouch** project (a credit-passport protocol) in this repo. Get oriented from
the stored handoff before doing anything else.

1. Read `HANDOFF.md` in the repo root **in full**. It is the shared, maintained source of truth for
   project state, architecture, conventions, how to build/test/run, and what's blocked.
2. Skim `CLAUDE.md` (the golden rules — do not violate) and `README.md`.
3. If the user named a specific area, also read the relevant `docs/0X-*.md` and the files HANDOFF
   points to (e.g. the frozen seam `contracts/src/interfaces/ILoanRegistry.sol`).

Then give a concise orientation (do NOT start changing code yet):
- one line on what Vouch is,
- which build stages are done + the latest test counts (contracts / Noir / CRE / frontend),
- what's currently blocked or needs credentials,
- the top 2–3 sensible next actions.

Honor the repo conventions from HANDOFF/CLAUDE — especially: **commits carry no AI attribution**,
Arc is **testnet-only (chain 5042002)**, USDC is **6 decimals**, never hardcode addresses, and never
modify the frozen `LoanRegistry` seam without a coordinated re-freeze.

If `HANDOFF.md` is missing, say so and fall back to `README.md` + `docs/`, then offer to regenerate
the handoff. If the user passed arguments ($ARGUMENTS), focus the orientation on that area.
