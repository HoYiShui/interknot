use anchor_lang::prelude::*;
use crate::state::{Commission, CommissionStatus, Bid, BidStatus};
use crate::errors::InterKnotError;

pub const MAX_SERVICE_ENDPOINT_LEN: usize = 128;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct SubmitBid<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
    )]
    pub commission: Account<'info, Commission>,

    #[account(
        init,
        payer = executor,
        space = 8 + Bid::INIT_SPACE,
        seeds = [b"bid", commission_id.to_le_bytes().as_ref(), executor.key().as_ref()],
        bump,
    )]
    pub bid: Account<'info, Bid>,

    pub system_program: Program<'info, System>,
}

pub fn handle_submit_bid(
    ctx: Context<SubmitBid>,
    commission_id: u64,
    price: u64,
    service_endpoint: String,
) -> Result<()> {
    let commission = &ctx.accounts.commission;

    require!(
        commission.status == CommissionStatus::Open,
        InterKnotError::CommissionNotOpen
    );
    require!(price > 0, InterKnotError::PriceZero);
    require!(price <= commission.max_price, InterKnotError::BidPriceTooHigh);
    require!(
        service_endpoint.len() <= MAX_SERVICE_ENDPOINT_LEN,
        InterKnotError::ServiceEndpointTooLong
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < commission.deadline,
        InterKnotError::DeadlinePassed
    );
    require!(
        ctx.accounts.executor.key() != commission.delegator,
        InterKnotError::SelfBidNotAllowed
    );

    let commission = &mut ctx.accounts.commission;
    commission.bid_count = commission.bid_count
        .checked_add(1)
        .ok_or(error!(InterKnotError::BidCountOverflow))?;

    let bid = &mut ctx.accounts.bid;
    bid.commission_id = commission_id;
    bid.executor = ctx.accounts.executor.key();
    bid.price = price;
    bid.service_endpoint = service_endpoint;
    bid.status = BidStatus::Active;
    bid.created_at = clock.unix_timestamp;
    bid.bump = ctx.bumps.bid;

    msg!(
        "Bid submitted for commission {} by {} at price {}",
        commission_id,
        ctx.accounts.executor.key(),
        price
    );
    Ok(())
}
