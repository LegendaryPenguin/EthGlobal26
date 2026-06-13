// Frozen ABI for LoanRegistry.setTerms((address,bytes32,uint256,uint16,uint8,bytes32,uint64,bool)).
// Mirrors contracts/src/interfaces/ILoanRegistry.sol EXACTLY (Golden Rule #1). Do not change the
// `Terms` tuple layout without a coordinated re-freeze across /cre and /contracts.

export const loanRegistryAbi = [
  {
    type: "function",
    name: "setTerms",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "t",
        type: "tuple",
        internalType: "struct ILoanRegistry.Terms",
        components: [
          { name: "borrower", type: "address" },
          { name: "passportId", type: "bytes32" },
          { name: "principal", type: "uint256" },
          { name: "aprBps", type: "uint16" },
          { name: "riskBand", type: "uint8" },
          { name: "attestationRef", type: "bytes32" },
          { name: "expiry", type: "uint64" },
          { name: "approved", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
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
          { name: "principal", type: "uint256" },
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
