use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PlatformConfig {
    /// Admin (deployer). Can update config.
    pub authority: Pubkey,
    /// Auto-incrementing counter for commission IDs
    pub commission_count: u64,
    /// USDC SPL token mint address
    pub usdc_mint: Pubkey,
    /// Platform fee in basis points. MVP: 0
    pub platform_fee_bps: u16,
    /// PDA bump seed
    pub bump: u8,
}
