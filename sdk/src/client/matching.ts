import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { InterKnot } from "./program";

export class MatchingClient {
  constructor(private readonly ik: InterKnot) {}

  async selectBid(
    commissionId: number,
    executor: PublicKey
  ): Promise<{ txSignature: string }> {
    const commissionPda = this.ik.commissionPda(commissionId);
    const bidPda = this.ik.bidPda(commissionId, executor);

    const txSignature = await this.ik.program.methods
      .selectBid(new BN(commissionId))
      .accounts({
        delegator: this.ik.wallet.publicKey,
        commission: commissionPda,
        bid: bidPda,
      })
      .rpc();

    return { txSignature };
  }
}
