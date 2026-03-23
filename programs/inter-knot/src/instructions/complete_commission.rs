use anchor_lang::prelude::*;
use crate::state::{Commission, CommissionStatus, ReputationAccount};
use crate::errors::InterKnotError;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct CompleteCommission<'info> {
    #[account(mut)]
    pub delegator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
        constraint = commission.delegator == delegator.key() @ InterKnotError::UnauthorizedDelegator,
    )]
    pub commission: Account<'info, Commission>,

    /// CHECK: Validated against commission.selected_executor in the handler
    pub executor: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = delegator,
        space = 8 + ReputationAccount::INIT_SPACE,
        seeds = [b"reputation", executor.key().as_ref()],
        bump,
    )]
    pub executor_reputation: Account<'info, ReputationAccount>,

    #[account(
        init_if_needed,
        payer = delegator,
        space = 8 + ReputationAccount::INIT_SPACE,
        seeds = [b"reputation", delegator.key().as_ref()],
        bump,
    )]
    pub delegator_reputation: Account<'info, ReputationAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handle_complete_commission(
    ctx: Context<CompleteCommission>,
    commission_id: u64,
) -> Result<()> {
    let commission = &ctx.accounts.commission;

    require!(
        commission.status == CommissionStatus::Matched,
        InterKnotError::CommissionNotMatched
    );
    require!(
        commission.selected_executor == Some(ctx.accounts.executor.key()),
        InterKnotError::UnauthorizedExecutor
    );

    let clock = Clock::get()?;

    let commission = &mut ctx.accounts.commission;
    commission.status = CommissionStatus::Completed;
    commission.completed_at = Some(clock.unix_timestamp);

    // Update executor reputation
    let executor_rep = &mut ctx.accounts.executor_reputation;
    if executor_rep.wallet == Pubkey::default() {
        executor_rep.wallet = ctx.accounts.executor.key();
        executor_rep.created_at = clock.unix_timestamp;
        executor_rep.bump = ctx.bumps.executor_reputation;
    }
    executor_rep.total_completed += 1;
    executor_rep.unique_counterparties += 1;
    executor_rep.last_updated = clock.unix_timestamp;

    // Update delegator reputation
    let delegator_rep = &mut ctx.accounts.delegator_reputation;
    if delegator_rep.wallet == Pubkey::default() {
        delegator_rep.wallet = ctx.accounts.delegator.key();
        delegator_rep.created_at = clock.unix_timestamp;
        delegator_rep.bump = ctx.bumps.delegator_reputation;
    }
    delegator_rep.total_paid += 1;
    delegator_rep.unique_counterparties += 1;
    delegator_rep.last_updated = clock.unix_timestamp;

    msg!("Commission {} completed", commission_id);
    Ok(())
}
