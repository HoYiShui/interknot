import { PublicKey } from "@solana/web3.js";

export enum ReputationTier {
  Guest    = 0,
  Trusted  = 1,
  Verified = 2,
  Elite    = 3,
}

export interface ReputationAccount {
  wallet: PublicKey;
  totalBids: number;
  totalCompleted: number;
  totalAbandoned: number;
  totalCommissioned: number;
  totalPaid: number;
  totalDelegatorAbandoned: number;
  uniqueCounterparties: number;
  createdAt: { toNumber(): number };
  lastUpdated: { toNumber(): number };
  bump: number;
}

export interface ReputationScore {
  /** 0–1000. 0 = no history. */
  executorScore: number;
  /** 0–1000. 0 = no history. */
  delegatorScore: number;
  tier: ReputationTier;
  totalCompleted: number;
  totalBids: number;
  totalPaid: number;
  totalCommissioned: number;
}

export function computeTier(rep: ReputationAccount): ReputationTier {
  if (rep.totalCompleted >= 50 && rep.uniqueCounterparties >= 10) return ReputationTier.Elite;
  if (rep.totalCompleted >= 20 && rep.uniqueCounterparties >= 5)  return ReputationTier.Verified;
  if (rep.totalCompleted >= 5)                                     return ReputationTier.Trusted;
  return ReputationTier.Guest;
}

export function computeReputationScore(rep: ReputationAccount): ReputationScore {
  // Executor score (0-1000)
  const executorScore = rep.totalBids === 0 ? 0 : Math.round(
    Math.min(rep.totalCompleted / rep.totalBids, 1.0) * 700          // completion signal (max 700)
    + Math.min(rep.uniqueCounterparties / 10, 1.0) * 100             // diversity bonus (anti-collusion)
    + Math.min(rep.totalCompleted / 50, 1.0) * 100                   // volume bonus (longevity)
    + (rep.totalAbandoned === 0 ? 100 : 0)                           // no-abandonment bonus
  );

  // Delegator score (0-1000)
  const delegatorScore = rep.totalCommissioned === 0 ? 0 : Math.round(
    (rep.totalPaid / rep.totalCommissioned) * 800                     // payment reliability (dominant)
    + Math.min(rep.totalCommissioned / 20, 1.0) * 100                // volume bonus
    + (rep.totalDelegatorAbandoned === 0 ? 100 : 0)                  // no-abandonment bonus
  );

  return {
    executorScore,
    delegatorScore,
    tier: computeTier(rep),
    totalCompleted: rep.totalCompleted,
    totalBids: rep.totalBids,
    totalPaid: rep.totalPaid,
    totalCommissioned: rep.totalCommissioned,
  };
}
