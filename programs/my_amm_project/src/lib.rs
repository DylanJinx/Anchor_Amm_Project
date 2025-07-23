#![allow(clippy::result_large_err)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

mod constants;
mod errors;
mod instructions;
mod state;

declare_id!("EuB1XVzgMPt1bFYY1wW3hcNAZEuT4y4qWiTH7n8j3Pz5");

#[program]
pub mod my_amm_project {
    pub use super::instructions::*;
    use super::*;

    pub fn create_amm(ctx: Context<CreateAmm>, id: Pubkey, fee: u16) -> Result<()> {
        instructions::create_amm(ctx, id, fee)
    }

    pub fn create_pool(ctx: Context<CreatePool>) -> Result<()> {
        instructions::create_pool(ctx)
    }

    pub fn deposit_liquidity(
        ctx: Context<DepositLiquidity>,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        instructions::deposit_liquidity(ctx, amount_a, amount_b)
    }

    pub fn withdraw_liquidity(
        ctx: Context<WithdrawLiquidity>,
        amount: u64,
    ) -> Result<()> {
        instructions::withdraw_liquidity(ctx, amount)
    }

    pub fn swap_exact_tokens_for_tokens(
        ctx: Context<SwapExactTokensForTokens>,
        swap_a: bool,
        input_amount: u64,
        min_output_amount: u64,
    ) -> Result<()> {
        instructions::swap_exact_tokens_for_tokens(ctx, swap_a, input_amount, min_output_amount)
    }
}

#[derive(Accounts)]
pub struct Initialize {}
