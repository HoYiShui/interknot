import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export type BidStatus = "active" | "selected" | "withdrawn";

export interface Bid {
  commissionId: number;
  executor: PublicKey;
  price: BN;
  serviceEndpoint: string;
  status: BidStatus;
  createdAt: BN;
  bump: number;
  /** The on-chain PDA address */
  address: PublicKey;
}

/** Parse the Anchor enum format { active: {} } → "active" */
export function parseBidStatus(raw: any): BidStatus {
  if (raw.active !== undefined) return "active";
  if (raw.selected !== undefined) return "selected";
  if (raw.withdrawn !== undefined) return "withdrawn";
  throw new Error(`Unknown bid status: ${JSON.stringify(raw)}`);
}
