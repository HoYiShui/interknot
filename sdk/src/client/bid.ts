import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

import { InterKnot, usdcToLamports } from "./program.js";
import { Bid, BidStatus, parseBidStatus } from "../types/bid.js";

export class BidClient {
  constructor(private readonly ik: InterKnot) {}

  async submit(
    commissionId: number,
    params: {
      price: number;
      serviceEndpoint: string;
    }
  ): Promise<{ txSignature: string }> {
    const commissionPda = this.ik.commissionPda(commissionId);
    const bidPda = this.ik.bidPda(commissionId, this.ik.wallet.publicKey);
    const price = usdcToLamports(params.price);

    const txSignature = await this.ik.program.methods
      .submitBid(new BN(commissionId), price, params.serviceEndpoint)
      .accounts({
        executor: this.ik.wallet.publicKey,
        commission: commissionPda,
        bid: bidPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { txSignature };
  }

  async listForCommission(
    commissionId: number,
    options?: {
      sortBy?: "price" | "createdAt";
      order?: "asc" | "desc";
      statusFilter?: BidStatus;
    }
  ): Promise<Bid[]> {
    const accounts = await this.ik.accounts.bid.all();
    let results = accounts
      .map((a: any) => this.parseBid(a.account, a.publicKey))
      .filter((b: Bid) => b.commissionId === commissionId);

    if (options?.statusFilter) {
      results = results.filter((b: Bid) => b.status === options.statusFilter);
    }

    const sortBy = options?.sortBy ?? "price";
    const order = options?.order ?? "asc";
    results.sort((a: Bid, b: Bid) => {
      let cmp: number;
      if (sortBy === "price") {
        cmp = a.price.cmp(b.price);
      } else {
        cmp = a.createdAt.cmp(b.createdAt);
      }
      return order === "asc" ? cmp : -cmp;
    });

    return results;
  }

  async withdraw(commissionId: number): Promise<{ txSignature: string }> {
    const commissionPda = this.ik.commissionPda(commissionId);
    const bidPda = this.ik.bidPda(commissionId, this.ik.wallet.publicKey);

    const txSignature = await this.ik.program.methods
      .withdrawBid(new BN(commissionId))
      .accounts({
        executor: this.ik.wallet.publicKey,
        commission: commissionPda,
        bid: bidPda,
      })
      .rpc();

    return { txSignature };
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
