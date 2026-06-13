/**
 * CCTP V2 config + helpers for the cross-chain USDC deposit path (Stage 6 — Liquidity Hub).
 *
 * Flow (burn-and-mint, Golden Rule #6 — CCTP **V2**, never V1):
 *   1. approve USDC -> source-chain TokenMessenger
 *   2. TokenMessenger.depositForBurn(...) targeting Arc's CCTP **domain**
 *   3. poll Circle's attestation service for the message + attestation
 *   4. MessageTransmitter.receiveMessage(message, attestation) on Arc to MINT
 *   5. lender then calls TranchePool.deposit on Arc (off-chain, handled by bridge-deposit.ts)
 *
 * Golden Rule #5 — NEVER hardcode contract addresses or domain ids. Everything below is read from
 * ENV. Source each value from:
 *   - Circle MCP server (live addresses + chain ids):  https://api.circle.com/v1/codegen/mcp
 *   - USDC per-chain addresses:        https://developers.circle.com/stablecoins/usdc-contract-addresses
 *   - CCTP contract addresses + domains: https://developers.circle.com/cctp  (TokenMessengerV2 /
 *                                        MessageTransmitterV2 per chain, and the CCTP "domain" table)
 *   - Arc contract addresses:          https://docs.arc.io/arc/references/contract-addresses
 *   - Ethereum -> Arc quickstart:      https://developers.circle.com/cctp/quickstarts/transfer-usdc-ethereum-to-arc
 *
 * Gateway alternative (unified balance, instant <500ms) is NOT implemented here — see CCTP.md.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  isAddress,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "./arc.js";

/** USDC is a 6-decimal ERC-20 everywhere (Golden Rule #4 — do NOT confuse with 18-dec native gas). */
export const USDC_DECIMALS = 6 as const;

/** Circle's testnet attestation service (Iris). Override via CCTP_ATTESTATION_API if needed. */
export const ATTESTATION_API_BASE =
  process.env.CCTP_ATTESTATION_API ?? "https://iris-api-sandbox.circle.com";

// ---------------------------------------------------------------------------------------------
// ABI fragments (minimal — CCTP V2 signatures only)
// ---------------------------------------------------------------------------------------------

/** ERC-20 approve / allowance for granting the TokenMessenger an allowance over the lender's USDC. */
export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/**
 * CCTP **V2** TokenMessenger.depositForBurn — note this is the V2 signature with the two extra
 * args `destinationCaller` and `maxFee`, plus `minFinalityThreshold` (these do NOT exist in V1):
 *
 *   function depositForBurn(
 *     uint256 amount,
 *     uint32  destinationDomain,
 *     bytes32 mintRecipient,
 *     address burnToken,
 *     bytes32 destinationCaller,
 *     uint256 maxFee,
 *     uint32  minFinalityThreshold
 *   ) external returns (uint64 nonce);
 *
 * Source: Circle CCTP docs / Ethereum->Arc quickstart (verify the live signature via the Circle MCP).
 */
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

/** CCTP V2 MessageTransmitter.receiveMessage — mints on the destination chain (Arc). */
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

// ---------------------------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------------------------

/** A required env var was missing. bridge-deposit.ts catches this to print guidance + exit 0. */
export class MissingEnvError extends Error {
  constructor(public readonly vars: string[]) {
    super(`Missing required env: ${vars.join(", ")}`);
    this.name = "MissingEnvError";
  }
}

function requireEnv(name: string, missing: string[]): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    missing.push(name);
    return "";
  }
  return v.trim();
}

function requireAddress(name: string, missing: string[]): Address {
  const v = requireEnv(name, missing);
  if (v && !isAddress(v)) {
    throw new Error(`${name}=${v} is not a valid 0x address (Golden Rule #5 — source it from the Circle MCP / address page).`);
  }
  return v as Address;
}

function requireDomain(name: string, missing: string[]): number {
  const v = requireEnv(name, missing);
  if (!v) return NaN;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name}=${v} is not a valid CCTP domain id (uint32).`);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Typed config
// ---------------------------------------------------------------------------------------------

export interface ChainEndpoints {
  /** Human label for logs. */
  readonly label: string;
  /** CCTP domain id for this chain (Golden Rule #5 — from CCTP docs / Circle MCP, never hardcoded). */
  readonly domain: number;
  /** USDC ERC-20 (6 decimals). */
  readonly usdc: Address;
  /** CCTP V2 TokenMessenger (the depositForBurn target on the SOURCE chain). */
  readonly tokenMessenger: Address;
  /** CCTP V2 MessageTransmitter (the receiveMessage target on the DESTINATION chain). */
  readonly messageTransmitter: Address;
  /** viem Chain (with RPC). */
  readonly chain: Chain;
}

export interface CctpConfig {
  readonly source: ChainEndpoints;
  readonly arc: ChainEndpoints;
  /** Lender's Arc address that receives the minted USDC (mintRecipient). */
  readonly mintRecipient: Address;
  /** Signer for both legs of the demo (architect cross-chain; in prod the two legs can differ). */
  readonly account: ReturnType<typeof privateKeyToAccount>;
}

/**
 * Build the source-chain viem Chain from env. The source chain is generic (any chain a lender holds
 * USDC on); we only need an id + RPC. Arc itself comes from ./arc.ts.
 */
function buildSourceChain(missing: string[]): Chain {
  const rpc = requireEnv("SOURCE_RPC_URL", missing);
  const idRaw = requireEnv("SOURCE_CHAIN_ID", missing);
  const id = Number(idRaw);
  if (idRaw && (!Number.isInteger(id) || id <= 0)) {
    throw new Error(`SOURCE_CHAIN_ID=${idRaw} is not a valid chain id.`);
  }
  return defineChain({
    id: id || 1,
    name: process.env.SOURCE_CHAIN_NAME ?? `source-${id || "?"}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: rpc ? [rpc] : [] } },
  });
}

