/// ABI for the Stage 6/8 lender pool (contracts/src/TranchePool.sol). Tranche enum: 0=Senior, 1=Junior.
export const tranchePoolAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tranche", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tranche", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "assetsOf",
    stateMutability: "view",
    inputs: [
      { name: "lender", type: "address" },
      { name: "tranche", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }], // current withdrawable, USDC 6 decimals
  },
] as const;

export const TRANCHE = { Senior: 0, Junior: 1 } as const;
