/**
 * Stage 6 — Cross-chain USDC deposit path (Liquidity Hub track).
 *
 * End-to-end CCTP **V2** burn-and-mint: bridges a lender's USDC from a source chain to Arc (the
 * settlement hub), so it can fund the Vouch TranchePool. (Golden Rule #6 — CCTP V2, not V1.)
 *
 * Architect cross-chain, demo single-chain (Golden Rule #7): this script is fully runnable, but the
 * live demo runs natively on Arc — keep this bridge OFF the critical path (pre-funded wallet / clip).
 *
 * SAFE TO RUN DRY: with no env set it prints exactly which env vars are needed and exits 0 (no throw,
 * no funds, no keys). It only touches the chain once every required var is present.
 *
 *   # dry run — just prints the env checklist:
 *   npm run bridge-deposit
 *
 *   # live run (testnet only — Golden Rule #3):
 *   AMOUNT_USDC=10 \
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   SOURCE_RPC_URL=... SOURCE_CHAIN_ID=11155111 SOURCE_CHAIN_NAME=sepolia \
 *   SOURCE_CCTP_DOMAIN=0 SOURCE_USDC_ADDRESS=0x... \
 *   SOURCE_TOKEN_MESSENGER=0x... SOURCE_MESSAGE_TRANSMITTER=0x... \
 *   ARC_CCTP_DOMAIN=... ARC_USDC_ADDRESS=0x... \
 *   ARC_TOKEN_MESSENGER=0x... ARC_MESSAGE_TRANSMITTER=0x... \
 *   LENDER_ARC_ADDRESS=0x... \
 *   npm run bridge-deposit
 */
import { formatUnits, parseUnits, type Hex } from "viem";
import {
  loadCctpConfig,
  MissingEnvError,
  publicClientFor,
  walletClientFor,
  erc20Abi,
  tokenMessengerV2Abi,
  messageTransmitterV2Abi,
  pollAttestation,
  addressToBytes32,
  BYTES32_ZERO,
  USDC_DECIMALS,
  type CctpConfig,
} from "./cctp.js";

const log = (m: string) => console.log(m);

/**
 * Print the env checklist (with where to source each address) and exit 0. Called when any required
 * env var is missing so the script is always safe to run dry.
 */
function printEnvHelpAndExit(missing: string[]): never {
  log("");
  log("bridge-deposit (CCTP V2) — dry run. Missing required env, so nothing was sent on-chain.");
  log("");
  log(`Missing: ${missing.join(", ")}`);
  log("");
  log("Required env (Golden Rule #5 — never hardcode; source each value, then export it):");
  log("  DEPLOYER_PRIVATE_KEY     signer (TESTNET key only — Golden Rule #3)");
  log("  AMOUNT_USDC              amount to bridge, human units (6-dec USDC). default: 1");
  log("");
  log("  Source chain (where the lender's USDC currently lives):");
  log("    SOURCE_RPC_URL         RPC for the source chain");
  log("    SOURCE_CHAIN_ID        e.g. 11155111 (Sepolia)");
  log("    SOURCE_CHAIN_NAME      optional label");
  log("    SOURCE_CCTP_DOMAIN     CCTP domain id   -> https://developers.circle.com/cctp");
  log("    SOURCE_USDC_ADDRESS    -> https://developers.circle.com/stablecoins/usdc-contract-addresses");
  log("    SOURCE_TOKEN_MESSENGER (CCTP V2 TokenMessenger) -> https://developers.circle.com/cctp");
  log("    SOURCE_MESSAGE_TRANSMITTER (CCTP V2 MessageTransmitter) -> https://developers.circle.com/cctp");
  log("");
  log("  Destination = Arc (settlement hub):");
  log("    ARC_CCTP_DOMAIN        Arc CCTP domain id -> https://developers.circle.com/cctp");
  log("    ARC_USDC_ADDRESS       -> https://docs.arc.io/arc/references/contract-addresses");
  log("    ARC_TOKEN_MESSENGER    (CCTP V2) -> https://docs.arc.io/arc/references/contract-addresses");
  log("    ARC_MESSAGE_TRANSMITTER(CCTP V2) -> https://docs.arc.io/arc/references/contract-addresses");
  log("    ARC_RPC_URL            optional override (else viem's built-in Arc RPC)");
  log("");
  log("  LENDER_ARC_ADDRESS       Arc address that receives the minted USDC (mintRecipient)");
  log("");
  log("Tip: the Circle MCP server (https://api.circle.com/v1/codegen/mcp) returns live addresses,");
  log("chain ids and CCTP domains. See scripts/CCTP.md for the full flow + the Gateway alternative.");
  log("");
  process.exit(0);
}

