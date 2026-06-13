import { IDKitWidget, type ISuccessResult, VerificationLevel } from "@worldcoin/idkit";
import { useAccount, useWriteContract } from "wagmi";
import { decodeAbiParameters, type Address } from "viem";
import { passportRegistryAbi } from "../abis/passportRegistry";

const PASSPORT = import.meta.env.VITE_PASSPORT_REGISTRY_ADDRESS as Address | undefined;
const APP_ID = import.meta.env.VITE_WORLD_APP_ID as `app_${string}` | undefined;
const ACTION = (import.meta.env.VITE_WORLD_ACTION_ID as string) || "mint-credit-passport";

/// World ID verification → on-chain PassportRegistry.verifyAndMint. The proof is validated
/// ON-CHAIN (the track forbids client-only validation). signal = the connected wallet, so the
/// nullifier binds this human to one passport (docs/05). A locked-out human reverts here.
export function WorldIdVerify() {
  const { address } = useAccount();
  const { writeContract, isPending, data: txHash, error } = useWriteContract();

  if (!APP_ID) {
    return (
      <p className="muted">
        Set VITE_WORLD_APP_ID (World developer portal) + deploy PassportRegistry to enable World ID.
      </p>
    );
  }
  if (!PASSPORT || !address) {
    return <p className="muted">Connect a wallet and set VITE_PASSPORT_REGISTRY_ADDRESS.</p>;
  }

  const onSuccess = (result: ISuccessResult) => {
    // IDKit returns hex strings; unpack the proof into the uint256[8] the verifier expects.
    const root = BigInt(result.merkle_root);
    const nullifierHash = BigInt(result.nullifier_hash);
    const proof = decodeAbiParameters([{ type: "uint256[8]" }], result.proof as `0x${string}`)[0] as readonly [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];

    writeContract({
      address: PASSPORT,
      abi: passportRegistryAbi,
      functionName: "verifyAndMint",
      args: [address, root, nullifierHash, proof],
    });
  };

  return (
    <div>
      <IDKitWidget
        app_id={APP_ID}
        action={ACTION}
        signal={address}
        verification_level={VerificationLevel.Orb}
        onSuccess={onSuccess}
      >
        {({ open }) => (
          <button className="btn btn--primary" onClick={open} disabled={isPending}>
            {isPending ? "Minting passport…" : "Verify with World ID"}
          </button>
        )}
      </IDKitWidget>
      {txHash && <p className="muted">passport tx: {txHash}</p>}
      {error && <p className="error">{error.message}</p>}
    </div>
  );
}
