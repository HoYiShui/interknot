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
  taskSpec: Record<string, any>;
  maxPrice: number;
  deadline: string | number;
}
