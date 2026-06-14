// Vouch — borrower repayment flow (Arc). Reads the on-chain amortization schedule and pays an
// installment through the IncomeRouter, which routes the slice back into the LoanVault pool (the
// lenders' capital). The borrower's managed wallet (which holds the disbursed USDC) is the payer.
//
// GET  /api/world/repay?sessionNullifier=... → the schedule (installments, due dates, paid).
// POST /api/world/repay {sessionNullifier}    → pay the next installment via onPayout, return schedule.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPublicClient, createWalletClient, http, defineChain, keccak256, concat, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const INSTALLMENTS = 4;
const TERM_SECONDS = 30 * 24 * 60 * 60; // fixed 30-day term, 4 installments (~7.5 days apart)

const arc = (rpc: string) =>
  defineChain({ id: 5042002, name: "arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });

const VAULT_ABI = [
  { type: "function", name: "loans", stateMutability: "view", inputs: [{ type: "address" }], outputs: [
    { name: "principal", type: "uint256" }, { name: "totalRepayable", type: "uint256" }, { name: "outstanding", type: "uint256" },
    { name: "installmentAmount", type: "uint256" }, { name: "aprBps", type: "uint16" }, { name: "startedAt", type: "uint64" },
    { name: "disbursed", type: "bool" }, { name: "repaid", type: "bool" }, { name: "defaulted", type: "bool" },
  ] },
  { type: "function", name: "scheduledSlice", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const ROUTER_ABI = [{ type: "function", name: "onPayout", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] }] as const;
const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const DEMO_NULLIFIER = "0x7555ed0287b22c44b5efa4598ba22593745bf014";
function managedAccount(sessionNullifier: string, secret: Hex, demoKey?: Hex) {
  if (demoKey && sessionNullifier.toLowerCase() === DEMO_NULLIFIER) return privateKeyToAccount(demoKey);
  return privateKeyToAccount(keccak256(concat([secret, sessionNullifier as Hex])));
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body));
}
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const pre = (req as { body?: unknown }).body;
  if (pre !== undefined) return Promise.resolve((typeof pre === "string" ? JSON.parse(pre) : pre) as Record<string, unknown>);
  return new Promise((resolve, reject) => {
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

type LoanTuple = [bigint, bigint, bigint, bigint, number, bigint, boolean, boolean, boolean];

function buildSchedule(loan: LoanTuple) {
  const [principal, totalRepayable, outstanding, installmentAmount, aprBps, startedAt, disbursed, repaid] = loan;
  const paid = totalRepayable - outstanding;
  const step = Math.floor(TERM_SECONDS / INSTALLMENTS);
  const installments = Array.from({ length: INSTALLMENTS }, (_, i) => {
    const cumulativeByEnd = installmentAmount * BigInt(i + 1);
    const isPaid = paid >= cumulativeByEnd || (i === INSTALLMENTS - 1 && outstanding === 0n);
    // last installment is the remainder so the sum equals totalRepayable exactly
    const amount = i === INSTALLMENTS - 1 ? totalRepayable - installmentAmount * BigInt(INSTALLMENTS - 1) : installmentAmount;
    return { index: i, amountUsdc: amount.toString(), dueAt: Number(startedAt) + step * (i + 1), paid: isPaid };
  });
  return {
    disbursed, repaid,
    principalUsdc: principal.toString(),
    totalRepayableUsdc: totalRepayable.toString(),
    outstandingUsdc: outstanding.toString(),
    installmentUsdc: installmentAmount.toString(),
    aprBps,
    startedAt: Number(startedAt),
    paidUsdc: paid.toString(),
    installments,
  };
}

export function createRepayHandler(raw: Record<string, string>) {
  const rpc = raw.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const VAULT = (raw.VITE_LOAN_VAULT_ADDRESS || "0x201f032252ca717952b8e980d580717325a57f16") as Address;
  const ROUTER = (raw.VITE_INCOME_ROUTER_ADDRESS || "0x54dc0d8d4aa50c6070cba758595e7f59957bf534") as Address;
  const USDC = (raw.VITE_USDC_ADDRESS || "0x3600000000000000000000000000000000000000") as Address;
  const secret = (raw.WORLD_RP_SIGNING_KEY || raw.RP_SIGNING_KEY) as Hex | undefined;
  const demoKey = raw.DEMO_WALLET_PRIVATE_KEY as Hex | undefined;
  const relayerPk = raw.RELAYER_PRIVATE_KEY as Hex | undefined;

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!secret) return json(res, 500, { ok: false, error: "server not configured" });
      const url = new URL(req.url || "", "http://x");
      const body = req.method === "POST" ? await readJson(req) : {};
      const sessionNullifier = (body.sessionNullifier as string) || url.searchParams.get("sessionNullifier") || "";
      if (!sessionNullifier) return json(res, 400, { ok: false, error: "missing sessionNullifier" });

      const chain = arc(rpc);
      const pub = createPublicClient({ chain, transport: http(rpc) });
      const account = managedAccount(sessionNullifier, secret, demoKey);
      const wallet = account.address;

      const loan = (await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "loans", args: [wallet] })) as unknown as LoanTuple;
      if (!loan[6]) return json(res, 200, { ok: true, hasLoan: false }); // disbursed == false

      let repayTx: string | undefined;
      if (req.method === "POST") {
        if (loan[7] || loan[2] === 0n) return json(res, 200, { ok: true, ...buildSchedule(loan), note: "already fully repaid" });
        const slice = (await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "scheduledSlice", args: [wallet] })) as bigint;
        if (slice === 0n) return json(res, 200, { ok: true, ...buildSchedule(loan) });

        // Top up the managed wallet's native gas if needed (repay = approve + onPayout).
        const bal = await pub.getBalance({ address: wallet });
        if (bal < 5_000_000_000_000_000n && relayerPk) {
          const relayer = createWalletClient({ account: privateKeyToAccount(relayerPk), chain, transport: http(rpc) });
          const fundTx = await relayer.sendTransaction({ to: wallet, value: 20_000_000_000_000_000n });
          await pub.waitForTransactionReceipt({ hash: fundTx });
        }

        const w = createWalletClient({ account, chain, transport: http(rpc) });
        // Approve the router for the slice, then onPayout routes it into the LoanVault pool via repay().
        const allowance = (await pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "allowance", args: [wallet, ROUTER] })) as bigint;
        if (allowance < slice) {
          const aTx = await w.writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [ROUTER, slice] });
          await pub.waitForTransactionReceipt({ hash: aTx });
        }
        repayTx = await w.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "onPayout", args: [wallet, slice] });
        await pub.waitForTransactionReceipt({ hash: repayTx as Hex });
      }

      const fresh = (await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "loans", args: [wallet] })) as unknown as LoanTuple;
      return json(res, 200, { ok: true, hasLoan: true, wallet, repayTx, ...buildSchedule(fresh) });
    } catch (e) {
      return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
}
