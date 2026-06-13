/// ABI for the Stage 4 World ID passport gate (contracts/src/PassportRegistry.sol).
export const passportRegistryAbi = [
  {
    type: "function",
    name: "verifyAndMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "signal", type: "address" },
      { name: "root", type: "uint256" },
      { name: "nullifierHash", type: "uint256" },
      { name: "proof", type: "uint256[8]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isInGoodStanding",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "standingOf",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint8" }], // 0 None,1 Good,2 Late,3 Defaulted,4 LockedOut
  },
  {
    type: "function",
    name: "limitOf",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "uint256" }], // USDC, 6 decimals
  },
  {
    type: "function",
    name: "passportIdOf",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bytes32" }], // the human's ERC-8004 passport id; 0x0 if none
  },
] as const;

export const STANDING_LABELS = ["Unverified", "Good", "Late", "Defaulted", "Locked out"] as const;

/// IncomeRouter.onPayout — Stage 2/7 mock creator payout (money-shot #3).
export const incomeRouterAbi = [
  {
    type: "function",
    name: "onPayout",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/// Minimal USDC surface the frontend needs (6 decimals on Arc).
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
