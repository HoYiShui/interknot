import { PublicKey } from "@solana/web3.js";

import { InterKnot } from "./program.js";
import { Commission, parseCommissionStatus } from "../types/commission.js";
import { Bid, parseBidStatus } from "../types/bid.js";

export class QueryClient {
  constructor(private readonly ik: InterKnot) {}

  async getOpenCommissions(options?: {
    taskType?: string;
    sortBy?: "maxPrice" | "deadline" | "createdAt";
    order?: "asc" | "desc";
  }): Promise<Commission[]> {
    const accounts = await this.ik.accounts.commission.all();
    let results = accounts
      .map((a: any) => this.parseCommission(a.account, a.publicKey))
      .filter((c: Commission) => c.status === "open");

    if (options?.taskType) {
      results = results.filter((c: Commission) => c.taskType === options.taskType);
    }

    const sortBy = options?.sortBy ?? "createdAt";
    const order = options?.order ?? "desc";
    results.sort((a: Commission, b: Commission) => {
      let cmp: number;
      if (sortBy === "maxPrice") {
        cmp = a.maxPrice.cmp(b.maxPrice);
      } else if (sortBy === "deadline") {
        cmp = a.deadline.cmp(b.deadline);
      } else {
        cmp = a.createdAt.cmp(b.createdAt);
      }
      return order === "asc" ? cmp : -cmp;
    });

    return results;
  }

  async getBidsSortedByPrice(commissionId: number): Promise<Bid[]> {
    const accounts = await this.ik.accounts.bid.all();
    return accounts
      .map((a: any) => this.parseBid(a.account, a.publicKey))
      .filter(
        (b: Bid) => b.commissionId === commissionId && b.status === "active"
      )
      .sort((a: Bid, b: Bid) => a.price.cmp(b.price));
  }

  async getStats(): Promise<{
    totalCommissions: number;
    openCommissions: number;
    matchedCommissions: number;
    completedCommissions: number;
  }> {
    const accounts = await this.ik.accounts.commission.all();
    const all = accounts.map((a: any) =>
      this.parseCommission(a.account, a.publicKey)
    );

    return {
      totalCommissions: all.length,
      openCommissions: all.filter((c: Commission) => c.status === "open").length,
      matchedCommissions: all.filter((c: Commission) => c.status === "matched").length,
      completedCommissions: all.filter((c: Commission) => c.status === "completed").length,
    };
  }

  private parseCommission(raw: any, address: PublicKey): Commission {
    return {
      commissionId: raw.commissionId.toNumber(),
      delegator: raw.delegator,
      taskType: raw.taskType,
      taskSpecHash: raw.taskSpecHash,
      taskSpecUri: raw.taskSpecUri,
      maxPrice: raw.maxPrice,
      deadline: raw.deadline,
      status: parseCommissionStatus(raw.status),
      selectedExecutor: raw.selectedExecutor ?? null,
      selectedBidPrice: raw.selectedBidPrice ?? null,
      bidCount: raw.bidCount,
      createdAt: raw.createdAt,
      matchedAt: raw.matchedAt ?? null,
      completedAt: raw.completedAt ?? null,
      minExecutorTier: raw.minExecutorTier ?? null,
      bump: raw.bump,
      address,
    };
  }

  private parseBid(raw: any, address: PublicKey): Bid {
    return {
      commissionId: raw.commissionId.toNumber(),
      executor: raw.executor,
      price: raw.price,
      serviceEndpoint: raw.serviceEndpoint,
      status: parseBidStatus(raw.status),
      createdAt: raw.createdAt,
      bump: raw.bump,
      address,
    };
  }
}
