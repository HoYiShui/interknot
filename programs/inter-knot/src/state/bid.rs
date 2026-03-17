use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum BidStatus {
    Active = 0,
    Selected = 1,
    Withdrawn = 2,
}

#[account]
#[derive(InitSpace)]
pub struct Bid {
    /// Which commission this bid is for
    pub commission_id: u64,
    /// Bidder's wallet
    pub executor: Pubkey,
    /// Bid price in USDC (6 decimals)
    pub price: u64,
    /// HTTP endpoint for x402 delivery
    #[max_len(128)]
    pub service_endpoint: String,
    /// Bid status
    pub status: BidStatus,
    /// Creation timestamp
    pub created_at: i64,
    /// PDA bump seed
    pub bump: u8,
}
