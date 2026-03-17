use anchor_lang::prelude::*;
use crate::state::{Commission, Bid, BidStatus};
use crate::errors::InterKnotError;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct WithdrawBid<'info> {
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
    )]
    pub commission: Account<'info, Commission>,

    #[account(
        mut,
        seeds = [b"bid", commission_id.to_le_bytes().as_ref(), executor.key().as_ref()],
        bump = bid.bump,
        constraint = bid.executor == executor.key() @ InterKnotError::UnauthorizedExecutor,
    )]
    pub bid: Account<'info, Bid>,
}

pub fn handle_withdraw_bid(
    ctx: Context<WithdrawBid>,
    commission_id: u64,
) -> Result<()> {
    let bid = &ctx.accounts.bid;

    require!(
        bid.status == BidStatus::Active,
        InterKnotError::BidNotActive
    );

    let bid = &mut ctx.accounts.bid;
    bid.status = BidStatus::Withdrawn;

    let commission = &mut ctx.accounts.commission;
    commission.bid_count = commission.bid_count.saturating_sub(1);

    msg!("Bid withdrawn for commission {} by {}", commission_id, ctx.accounts.executor.key());
    Ok(())
}
