import { PublicKey, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";

import { InterKnot } from "./program.js";
import {
  ReputationAccount,
  ReputationScore,
  computeReputationScore,
  computeTier,
  ReputationTier,
} from "../reputation/score.js";

export class ReputationClient {
  constructor(private readonly ik: InterKnot) {}

  /** Get the raw ReputationAccount for a wallet, or null if not initialized. */
  async getReputation(wallet: PublicKey): Promise<ReputationAccount | null> {
    const pda = this.ik.reputationPda(wallet);
    try {
      return await (this.ik.accounts as any).reputationAccount.fetch(pda) as ReputationAccount;
    } catch {
      return null;
    }
  }

  /** Compute the reputation score and tier for a wallet. Returns null-score object if no history. */
  async getScore(wallet: PublicKey): Promise<ReputationScore> {
    const rep = await this.getReputation(wallet);
    if (!rep) {
      return {
        executorScore: 0,
        delegatorScore: 0,
        tier: ReputationTier.Guest,
        totalCompleted: 0,
        totalBids: 0,
        totalPaid: 0,
        totalCommissioned: 0,
      };
    }
    return computeReputationScore(rep);
  }

  /** Initialize a ReputationAccount for a wallet (call before first transaction). */
  async initReputation(wallet: PublicKey): Promise<{ txSignature: string }> {
    const pda = this.ik.reputationPda(wallet);
    const txSignature = await this.ik.program.methods
      .initReputation()
      .accounts({
        payer: this.ik.wallet.publicKey,
        wallet,
        reputation: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return { txSignature };
  }

  /**
   * Batch fetch reputation scores for a list of wallets.
   * Missing accounts are returned as Guest-tier zero-score entries.
   */
  async getScores(wallets: PublicKey[]): Promise<Map<string, ReputationScore>> {
    const results = new Map<string, ReputationScore>();
    await Promise.all(
      wallets.map(async (wallet) => {
        const score = await this.getScore(wallet);
        results.set(wallet.toBase58(), score);
      })
    );
    return results;
  }
}

export { ReputationTier, ReputationScore, ReputationAccount, computeTier, computeReputationScore };
