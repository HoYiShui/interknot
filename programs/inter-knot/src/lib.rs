use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh");

#[program]
pub mod inter_knot {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, usdc_mint: Pubkey) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, usdc_mint)
    }

    pub fn create_commission(
        ctx: Context<CreateCommission>,
        task_type: String,
        task_spec_hash: [u8; 32],
        task_spec_uri: String,
        max_price: u64,
        deadline: i64,
    ) -> Result<()> {
        instructions::create_commission::handle_create_commission(
            ctx,
            task_type,
            task_spec_hash,
            task_spec_uri,
            max_price,
            deadline,
        )
    }

    pub fn submit_bid(
        ctx: Context<SubmitBid>,
        commission_id: u64,
        price: u64,
        service_endpoint: String,
    ) -> Result<()> {
        instructions::submit_bid::handle_submit_bid(ctx, commission_id, price, service_endpoint)
    }

    pub fn select_bid(
        ctx: Context<SelectBid>,
        commission_id: u64,
    ) -> Result<()> {
        instructions::select_bid::handle_select_bid(ctx, commission_id)
    }

    pub fn complete_commission(
        ctx: Context<CompleteCommission>,
        commission_id: u64,
    ) -> Result<()> {
        instructions::complete_commission::handle_complete_commission(ctx, commission_id)
    }

    pub fn cancel_commission(
        ctx: Context<CancelCommission>,
        commission_id: u64,
    ) -> Result<()> {
        instructions::cancel_commission::handle_cancel_commission(ctx, commission_id)
    }

    pub fn withdraw_bid(
        ctx: Context<WithdrawBid>,
        commission_id: u64,
    ) -> Result<()> {
        instructions::withdraw_bid::handle_withdraw_bid(ctx, commission_id)
    }

    pub fn create_delivery(
        ctx: Context<CreateDelivery>,
        commission_id: u64,
    ) -> Result<()> {
        instructions::create_delivery::handle_create_delivery(ctx, commission_id)
    }

    pub fn submit_input(
        ctx: Context<SubmitInput>,
        commission_id: u64,
        input_cid: String,
    ) -> Result<()> {
        instructions::submit_input::handle_submit_input(ctx, commission_id, input_cid)
    }

    pub fn submit_output(
        ctx: Context<SubmitOutput>,
        commission_id: u64,
        output_cid: String,
    ) -> Result<()> {
        instructions::submit_output::handle_submit_output(ctx, commission_id, output_cid)
    }
}
