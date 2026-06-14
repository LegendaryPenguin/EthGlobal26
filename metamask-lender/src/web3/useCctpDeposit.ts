import { useSwitchChain, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, type Hex } from "viem";
import { config } from "./config";
import {
  ARC_CHAIN_ID,
  ARC_TRANCHE_POOL,
  USDC_ADDRESS,
  WAGMI_CHAIN_ID,
  erc20Abi,
  tranchePoolAbi,
} from "./contracts";
import {
  CCTP_DOMAIN,
  MESSAGE_TRANSMITTER_V2_ARC,
  MIN_FINALITY_THRESHOLD_FAST,
  TOKEN_MESSENGER_V2,
  addressToBytes32,
  BYTES32_ZERO,
  messageTransmitterV2Abi,
  pollAttestation,
  tokenMessengerV2Abi,
} from "./cctp";
import type { ChainId, TrancheId } from "../data/mock";

export interface CctpResult {
  burnTx: Hex;
  mintTx: Hex;
  depositTx: Hex;
}

// Real cross-chain deposit: burn on source -> Circle attestation -> mint on Arc -> deposit to pool.
// onStep(n) reports how many of the 4 legs are complete (burn, attest, mint, deposit).
export function useCctpDeposit() {
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  async function run(args: {
    source: ChainId;
    amount: string;
    tranche: TrancheId;
    address: `0x${string}`;
    onStep?: (done: number) => void;
    onTick?: (msg: string) => void;
  }): Promise<CctpResult> {
    const { source, amount, tranche, address, onStep, onTick } = args;
    const srcChainId = WAGMI_CHAIN_ID[source];
    const srcUsdc = USDC_ADDRESS[source];
    const arcUsdc = USDC_ADDRESS.arc!;
    const srcDomain = CCTP_DOMAIN[source];
    if (!srcChainId || !srcUsdc || srcDomain === undefined) throw new Error(`Unsupported source chain: ${source}`);

    const value = parseUnits(amount || "0", 6);
    // Fast-transfer fee CAP (actual fee is set by Circle, always <= this). value/500 was too low and
    // made depositForBurn revert ("likely to fail"); use 1% with a 0.05 USDC floor so fast always clears.
    const maxFee = value / 100n > 50_000n ? value / 100n : 50_000n;

    // --- Leg 1: burn on source ---
    await switchChainAsync({ chainId: srcChainId });
    // CCTP V2 pulls the burn amount via the TokenMessenger's local TokenMinter (it calls
    // transferFrom), so the USDC allowance must target the MINTER, not the messenger — otherwise
    // depositForBurn reverts "transfer amount exceeds allowance".
    const minter = (await readContract(config, {
      address: TOKEN_MESSENGER_V2,
      abi: [{ type: "function", name: "localMinter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
      functionName: "localMinter", chainId: srcChainId,
    })) as `0x${string}`;
    const srcAllowance = (await readContract(config, {
      address: srcUsdc, abi: erc20Abi, functionName: "allowance", args: [address, minter], chainId: srcChainId,
    })) as bigint;
    if (srcAllowance < value) {
      const aHash = await writeContractAsync({
        address: srcUsdc, abi: erc20Abi, functionName: "approve", args: [minter, value], chainId: srcChainId,
      });
      await waitForTransactionReceipt(config, { hash: aHash, chainId: srcChainId });
    }
    const burnTx = await writeContractAsync({
      address: TOKEN_MESSENGER_V2,
      abi: tokenMessengerV2Abi,
      functionName: "depositForBurn",
      args: [value, CCTP_DOMAIN.arc!, addressToBytes32(address), srcUsdc, BYTES32_ZERO, maxFee, MIN_FINALITY_THRESHOLD_FAST],
      chainId: srcChainId,
    });
    await waitForTransactionReceipt(config, { hash: burnTx, chainId: srcChainId });
    onStep?.(1);

    // --- Leg 2: Circle attestation ---
    const att = await pollAttestation(srcDomain, burnTx, { onTick });
    onStep?.(2);

    // --- Leg 3: mint on Arc ---
    await switchChainAsync({ chainId: ARC_CHAIN_ID });
    const mintTx = await writeContractAsync({
      address: MESSAGE_TRANSMITTER_V2_ARC,
      abi: messageTransmitterV2Abi,
      functionName: "receiveMessage",
      args: [att.message, att.attestation],
      chainId: ARC_CHAIN_ID,
    });
    await waitForTransactionReceipt(config, { hash: mintTx, chainId: ARC_CHAIN_ID });
    onStep?.(3);

    // --- Leg 4: approve + deposit into the Arc pool ---
    const poolAllowance = (await readContract(config, {
      address: arcUsdc, abi: erc20Abi, functionName: "allowance", args: [address, ARC_TRANCHE_POOL], chainId: ARC_CHAIN_ID,
    })) as bigint;
    if (poolAllowance < value) {
      const pHash = await writeContractAsync({
        address: arcUsdc, abi: erc20Abi, functionName: "approve", args: [ARC_TRANCHE_POOL, value], chainId: ARC_CHAIN_ID,
      });
      await waitForTransactionReceipt(config, { hash: pHash, chainId: ARC_CHAIN_ID });
    }
    const depositTx = await writeContractAsync({
      address: ARC_TRANCHE_POOL, abi: tranchePoolAbi, functionName: "deposit", args: [tranche, value], chainId: ARC_CHAIN_ID,
    });
    await waitForTransactionReceipt(config, { hash: depositTx, chainId: ARC_CHAIN_ID });
    onStep?.(4);

    return { burnTx, mintTx, depositTx };
  }

  return { run };
}
