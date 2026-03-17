use anchor_lang::prelude::*;
use crate::state::{Commission, CommissionStatus, Bid, BidStatus};
use crate::errors::InterKnotError;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct SelectBid<'info> {
    pub delegator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
        constraint = commission.delegator == delegator.key() @ InterKnotError::UnauthorizedDelegator,
    )]
    pub commission: Account<'info, Commission>,

    #[account(
        mut,
        seeds = [b"bid", commission_id.to_le_bytes().as_ref(), bid.executor.as_ref()],
        bump = bid.bump,
    )]
    pub bid: Account<'info, Bid>,
}

pub fn handle_select_bid(
    ctx: Context<SelectBid>,
    commission_id: u64,
) -> Result<()> {
    let commission = &ctx.accounts.commission;
    let bid = &ctx.accounts.bid;

    require!(
        commission.status == CommissionStatus::Open,
        InterKnotError::CommissionNotOpen
    );
    require!(
        bid.status == BidStatus::Active,
        InterKnotError::BidNotActive
    );

    let clock = Clock::get()?;

    let commission = &mut ctx.accounts.commission;
    commission.status = CommissionStatus::Matched;
    commission.selected_executor = Some(ctx.accounts.bid.executor);
    commission.selected_bid_price = Some(ctx.accounts.bid.price);
    commission.matched_at = Some(clock.unix_timestamp);

    let bid = &mut ctx.accounts.bid;
    bid.status = BidStatus::Selected;

    msg!(
        "Commission {} matched with executor {} at price {}",
        commission_id,
        bid.executor,
        bid.price
    );
    Ok(())
}
