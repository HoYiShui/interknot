use anchor_lang::prelude::*;
use crate::state::PlatformConfig;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + PlatformConfig::INIT_SPACE,
        seeds = [b"inter_knot_config"],
        bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>, usdc_mint: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.commission_count = 0;
    config.usdc_mint = usdc_mint;
    config.platform_fee_bps = 0;
    config.bump = ctx.bumps.config;

    msg!("Inter-Knot platform initialized");
    Ok(())
}
