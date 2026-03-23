use anchor_lang::prelude::*;
use crate::state::ReputationAccount;

#[derive(Accounts)]
pub struct InitReputation<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: The wallet to create a reputation account for. Can be any pubkey.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ReputationAccount::INIT_SPACE,
        seeds = [b"reputation", wallet.key().as_ref()],
        bump,
    )]
    pub reputation: Account<'info, ReputationAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_reputation(ctx: Context<InitReputation>) -> Result<()> {
    let rep = &mut ctx.accounts.reputation;

    // No-op if already initialized
    if rep.created_at != 0 {
        return Ok(());
    }

    let clock = Clock::get()?;
    rep.wallet = ctx.accounts.wallet.key();
    rep.total_bids = 0;
    rep.total_completed = 0;
    rep.total_abandoned = 0;
    rep.total_commissioned = 0;
    rep.total_paid = 0;
    rep.total_delegator_abandoned = 0;
    rep.unique_counterparties = 0;
    rep.created_at = clock.unix_timestamp;
    rep.last_updated = clock.unix_timestamp;
    rep.bump = ctx.bumps.reputation;

    msg!("Reputation account initialized for {}", ctx.accounts.wallet.key());
    Ok(())
}