async function approveUsdc(cfg: CctpConfig, amount: bigint): Promise<void> {
  const { source, account } = cfg;
  const pub = publicClientFor(source);
  const wallet = walletClientFor(source, account);

  const current = await pub.readContract({
    address: source.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, source.tokenMessenger],
  });
  if (current >= amount) {
    log(`Allowance already sufficient (${formatUnits(current, USDC_DECIMALS)} USDC). Skipping approve.`);
    return;
  }

  log(`Approving ${formatUnits(amount, USDC_DECIMALS)} USDC to TokenMessenger ${source.tokenMessenger}…`);
  const hash = await wallet.writeContract({
    address: source.usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [source.tokenMessenger, amount],
  });
  await pub.waitForTransactionReceipt({ hash });
  log(`  approve confirmed: ${hash}`);
}

async function depositForBurn(cfg: CctpConfig, amount: bigint, maxFee: bigint): Promise<Hex> {
  const { source, arc, mintRecipient, account } = cfg;
  const pub = publicClientFor(source);
  const wallet = walletClientFor(source, account);

  // CCTP V2: minFinalityThreshold 2000 => "standard" (hard finality). Lower => Fast Transfer.
  const minFinalityThreshold = Number(process.env.CCTP_MIN_FINALITY_THRESHOLD ?? "2000");

  log(
    `depositForBurn: ${formatUnits(amount, USDC_DECIMALS)} USDC -> Arc (domain ${arc.domain}), ` +
      `mintRecipient ${mintRecipient}, maxFee ${formatUnits(maxFee, USDC_DECIMALS)} USDC…`,
  );
  const hash = await wallet.writeContract({
    address: source.tokenMessenger,
    abi: tokenMessengerV2Abi,
    functionName: "depositForBurn",
    args: [
      amount,
      arc.domain,
      addressToBytes32(mintRecipient),
      source.usdc,
      BYTES32_ZERO, // destinationCaller = anyone may call receiveMessage
      maxFee,
      minFinalityThreshold,
    ],
  });
  await pub.waitForTransactionReceipt({ hash });
  log(`  depositForBurn (burn) confirmed: ${hash}`);
  return hash;
}

async function receiveOnArc(cfg: CctpConfig, message: Hex, attestation: Hex): Promise<void> {
  const { arc, account } = cfg;
  const pub = publicClientFor(arc);
  const wallet = walletClientFor(arc, account);

  log(`receiveMessage on Arc MessageTransmitter ${arc.messageTransmitter} (mints USDC)…`);
  const hash = await wallet.writeContract({
    address: arc.messageTransmitter,
    abi: messageTransmitterV2Abi,
    functionName: "receiveMessage",
    args: [message, attestation],
  });
  await pub.waitForTransactionReceipt({ hash });
  log(`  receiveMessage (mint) confirmed: ${hash}`);
}

async function main(): Promise<void> {
  let cfg: CctpConfig;
  try {
    cfg = loadCctpConfig();
  } catch (e) {
    if (e instanceof MissingEnvError) {
      printEnvHelpAndExit(e.vars); // exit 0 — safe dry run
    }
    throw e; // genuine config error (bad address/domain) — surface it
  }

  const amount = parseUnits(process.env.AMOUNT_USDC ?? "1", USDC_DECIMALS);
  // CCTP V2 charges a fee; allow up to maxFee. 0 only works for Standard Transfer on some chains —
  // default to a small cap (1 bps of amount, min 1 unit) and let it be overridden.
  const maxFee = process.env.CCTP_MAX_FEE
    ? parseUnits(process.env.CCTP_MAX_FEE, USDC_DECIMALS)
    : amount / 10000n > 0n
      ? amount / 10000n
      : 1n;

  log(`Vouch cross-chain deposit (CCTP V2): ${cfg.source.label} -> ${cfg.arc.label}`);
  log(`Signer: ${cfg.account.address}`);
  log(`Bridging ${formatUnits(amount, USDC_DECIMALS)} USDC; minting to ${cfg.mintRecipient} on Arc.`);
  log("");

  // 1) approve, 2) depositForBurn (burn on source)
  await approveUsdc(cfg, amount);
  const burnTx = await depositForBurn(cfg, amount, maxFee);

  // 3) poll Circle's attestation service
  log("Polling Circle attestation service (this can take minutes on testnet)…");
  const { message, attestation } = await pollAttestation(cfg.source.domain, burnTx, { log });

  // 4) receiveMessage on Arc (mint)
  await receiveOnArc(cfg, message, attestation);

  log("");
  log(`✅ Bridged ${formatUnits(amount, USDC_DECIMALS)} USDC to ${cfg.mintRecipient} on Arc.`);
  log("Next step: now call TranchePool.deposit on Arc to fund the lending pool with this USDC.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
