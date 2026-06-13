// CCTP V2 (burn-and-mint) config + helpers for the real cross-chain deposit. Mirrors
// scripts/cctp.ts. USDC = 6 decimals. Domains/addresses from Circle CCTP docs (verified live
// on Eth Sepolia, Base Sepolia, Arc 2026-06-13). (docs/03, Golden Rule #6 — V2 not V1.)
import type { Hex } from "viem";
import type { ChainId } from "../data/mock";

// CCTP domain ids.
export const CCTP_DOMAIN: Partial<Record<ChainId, number>> = {
  ethereum: 0, // Eth Sepolia
  base: 6, // Base Sepolia
  arc: 26, // Arc Testnet (destination)
};

// CCTP V2 contracts. TokenMessengerV2 shares one address across these testnets; receiveMessage
// (mint) happens on Arc's MessageTransmitterV2.
export const TOKEN_MESSENGER_V2 = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as const;
export const MESSAGE_TRANSMITTER_V2_ARC = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;

export const BYTES32_ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

export function addressToBytes32(addr: string): Hex {
  return `0x${addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as Hex;
}

export const tokenMessengerV2Abi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

export const messageTransmitterV2Abi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// Fast Transfer: low finality threshold so attestation lands in ~15-30s on testnet.
export const MIN_FINALITY_THRESHOLD_FAST = 1000;

export interface Attestation {
  message: Hex;
  attestation: Hex;
}

// Poll Circle's Iris attestation service via the Vite /iris proxy. (V2 messages endpoint.)
export async function pollAttestation(
  sourceDomain: number,
  burnTxHash: Hex,
  opts: { intervalMs?: number; timeoutMs?: number; onTick?: (msg: string) => void } = {},
): Promise<Attestation> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const url = `/iris/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { messages?: Array<{ message?: Hex; attestation?: Hex; status?: string }> };
        const m = body.messages?.[0];
        if (m?.status === "complete" && m.message && m.attestation && m.attestation !== "0x") {
          return { message: m.message, attestation: m.attestation };
        }
        opts.onTick?.(`attestation ${m?.status ?? "pending"} (poll ${attempt})`);
      } else if (res.status === 404) {
        opts.onTick?.(`indexing burn… (poll ${attempt})`);
      }
    } catch {
      opts.onTick?.(`retrying… (poll ${attempt})`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Attestation not ready in time (testnet). Try again or use the Arc path.");
}
