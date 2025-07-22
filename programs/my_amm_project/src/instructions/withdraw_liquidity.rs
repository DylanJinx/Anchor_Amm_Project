use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Burn, Mint, Token, TokenAccount, Transfer},
};
use fixed::types::I64F64;

use crate::{
    constants::{AUTHORITY_SEED, LIQUIDITY_SEED, MINIMUM_LIQUIDITY},
    state::{Pool},
};

pub fn withdraw_liquidity(
    ctx: Context<WithdrawLiquidity>,
    amount: u64,
) -> Result<()> {
    // 计算从池子中提取的代币 A / B 的数量
    let amount_a = I64F64::from_num(amount)
    .checked_mul(I64F64::from_num(ctx.accounts.pool_account_a.amount))
    .unwrap()
    .checked_div(I64F64::from_num(ctx.accounts.mint_liquidity.supply + MINIMUM_LIQUIDITY))
    .unwrap()
    .floor()
    .to_num::<u64>();

    // floor() = 向下取整，总是舍弃小数部分，取最接近的较小整数
    // 123.1   → 123
    // 123.7   → 123  (不是124！)
    // - 用户得到略少于理论值的代币
    // - 池子永远有足够的资金支付
    // - 防止池子被意外清空
    // - 保护其他LP提供者的利益

    let amount_b = I64F64::from_num(amount)
    .checked_mul(I64F64::from_num(ctx.accounts.pool_account_b.amount))
    .unwrap()
    .checked_div(I64F64::from_num(ctx.accounts.mint_liquidity.supply + MINIMUM_LIQUIDITY))
    .unwrap()
    .floor()
    .to_num::<u64>();

    // 生成PDA签名
    let authority_bump = ctx.bumps.pool_authority;
    let authority_seeds = &[
        &ctx.accounts.pool.amm.to_bytes(),
        &ctx.accounts.mint_a.key().to_bytes(),
        &ctx.accounts.mint_b.key().to_bytes(),
        AUTHORITY_SEED,
        &[authority_bump],
    ];
    let signer_seeds = &[&authority_seeds[..]];

    // 转移Token A 给用户
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.pool_account_a.to_account_info(),
                to: ctx.accounts.depositor_account_a.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount_a,
    )?;

    // 转移Token B 给用户
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.pool_account_b.to_account_info(),
                to: ctx.accounts.depositor_account_b.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            signer_seeds,
        ),
        amount_b,
    )?;

    // token::burn() 会自动减少总供应量
    // // 执行后：
    // // - 用户LP账户余额 -= lp_amount
    // // - mint_liquidity.supply -= lp_amount  ← 自动减少！
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint_liquidity.to_account_info(),
                from: ctx.accounts.depositor_account_liquidity.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
    )?;

    
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    // #[account(
    //     seeds = [
    //         amm.id.as_ref()
    //     ],
    //     bump,
    // )]
    // pub amm: Account<'info, Amm>,

    #[account(
        seeds = [
            pool.amm.as_ref(),
            pool.mint_a.key().as_ref(),
            pool.mint_b.key().as_ref(),
        ],
        bump,
        has_one = mint_a,
        has_one = mint_b,
    )]
    pub pool: Account<'info, Pool>,

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

    #[account(
        mut,
        seeds = [
            pool.amm.as_ref(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
            LIQUIDITY_SEED,
        ],
        bump,
    )]
    pub mint_liquidity: Box<Account<'info, Mint>>,

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
        associated_token::authority = depositor,
    )]
    pub depositor_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_b,
        associated_token::authority = depositor,
    )]
    pub depositor_account_b: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_liquidity,
        associated_token::authority = depositor,
    )]
    pub depositor_account_liquidity: Box<Account<'info, TokenAccount>>,

    pub depositor: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// Solana ecosystem accounts
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}