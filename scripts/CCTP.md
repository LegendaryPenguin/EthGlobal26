# Cross-chain USDC deposit (CCTP V2) — Liquidity Hub track

Lenders' USDC lives on other chains; **Arc is the settlement hub**. This path bridges that USDC to
Arc so it can fund the Vouch `TranchePool`.

- `cctp.ts` — config + helpers: per-chain endpoints from ENV, CCTP V2 ABI fragments, attestation
  polling against Circle's Iris service. Throws a clear `MissingEnvError` if required env is absent.
- `bridge-deposit.ts` — runnable end-to-end script: approve -> depositForBurn -> poll attestation ->
  receiveMessage (mint on Arc) -> log "now call TranchePool.deposit on Arc".

Run: `npm run bridge-deposit`. With **no env set** it prints the env checklist and **exits 0** — no
keys, no funds, no chain calls. Safe to run dry, safe for `tsc --noEmit`.

## Golden rules honored
- **#6 CCTP V2, not V1.** Uses the V2 `depositForBurn` signature and the V2 `/v2/messages` attestation
  endpoint. V1's `/v1/attestations/{messageHash}` is *not* used.
- **#5 Never hardcode addresses/domains.** Every address + domain id comes from ENV (comments point at
  the Circle MCP server + the per-chain address pages).
- **#4 Decimals.** USDC is 6-decimal everywhere (`parseUnits/formatUnits(…, 6)`); never confused with
  Arc's 18-decimal native gas token.
- **#7 Architect cross-chain, demo single-chain.** The script is real and runnable, but the live demo
  runs natively on Arc — keep this bridge off the critical path (pre-funded wallet or a short clip;
  testnet bridges are slow/flaky).

## CCTP V2 burn-and-mint flow
1. **approve** USDC -> source-chain **TokenMessenger** (V2).
2. **depositForBurn** on the source TokenMessenger, targeting **Arc's CCTP domain**, with the lender's
   Arc address (as `bytes32`) as `mintRecipient`. This burns USDC on the source chain.
3. **poll Circle's attestation service** (Iris) by source domain + burn tx hash until `status:
   complete`, yielding `{ message, attestation }`.
4. **receiveMessage(message, attestation)** on **Arc's MessageTransmitter** (V2) — mints USDC on Arc.
5. Lender then calls **`TranchePool.deposit`** on Arc with the minted USDC.

CCTP V2 `depositForBurn` signature used:
```
depositForBurn(
  uint256 amount,
  uint32  destinationDomain,
  bytes32 mintRecipient,
  address burnToken,
  bytes32 destinationCaller,   // V2-only — bytes32(0) = any caller
  uint256 maxFee,              // V2-only — fee cap for the transfer
  uint32  minFinalityThreshold // V2-only — 2000 = Standard, lower = Fast Transfer
) returns (uint64 nonce)
```

## Required ENV (source each value — never hardcode)
| Var | What | Where to source it |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY` | signer (TESTNET key only) | local `.env` |
| `AMOUNT_USDC` | amount to bridge, human units (default `1`) | — |
| `SOURCE_RPC_URL` | source-chain RPC | your provider |
| `SOURCE_CHAIN_ID` | source chain id (e.g. `11155111` Sepolia) | — |
| `SOURCE_CHAIN_NAME` | optional label | — |
| `SOURCE_CCTP_DOMAIN` | source CCTP domain id | https://developers.circle.com/cctp |
| `SOURCE_USDC_ADDRESS` | source USDC ERC-20 | https://developers.circle.com/stablecoins/usdc-contract-addresses |
| `SOURCE_TOKEN_MESSENGER` | source CCTP **V2** TokenMessenger | https://developers.circle.com/cctp |
| `SOURCE_MESSAGE_TRANSMITTER` | source CCTP **V2** MessageTransmitter | https://developers.circle.com/cctp |
| `ARC_CCTP_DOMAIN` | Arc CCTP domain id | https://developers.circle.com/cctp |
| `ARC_USDC_ADDRESS` | Arc USDC | https://docs.arc.io/arc/references/contract-addresses |
| `ARC_TOKEN_MESSENGER` | Arc CCTP **V2** TokenMessenger | https://docs.arc.io/arc/references/contract-addresses |
| `ARC_MESSAGE_TRANSMITTER` | Arc CCTP **V2** MessageTransmitter | https://docs.arc.io/arc/references/contract-addresses |
| `ARC_RPC_URL` | optional Arc RPC override | else viem's built-in Arc Testnet RPC |
| `LENDER_ARC_ADDRESS` | Arc address receiving minted USDC (`mintRecipient`) | — |
| `CCTP_MAX_FEE` | optional fee cap (human USDC); default ≈1bps of amount | — |
| `CCTP_MIN_FINALITY_THRESHOLD` | optional; `2000`=Standard (default), lower=Fast | https://developers.circle.com/cctp |
| `CCTP_ATTESTATION_API` | optional Iris base; default sandbox | https://developers.circle.com/cctp |

> The **Circle MCP server** (`https://api.circle.com/v1/codegen/mcp`) returns live addresses, chain
> ids and CCTP domains — prefer it. Ready quickstart: **Ethereum → Arc** at
> `https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc`.

## Alternative: Circle Gateway (unified balance)
Instead of an explicit burn-and-mint per transfer, **Gateway** gives lenders a single **unified USDC
balance** spendable across chains, with **instant (<500ms)** transfers — no per-transfer attestation
wait. A lender deposits USDC anywhere, it joins one balance, and that balance funds the Arc pool
directly. This is the recommended approach for the "single spendable balance" UX; CCTP V2 here is the
explicit burn-and-mint variant. We do not implement Gateway in these scripts.

- Docs: https://developers.circle.com/gateway
- Unified-balance EVM quickstart: https://developers.circle.com/gateway/quickstarts/unified-balance-evm
- Circle skill: `use-gateway`

**Demo note (Golden Rule #7):** run the live demo natively on Arc; show the cross-chain deposit via a
pre-funded balance or a short recording. Keep the bridge off the live critical path.
