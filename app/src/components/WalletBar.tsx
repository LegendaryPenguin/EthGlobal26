import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useChainId,
  useSwitchChain,
} from "wagmi";
import { formatUnits } from "viem";
import { arcTestnet } from "../wagmi";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletBar() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  // Native (gas) balance — USDC, 18 decimals on Arc (Golden Rule #4). useBalance handles the
  // formatting via the chain's nativeCurrency decimals.
  const { data: balance } = useBalance({ address, query: { enabled: isConnected } });

  const onArc = chainId === arcTestnet.id;

  if (!isConnected) {
    // Prefer the MetaMask connector if present.
    const mm = connectors.find((c) => c.id === "metaMaskSDK" || c.name === "MetaMask");
    const connector = mm ?? connectors[0];
    return (
      <button className="btn btn--primary" disabled={isPending} onClick={() => connect({ connector })}>
        {isPending ? "Connecting…" : "Connect MetaMask"}
      </button>
    );
  }

  return (
    <div className="walletbar">
      {!onArc && (
        <button className="btn btn--warn" onClick={() => switchChain({ chainId: arcTestnet.id })}>
          Switch to Arc Testnet
        </button>
      )}
      <span className={onArc ? "badge badge--ok" : "badge badge--warn"}>
        {onArc ? "Arc Testnet" : `Wrong network (${chainId})`}
      </span>
      {balance && (
        <span className="balance">
          {Number(formatUnits(balance.value, balance.decimals)).toFixed(4)} {balance.symbol}
        </span>
      )}
      <span className="addr">{address && short(address)}</span>
      <button className="btn" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
