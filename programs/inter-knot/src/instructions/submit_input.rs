use anchor_lang::prelude::*;
use crate::state::{TaskDelivery, DeliveryStatus};
use crate::errors::InterKnotError;

pub const MAX_CID_LEN: usize = 128;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct SubmitInput<'info> {
    pub delegator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"delivery", commission_id.to_le_bytes().as_ref()],
        bump = delivery.bump,
        constraint = delivery.delegator == delegator.key() @ InterKnotError::UnauthorizedDelegator,
    )]
    pub delivery: Account<'info, TaskDelivery>,
}

pub fn handle_submit_input(
    ctx: Context<SubmitInput>,
    commission_id: u64,
    input_cid: String,
) -> Result<()> {
    let delivery = &ctx.accounts.delivery;

    require!(
        delivery.status == DeliveryStatus::Pending,
        InterKnotError::DeliveryNotPending
    );
    require!(input_cid.len() <= MAX_CID_LEN, InterKnotError::CidTooLong);

    let clock = Clock::get()?;

    let delivery = &mut ctx.accounts.delivery;
    delivery.input_cid = input_cid;
    delivery.status = DeliveryStatus::InputReady;
    delivery.updated_at = clock.unix_timestamp;

    msg!("Input submitted for commission {}", commission_id);
    Ok(())
}
