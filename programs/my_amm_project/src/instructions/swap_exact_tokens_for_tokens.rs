use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, Transfer, TokenAccount},
};
use fixed::types::I64F64;

use crate::{
    constants::AUTHORITY_SEED,
    errors::*,
    state::{Amm, Pool},
};

// 输入：input_amount_a
// 计算：output_amount_b = ?

// 公式：
// new_x = old_x + input_amount_a
// new_y = k / new_x
// output_amount_b = old_y - new_y
pub fn swap_exact_tokens_for_tokens(
    ctx: Context<SwapExactTokensForTokens>,
    swap_a: bool,
    input_amount: u64,
    min_output_amount: u64,
) -> Result<()> {
    // 防止存款人存入不属于自己的资产
    let input = if swap_a && input_amount > ctx.accounts.trader_account_a.amount {
        ctx.accounts.trader_account_a.amount
    } else if !swap_a && input_amount > ctx.accounts.trader_account_b.amount {
        ctx.accounts.trader_account_b.amount
    } else {
        input_amount
    };

    // 应用交易费，用于计算输出
    let amm = &ctx.accounts.amm;
    let taxed_input = input - input * amm.fee as u64 / 10000; // fee: u16 but input: u64

    let pool_a = &ctx.accounts.pool_account_a;
    let pool_b = &ctx.accounts.pool_account_b;

    let output = if swap_a {
        // old_y - ((old_x * old_y) / (old_x + taxed_input)) 
        // = taxed_input * old_y / (old_x + taxed_input)
        I64F64::from_num(taxed_input)
        .checked_mul(I64F64::from_num(pool_b.amount))
        .unwrap()
        .checked_div(
            I64F64::from_num(pool_a.amount)
            .checked_add(I64F64::from_num(taxed_input))
            .unwrap(),
        )
        .unwrap()
    } else {
        I64F64::from_num(taxed_input)
        .checked_mul(I64F64::from_num(pool_a.amount))
        .unwrap()
        .checked_div(
            I64F64::from_num(pool_a.amount)
            .checked_add(I64F64::from_num(taxed_input))
            .unwrap(),
        )
        .unwrap()
    }
    .to_num::<u64>();




    Ok(())
}

#[derive(Accounts)]
pub struct SwapExactTokensForTokens<'info> {
    #[account(
        seeds = [
            amm.id.as_ref()
        ],
        bump,
    )]
    pub amm: Box<Account<'info, Amm>>,

    #[account(
        seeds = [
            pool.amm.as_ref(),
            pool.mint_a.key().as_ref(),
            pool.mint_b.key().as_ref(),
        ],
        bump,
        has_one = amm,
        has_one = mint_a,
        has_one = mint_b,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        seeds = [
            pool.amm.as_ref(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
            AUTHORITY_SEED,
        ],
        bump,
    )]
    /// CHECK: Read only authority
    pub pool_authority: AccountInfo<'info>,

    /// The account doing the swap
    pub trader: Signer<'info>,

    pub mint_a: Box<Account<'info, Mint>>,

    pub mint_b: Box<Account<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = pool_authority,
    )]
    pub pool_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = pool_authority,
    )]
    pub pool_account_b: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_a,
        associated_token::authority = trader,
    )]
    pub trader_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_b,
        associated_token::authority = trader,
    )]
    pub trader_account_b: Box<Account<'info, TokenAccount>>,

    /// The account paying for all rents
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Solana ecosystem accounts
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}