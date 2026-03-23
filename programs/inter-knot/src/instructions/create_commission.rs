use anchor_lang::prelude::*;
use crate::state::{PlatformConfig, Commission, CommissionStatus};
use crate::errors::InterKnotError;

pub const MAX_TASK_TYPE_LEN: usize = 32;
pub const MAX_TASK_SPEC_URI_LEN: usize = 128;

#[derive(Accounts)]
#[instruction(task_type: String, task_spec_hash: [u8; 32], task_spec_uri: String)]
pub struct CreateCommission<'info> {
    #[account(mut)]
    pub delegator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"inter_knot_config"],
        bump = config.bump,
    )]
    pub config: Account<'info, PlatformConfig>,

    #[account(
        init,
        payer = delegator,
        space = 8 + Commission::INIT_SPACE,
        seeds = [b"commission", config.commission_count.to_le_bytes().as_ref()],
        bump,
    )]
    pub commission: Account<'info, Commission>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_commission(
    ctx: Context<CreateCommission>,
    task_type: String,
    task_spec_hash: [u8; 32],
    task_spec_uri: String,
    max_price: u64,
    deadline: i64,
    min_executor_tier: Option<u8>,
) -> Result<()> {
    require!(task_type.len() <= MAX_TASK_TYPE_LEN, InterKnotError::TaskTypeTooLong);
    require!(task_spec_uri.len() <= MAX_TASK_SPEC_URI_LEN, InterKnotError::TaskSpecUriTooLong);
    require!(max_price > 0, InterKnotError::PriceZero);

    let clock = Clock::get()?;
    require!(deadline > clock.unix_timestamp, InterKnotError::DeadlineNotFuture);

    let config = &mut ctx.accounts.config;
    let commission_id = config.commission_count;
    config.commission_count = config.commission_count
        .checked_add(1)
        .ok_or(error!(InterKnotError::CommissionCountOverflow))?;

    let commission = &mut ctx.accounts.commission;
    commission.commission_id = commission_id;
    commission.delegator = ctx.accounts.delegator.key();
    commission.task_type = task_type;
    commission.task_spec_hash = task_spec_hash;
    commission.task_spec_uri = task_spec_uri;
    commission.max_price = max_price;
    commission.deadline = deadline;
    commission.status = CommissionStatus::Open;
    commission.selected_executor = None;
    commission.selected_bid_price = None;
    commission.bid_count = 0;
    commission.created_at = clock.unix_timestamp;
    commission.matched_at = None;
    commission.completed_at = None;
    commission.min_executor_tier = min_executor_tier;
    commission.bump = ctx.bumps.commission;

    msg!("Commission {} created by {}", commission_id, ctx.accounts.delegator.key());
    Ok(())
}
