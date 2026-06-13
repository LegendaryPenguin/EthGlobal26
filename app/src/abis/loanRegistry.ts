/// ABI fragment for the frozen seam (contracts/src/interfaces/ILoanRegistry.sol). Keep the
/// Terms tuple byte-for-byte in sync with the Solidity struct — the whole system reads this.
export const loanRegistryAbi = [
  {
    type: "function",
    name: "getTerms",
    stateMutability: "view",
    inputs: [{ name: "borrower", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "borrower", type: "address" },
          { name: "passportId", type: "bytes32" },
          { name: "principal", type: "uint256" }, // USDC, 6 decimals
          { name: "aprBps", type: "uint16" },
          { name: "riskBand", type: "uint8" },
          { name: "attestationRef", type: "bytes32" },
          { name: "expiry", type: "uint64" },
          { name: "approved", type: "bool" },
        ],
      },
    ],
  },
] as const;

/// LoanVault.claim() — Stage 2. Borrower pulls an approved, attested loan.
export const loanVaultAbi = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;
