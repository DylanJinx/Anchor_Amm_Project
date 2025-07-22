use anchor_lang::prelude::*;

// self的含义：导入模块本身，这样我们可以：
//   - 调用token::transfer() ← 使用模块函数
//   - 同时使用Transfer ← 使用模块中的结构体
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, MintTo, Transfer},
};
// 固定点数学库，用于精确计算：
// - I64F64 = 64位整数 + 64位小数
// - 避免浮点数精度丢失问题
// - 区块链上不能用浮点数，必须用整数或固定点
use fixed::types::I64F64;

use crate::{
    constants::{AUTHORITY_SEED, LIQUIDITY_SEED, MINIMUM_LIQUIDITY},
    errors::TutorialError,
    state::Pool,
};


// deposit_liquidity函数不仅用来添加流动性，还承担了设置初始价格比例的职责。
pub fn deposit_liquidity(
    ctx: Context<DepositLiquidity>,
    amount_a: u64,
    amount_b: u64,
) -> Result<()> {
    // 防止存款人存入不属于自己的资产
    let mut amount_a = if amount_a > ctx.accounts.depositor_account_a.amount {
        ctx.accounts.depositor_account_a.amount
    } else {
        amount_a
    };

    let mut amount_b = if amount_b > ctx.accounts.depositor_account_b.amount {
        ctx.accounts.depositor_account_b.amount
    } else {
        amount_b
    };

    // 确保按照与现有流动性相同的比例提供
    let pool_a = &ctx.accounts.pool_account_a;
    let pool_b = &ctx.accounts.pool_account_b;
    
    // 这样定义"池子创建"（让第一次deposit设置比例）会导致frontrun攻击风险
    let pool_creation = pool_a.amount == 0 && pool_b.amount == 0;
    
    (amount_a, amount_b) = if pool_creation {
        // 如果没有流动性，就按原样添加
        (amount_a, amount_b)
    } else {
        // 池子不为空，必须按现有比例调整
        
        // ratio = x / y
        // let ratio = pool_a.amount * pool_b.amount;
        let ratio = I64F64::from_num(pool_a.amount).checked_div(I64F64::from_num(pool_b.amount)).unwrap();

        if pool_a.amount > pool_b.amount {
            (
                I64F64::from_num(amount_b).checked_mul(ratio).unwrap().to_num::<u64>(),
                amount_b
            ) 
        } else {
            (
                amount_a,
                I64F64::from_num(amount_a).checked_div(ratio).unwrap().to_num::<u64>()
            )
        }
    };

    // 计算存入的流动性数量
    let mut liquidity = I64F64::from_num(amount_a).checked_mul(I64F64::from_num(amount_b)).unwrap().sqrt().to_num::<u64>();

    // 在第一次存款时锁定一些最小流动性
    if pool_creation {
        if liquidity < MINIMUM_LIQUIDITY {
            return err!(TutorialError::DepositTooSmall);
        }
        liquidity -= MINIMUM_LIQUIDITY;
    }

    // 将代币转移到池子
    // token a
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor_account_a.to_account_info(),
                to: ctx.accounts.pool_account_a.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount_a,
    )?;

    // token b
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.depositor_account_b.to_account_info(),
                to: ctx.accounts.pool_account_b.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount_b,
    )?;

    // 给用户铸造LP代币
    let authority_bump = ctx.bumps.pool_authority;
    let authority_seeds = &[
        &ctx.accounts.pool.amm.to_bytes(),
        &ctx.accounts.mint_a.key().to_bytes(),
        &ctx.accounts.mint_b.key().to_bytes(),
        AUTHORITY_SEED,
        &[authority_bump],
    ];
    let signer_seeds = &[&authority_seeds[..]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint_liquidity.to_account_info(),
                to: ctx.accounts.depositor_account_liquidity.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            signer_seeds,
        ),
        liquidity,
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {

    #[account(
        seeds = [  // 验证传入的pool账户地址确实是基于这些数据生成的正确PDA
            pool.amm.as_ref(),
            pool.mint_a.key().as_ref(),
            pool.mint_b.key().as_ref(),
        ],
        bump,
        has_one = mint_a, // 等价于 assert!(pool.mint_a == mint_a.key())
        has_one = mint_b,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        seeds = [
            pool.amm.as_ref(),
            mint_a.key().as_ref(),  // = pool.mint_a.key().as_ref()
            mint_b.key().as_ref(),
            AUTHORITY_SEED
        ],
        bump,
    )]
    /// CHECK: Read only authority
    pub pool_authority: AccountInfo<'info>,

    #[account(
        //mint_to操作会修改mint账户的状态：
        //   - 增加总供应量(supply)
        //   - 更新账户数据
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
        // mut // error: mut cannot be provided with initrust-analyzermacro-error
        payer = payer,
        associated_token::mint = mint_liquidity,
        associated_token::authority = depositor,
    )]
    pub depositor_account_liquidity: Box<Account<'info, TokenAccount>>,

    /// The account paying for all rents
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = depositor,
    )]
    pub depositor_account_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = depositor,
    )]
    pub depositor_account_b: Box<Account<'info, TokenAccount>>,

    pub depositor: Signer<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}