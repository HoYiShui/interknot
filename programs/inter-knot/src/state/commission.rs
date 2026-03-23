use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum CommissionStatus {
    Open = 0,
    Matched = 1,
    Completed = 2,
    Cancelled = 3,
    Expired = 4,
}

#[account]
#[derive(InitSpace)]
pub struct Commission {
    /// Unique ID (from config.commission_count)
    pub commission_id: u64,
    /// Creator's wallet
    pub delegator: Pubkey,
    /// e.g. "compute/llm-inference"
    #[max_len(32)]
    pub task_type: String,
    /// SHA-256 of the full task_spec JSON
    pub task_spec_hash: [u8; 32],
    /// URI pointing to full task_spec JSON
    #[max_len(128)]
    pub task_spec_uri: String,
    /// Maximum price in USDC (6 decimals, so 1_000_000 = 1 USDC)
    pub max_price: u64,
    /// Bidding deadline (Unix timestamp)
    pub deadline: i64,
    /// Commission status
    pub status: CommissionStatus,
    /// Winning executor's wallet (set on match)
    pub selected_executor: Option<Pubkey>,
    /// Winning bid price (set on match)
    pub selected_bid_price: Option<u64>,
    /// Number of active bids
    pub bid_count: u32,
    /// Creation timestamp
    pub created_at: i64,
    /// When match was made
    pub matched_at: Option<i64>,
    /// When marked complete
    pub completed_at: Option<i64>,
    /// Minimum executor reputation tier required to bid (0=Guest,1=Trusted,2=Verified,3=Elite)
    pub min_executor_tier: Option<u8>,
    /// PDA bump seed
    pub bump: u8,
}
