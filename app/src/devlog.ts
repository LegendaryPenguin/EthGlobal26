// Tiny global activity log so any component can record "this just happened on-chain / a proof was
// generated" and the DevPanel renders it live, timestamped, with explorer links — proof for judges
// that the demo is real, not staged.
export type DevKind = "info" | "tx" | "proof" | "id" | "error";
export type DevEvent = { id: number; t: number; kind: DevKind; label: string; value?: string; link?: string };

let events: DevEvent[] = [];
let seq = 0;
const subs = new Set<() => void>();

export function logEvent(e: { kind: DevKind; label: string; value?: string; link?: string }): void {
  events = [{ ...e, id: ++seq, t: Date.now() }, ...events].slice(0, 100);
  subs.forEach((f) => f());
}
export function subscribeDevlog(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function getDevlog(): DevEvent[] {
  return events;
}

// Explorer link helpers — Arc (Vouch contracts) and Ethereum Sepolia (the CRE CreditRegistry).
const RPC = (import.meta.env.VITE_ARC_RPC_URL as string) || "";
const IS_LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
export const arcTx = (hash?: string) => (hash && !IS_LOCAL ? `https://testnet.arcscan.app/tx/${hash}` : undefined);
export const sepoliaTx = (hash?: string) => (hash ? `https://sepolia.etherscan.io/tx/${hash}` : undefined);
