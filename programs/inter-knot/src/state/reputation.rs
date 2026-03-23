use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, InitSpace)]
#[repr(u8)]
pub enum ReputationTier {
    Guest    = 0,
    Trusted  = 1,
    Verified = 2,
    Elite    = 3,
}

#[account]
#[derive(InitSpace)]
pub struct ReputationAccount {
    /// The wallet this reputation belongs to
    pub wallet: Pubkey,

    // As executor
    /// Total bids submitted
    pub total_bids: u32,
    /// Total times completed as executor (commission reached Completed state)
    pub total_completed: u32,
    /// Total matched commissions that were abandoned before completion
    pub total_abandoned: u32,

    // As delegator
    /// Total commissions created
    pub total_commissioned: u32,
    /// Total commissions completed as delegator
    pub total_paid: u32,
    /// Total matched commissions abandoned by delegator
    pub total_delegator_abandoned: u32,

    // Anti-collusion signal
    /// Distinct counterparties transacted with (approximate; incremented per completion)
    pub unique_counterparties: u32,

    pub created_at: i64,
    pub last_updated: i64,
    pub bump: u8,
}

/// Compute the reputation tier from on-chain counters.
/// Used in submit_bid to enforce commission min_executor_tier.
pub fn compute_tier(rep: &ReputationAccount) -> ReputationTier {
    if rep.total_completed >= 50 && rep.unique_counterparties >= 10 {
        ReputationTier::Elite
    } else if rep.total_completed >= 20 && rep.unique_counterparties >= 5 {
        ReputationTier::Verified
    } else if rep.total_completed >= 5 {
        ReputationTier::Trusted
    } else {
        ReputationTier::Guest
    }
}
