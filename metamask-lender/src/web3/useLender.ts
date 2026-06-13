import { useAccount, useConnect, useDisconnect, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits } from "viem";
import { config } from "./config";
import {
  ARC_CHAIN_ID,
  ARC_TRANCHE_POOL,
  USDC_ADDRESS,
  WAGMI_CHAIN_ID,
  erc20Abi,
  tranchePoolAbi,
} from "./contracts";
import type { ChainId, TrancheId } from "../data/mock";

// Connect / account state (real MetaMask via injected connector).
export function useWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const connect = () => connectAsync({ connector: connectors[0] });
  return { address, isConnected, chainId, connect, disconnect, isPending };
}

// Live USDC balance for a given source chain (6 decimals).
export function useUsdcBalance(chain: ChainId): bigint | undefined {
  const { address } = useAccount();
  const token = USDC_ADDRESS[chain];
  const cid = WAGMI_CHAIN_ID[chain];
  const { data } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: cid,
    query: { enabled: Boolean(address && token && cid), refetchInterval: 12_000 },
  });
  return data as bigint | undefined;
}

// Live pool position on Arc.
export function usePoolPosition(tranche: TrancheId) {
  const { address } = useAccount();
  const q = useReadContract({
    address: ARC_TRANCHE_POOL,
    abi: tranchePoolAbi,
    functionName: "assetsOf",
    args: address ? [address, tranche] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });
  return { value: q.data as bigint | undefined, refetch: q.refetch };
}

// Real Arc deposit path: approve USDC -> deposit into the tranche. Each step waits for receipt.
export function useArcDeposit() {
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  async function approve(amount: string) {
    await switchChainAsync({ chainId: ARC_CHAIN_ID });
    const hash = await writeContractAsync({
      address: USDC_ADDRESS.arc!,
      abi: erc20Abi,
      functionName: "approve",
      args: [ARC_TRANCHE_POOL, parseUnits(amount || "0", 6)],
      chainId: ARC_CHAIN_ID,
    });
    await waitForTransactionReceipt(config, { hash, chainId: ARC_CHAIN_ID });
    return hash;
  }

  async function deposit(tranche: TrancheId, amount: string) {
    const hash = await writeContractAsync({
      address: ARC_TRANCHE_POOL,
      abi: tranchePoolAbi,
      functionName: "deposit",
      args: [tranche, parseUnits(amount || "0", 6)],
      chainId: ARC_CHAIN_ID,
    });
    await waitForTransactionReceipt(config, { hash, chainId: ARC_CHAIN_ID });
    return hash;
  }

  return { approve, deposit };
}
