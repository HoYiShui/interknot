use anchor_lang::prelude::*;
use crate::state::{Commission, CommissionStatus};
use crate::errors::InterKnotError;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct CancelCommission<'info> {
    pub delegator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
        constraint = commission.delegator == delegator.key() @ InterKnotError::UnauthorizedDelegator,
    )]
    pub commission: Account<'info, Commission>,
}

pub fn handle_cancel_commission(
    ctx: Context<CancelCommission>,
    commission_id: u64,
) -> Result<()> {
    let commission = &ctx.accounts.commission;

    require!(
        commission.status == CommissionStatus::Open,
        InterKnotError::CommissionNotOpen
    );

    let commission = &mut ctx.accounts.commission;
    commission.status = CommissionStatus::Cancelled;

    msg!("Commission {} cancelled", commission_id);
    Ok(())
}
