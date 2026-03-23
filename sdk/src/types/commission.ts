import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export type CommissionStatus =
  | "open"
  | "matched"
  | "completed"
  | "cancelled"
  | "expired";

export interface Commission {
  commissionId: number;
  delegator: PublicKey;
  taskType: string;
  taskSpecHash: number[];
  taskSpecUri: string;
  maxPrice: BN;
  deadline: BN;
  status: CommissionStatus;
  selectedExecutor: PublicKey | null;
  selectedBidPrice: BN | null;
  bidCount: number;
  createdAt: BN;
  matchedAt: BN | null;
  completedAt: BN | null;
  minExecutorTier: number | null;
  bump: number;
  /** The on-chain PDA address */
  address: PublicKey;
}

/** Parse the Anchor enum format { open: {} } → "open" */
export function parseCommissionStatus(raw: any): CommissionStatus {
  if (raw.open !== undefined) return "open";
  if (raw.matched !== undefined) return "matched";
  if (raw.completed !== undefined) return "completed";
  if (raw.cancelled !== undefined) return "cancelled";
  if (raw.expired !== undefined) return "expired";
  throw new Error(`Unknown commission status: ${JSON.stringify(raw)}`);
}

export interface CreateCommissionParams {
  taskType: string;
  /** Full task spec JSON — will be SHA-256 hashed for on-chain verification */
  taskSpec: Record<string, any>;
  /** Short URI pointing to the full task spec (max 128 chars). e.g. IPFS, HTTP, or arweave URL */
  taskSpecUri: string;
  maxPrice: number;
  deadline: string | number;
  /** Optional minimum executor tier (0=Guest, 1=Trusted, 2=Verified, 3=Elite) */
  minExecutorTier?: number;
}
