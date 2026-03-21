use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum DeliveryStatus {
    Pending = 0,      // Created, awaiting input
    InputReady = 1,   // Delegator submitted input CID
    OutputReady = 2,  // Executor submitted output CID
}

#[account]
#[derive(InitSpace)]
pub struct TaskDelivery {
    /// Commission this delivery is for
    pub commission_id: u64,
    /// Delegator's wallet
    pub delegator: Pubkey,
    /// Matched executor's wallet
    pub executor: Pubkey,
    /// Irys transaction ID for encrypted task input
    #[max_len(128)]
    pub input_cid: String,
    /// Irys transaction ID for encrypted task output
    #[max_len(128)]
    pub output_cid: String,
    /// Delivery status
    pub status: DeliveryStatus,
    /// Creation timestamp
    pub created_at: i64,
    /// Last update timestamp
    pub updated_at: i64,
    /// PDA bump seed
    pub bump: u8,
}
