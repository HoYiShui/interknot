use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh");

#[program]
pub mod inter_knot {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, usdc_mint: Pubkey) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, usdc_mint)
    }

    pub fn create_commission(
        ctx: Context<CreateCommission>,
        task_type: String,
        task_spec_hash: [u8; 32],
        task_spec_uri: String,
        max_price: u64,
        deadline: i64,
    ) -> Result<()> {
        instructions::create_commission::handle_create_commission(
            ctx,
            task_type,
            task_spec_hash,
            task_spec_uri,
            max_price,
            deadline,
        )
    }
}
