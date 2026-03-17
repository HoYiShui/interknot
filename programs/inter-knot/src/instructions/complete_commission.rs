use anchor_lang::prelude::*;
use crate::state::{Commission, CommissionStatus};
use crate::errors::InterKnotError;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct CompleteCommission<'info> {
    pub delegator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
        constraint = commission.delegator == delegator.key() @ InterKnotError::UnauthorizedDelegator,
    )]
    pub commission: Account<'info, Commission>,
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

    let clock = Clock::get()?;

    let commission = &mut ctx.accounts.commission;
    commission.status = CommissionStatus::Completed;
    commission.completed_at = Some(clock.unix_timestamp);

    msg!("Commission {} completed", commission_id);
    Ok(())
}
