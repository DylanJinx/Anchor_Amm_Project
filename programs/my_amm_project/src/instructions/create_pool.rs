use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};


use crate::{
    constants::{AUTHORITY_SEED, LIQUIDITY_SEED},
    state::{Amm, Pool},
};

pub fn create_pool(
    ctx: Context<CreatePool>
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.amm = ctx.accounts.amm.key();
    pool.mint_a = ctx.accounts.mint_a.key();
    pool.mint_b = ctx.accounts.mint_b.key();
    Ok(())
}

#[derive(Accounts)]
// #[instruction()] amm.id从已存在的amm账户中获取，不从函数参数中获取
pub struct CreatePool<'info>{

    #[account(
        seeds = [
            amm.id.as_ref()
        ],
        bump,
    )]
    // 不用Box：数据存储在栈上
    // pub amm: Account<'info, Amm>,
    // 栈上分配，快但有大小限制

    // 用Box：数据存储在堆上  
    pub amm: Box<Account<'info, Amm>>,   // 堆上分配，慢但没有大小限制

    #[account(
        init,
        space = Pool::LEN,
        payer = payer,
        seeds = [
            amm.key().as_ref(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
        ],
        bump,
    )]
    pub pool: Box<Account<'info, Pool>>,

    /// CHECK: Read only authority
    #[account(
        seeds = [
            amm.key().as_ref(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
            AUTHORITY_SEED,
        ],
        bump,
    )]
    pub pool_authority: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [
            amm.key().as_ref(),
            mint_a.key().as_ref(),
            mint_b.key().as_ref(),
            LIQUIDITY_SEED,
        ],
        bump,
        mint::decimals = 6,
        mint::authority = pool_authority,

    )]
    pub mint_liquidity: Box<Account<'info, Mint>>,

    pub mint_a: Box<Account<'info, Mint>>,
    pub mint_b: Box<Account<'info, Mint>>,

    // - 你有一个钱包地址：wallet_address
    // - 你想持有USDC代币，但钱包本身不能直接存储代币
    // - 你需要一个"代币账户"来存储USDC
    //   解决方案：ATA
    //   // 每个 (钱包地址 + 代币mint) 对应一个唯一的代币账户
    //   let ata_address = get_associated_token_address(
    //       &wallet_address,    // 钱包地址
    //       &usdc_mint         // USDC的mint地址
    //   );
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint_a, // 这个账户存储mint_a代币
        associated_token::authority = pool_authority, // pool_authority拥有这个账户
    )]
    pub pool_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint_b, // 这个账户存储mint_a代币
        associated_token::authority = pool_authority, // pool_authority拥有这个账户
    )]
    pub pool_account_b: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}