use anchor_lang::prelude::*;
use crate::state::{TaskDelivery, DeliveryStatus};
use crate::errors::InterKnotError;

use super::submit_input::MAX_CID_LEN;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct SubmitOutput<'info> {
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [b"delivery", commission_id.to_le_bytes().as_ref()],
        bump = delivery.bump,
        constraint = delivery.executor == executor.key() @ InterKnotError::UnauthorizedExecutor,
    )]
    pub delivery: Account<'info, TaskDelivery>,
}

pub fn handle_submit_output(
    ctx: Context<SubmitOutput>,
    commission_id: u64,
    output_cid: String,
) -> Result<()> {
    let delivery = &ctx.accounts.delivery;

    require!(
        delivery.status == DeliveryStatus::InputReady,
        InterKnotError::DeliveryNotInputReady
    );
    require!(output_cid.len() <= MAX_CID_LEN, InterKnotError::CidTooLong);

    let clock = Clock::get()?;

    let delivery = &mut ctx.accounts.delivery;
    delivery.output_cid = output_cid;
    delivery.status = DeliveryStatus::OutputReady;
    delivery.updated_at = clock.unix_timestamp;

    msg!("Output submitted for commission {}", commission_id);
    Ok(())
}