/**
 * Read + validate every env var required to run the cross-chain deposit. Throws MissingEnvError
 * (listing ALL missing vars at once) if anything is absent — callers turn that into a dry-run notice.
 */
export function loadCctpConfig(): CctpConfig {
  const missing: string[] = [];

  const pk = requireEnv("DEPLOYER_PRIVATE_KEY", missing);

  // Source chain (where the lender's USDC currently lives).
  const sourceChain = buildSourceChain(missing);
  const source: ChainEndpoints = {
    label: sourceChain.name,
    domain: requireDomain("SOURCE_CCTP_DOMAIN", missing),
    usdc: requireAddress("SOURCE_USDC_ADDRESS", missing),
    tokenMessenger: requireAddress("SOURCE_TOKEN_MESSENGER", missing),
    messageTransmitter: requireAddress("SOURCE_MESSAGE_TRANSMITTER", missing),
    chain: sourceChain,
  };

  // Destination = Arc (settlement hub).
  const arc: ChainEndpoints = {
    label: arcTestnet.name,
    domain: requireDomain("ARC_CCTP_DOMAIN", missing),
    usdc: requireAddress("ARC_USDC_ADDRESS", missing),
    // depositForBurn isn't used on Arc here, but a full bridge in either direction needs it.
    tokenMessenger: requireAddress("ARC_TOKEN_MESSENGER", missing),
    messageTransmitter: requireAddress("ARC_MESSAGE_TRANSMITTER", missing),
    chain: arcTestnet,
  };

  const mintRecipient = requireAddress("LENDER_ARC_ADDRESS", missing);

  if (missing.length > 0) {
    throw new MissingEnvError(missing);
  }

  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as Hex,
  );

  return { source, arc, mintRecipient, account };
}

// ---------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------

export function publicClientFor(ep: ChainEndpoints) {
  return createPublicClient({ chain: ep.chain, transport: http() });
}

export function walletClientFor(ep: ChainEndpoints, account: CctpConfig["account"]) {
  return createWalletClient({ chain: ep.chain, transport: http(), account });
}

/** Left-pad an EVM address into a bytes32 (CCTP mintRecipient / destinationCaller encoding). */
export function addressToBytes32(addr: Address): Hex {
  return `0x${addr.toLowerCase().replace(/^0x/, "").padStart(64, "0")}` as Hex;
}

/** bytes32(0) — used for "any caller" on destinationCaller. */
export const BYTES32_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

// ---------------------------------------------------------------------------------------------
// Attestation polling (Circle Iris)
// ---------------------------------------------------------------------------------------------

export interface AttestationResult {
  readonly message: Hex;
  readonly attestation: Hex;
}

/**
 * Poll Circle's attestation service (CCTP V2 messages endpoint) until the burn message is attested.
 *
 * CCTP V2 uses the source DOMAIN + the burn tx hash to look up messages:
 *   GET {base}/v2/messages/{sourceDomain}?transactionHash={burnTxHash}
 * The response holds { messages: [{ message, attestation, status }] }; status "complete" means the
 * `attestation` is ready to pass to receiveMessage. (V1 used /v1/attestations/{messageHash} — we are
 * on V2 per Golden Rule #6.)
 *
 * Docs: https://developers.circle.com/cctp  (Standard vs Fast Transfer + attestation lifecycle)
 */
export async function pollAttestation(
  sourceDomain: number,
  burnTxHash: Hex,
  opts: { intervalMs?: number; timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<AttestationResult> {
  const intervalMs = opts.intervalMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000; // V2 standard transfers can take a while on testnet
  const log = opts.log ?? (() => {});
  const url = `${ATTESTATION_API_BASE}/v2/messages/${sourceDomain}?transactionHash=${burnTxHash}`;

  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as {
          messages?: Array<{ message?: Hex; attestation?: Hex; status?: string }>;
        };
        const m = body.messages?.[0];
        if (m?.status === "complete" && m.message && m.attestation && m.attestation !== "0x") {
          log(`Attestation ready after ${attempt} poll(s).`);
          return { message: m.message, attestation: m.attestation };
        }
        log(`Attempt ${attempt}: status=${m?.status ?? "pending"} — waiting ${intervalMs}ms…`);
      } else if (res.status === 404) {
        log(`Attempt ${attempt}: message not indexed yet (404) — waiting ${intervalMs}ms…`);
      } else {
        log(`Attempt ${attempt}: attestation API returned ${res.status} — retrying…`);
      }
    } catch (e) {
      log(`Attempt ${attempt}: attestation poll error (${(e as Error).message}) — retrying…`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Attestation not ready within ${timeoutMs}ms for burn tx ${burnTxHash}.`);
}
