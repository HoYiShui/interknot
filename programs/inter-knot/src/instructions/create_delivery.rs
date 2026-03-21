use anchor_lang::prelude::*;
use crate::state::{Commission, CommissionStatus, TaskDelivery, DeliveryStatus};
use crate::errors::InterKnotError;

#[derive(Accounts)]
#[instruction(commission_id: u64)]
pub struct CreateDelivery<'info> {
    #[account(mut)]
    pub delegator: Signer<'info>,

    #[account(
        seeds = [b"commission", commission_id.to_le_bytes().as_ref()],
        bump = commission.bump,
        constraint = commission.delegator == delegator.key() @ InterKnotError::UnauthorizedDelegator,
    )]
    pub commission: Account<'info, Commission>,

    #[account(
        init,
        payer = delegator,
        space = 8 + TaskDelivery::INIT_SPACE,
        seeds = [b"delivery", commission_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub delivery: Account<'info, TaskDelivery>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_delivery(
    ctx: Context<CreateDelivery>,
    commission_id: u64,
) -> Result<()> {
    let commission = &ctx.accounts.commission;

    require!(
        commission.status == CommissionStatus::Matched,
        InterKnotError::CommissionNotMatched
    );

    let selected_executor = commission.selected_executor
        .ok_or(error!(InterKnotError::CommissionNotMatched))?;

    let clock = Clock::get()?;

    let delivery = &mut ctx.accounts.delivery;
    delivery.commission_id = commission_id;
    delivery.delegator = ctx.accounts.delegator.key();
    delivery.executor = selected_executor;
    delivery.input_cid = String::new();
    delivery.output_cid = String::new();
    delivery.status = DeliveryStatus::Pending;
    delivery.created_at = clock.unix_timestamp;
    delivery.updated_at = clock.unix_timestamp;
    delivery.bump = ctx.bumps.delivery;

    msg!("Delivery created for commission {}", commission_id);
    Ok(())
}
