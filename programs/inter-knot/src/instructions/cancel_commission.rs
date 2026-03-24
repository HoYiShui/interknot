use anchor_lang::prelude::*;
use crate::state::{Commission, CommissionStatus, ReputationAccount};
use crate::errors::InterKnotError;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct CancelCommission<'info> {
    #[account(mut)]
    pub delegator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
        constraint = commission.delegator == delegator.key() @ InterKnotError::UnauthorizedDelegator,
    )]
    pub commission: Account<'info, Commission>,

    /// CHECK: The executor of the commission. Validated in handler for Matched cancellations.
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

pub fn handle_cancel_commission(
    ctx: Context<CancelCommission>,
    commission_id: u64,
) -> Result<()> {
    let commission = &ctx.accounts.commission;

    require!(
        commission.status == CommissionStatus::Open || commission.status == CommissionStatus::Matched,
        InterKnotError::CommissionNotCancellable
    );

    let clock = Clock::get()?;

    // For Matched cancellations, validate executor and update abandonment counters
    if commission.status == CommissionStatus::Matched {
        require!(
            commission.selected_executor == Some(ctx.accounts.executor.key()),
            InterKnotError::UnauthorizedExecutor
        );

        // Update executor reputation (abandoned)
        let executor_rep = &mut ctx.accounts.executor_reputation;
        if executor_rep.created_at == 0 {
            executor_rep.wallet = ctx.accounts.executor.key();
            executor_rep.created_at = clock.unix_timestamp;
            executor_rep.bump = ctx.bumps.executor_reputation;
        }
        executor_rep.total_abandoned = executor_rep.total_abandoned.saturating_add(1);
        executor_rep.last_updated = clock.unix_timestamp;

        // Update delegator reputation (delegator abandoned)
        let delegator_rep = &mut ctx.accounts.delegator_reputation;
        if delegator_rep.created_at == 0 {
            delegator_rep.wallet = ctx.accounts.delegator.key();
            delegator_rep.created_at = clock.unix_timestamp;
            delegator_rep.bump = ctx.bumps.delegator_reputation;
        }
        delegator_rep.total_delegator_abandoned = delegator_rep.total_delegator_abandoned.saturating_add(1);
        delegator_rep.last_updated = clock.unix_timestamp;
    }

    let commission = &mut ctx.accounts.commission;
    commission.status = CommissionStatus::Cancelled;

    msg!("Commission {} cancelled", commission_id);
    Ok(())
}
