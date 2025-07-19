use anchor_lang::prelude::*;

#[error_code]
pub enum TutorialError {
    #[msg("Invalid fee value")]
    InvalidFee,  // 手续费值无效（通常是超过100%）

    #[msg("Invalid mint for the pool")]
    InvalidMint,  // 池子的代币mint地址无效

    #[msg("Depositing too little liquidity")]
    DepositTooSmall,  // 存入的流动性太少

    #[msg("Output is below the minimum expected")]
    OutputTooSmall,  // 交换输出低于最小期望值（滑点保护）

    #[msg("Invariant does not hold")]
    InvariantViolated,  // 变量被违反（AMM的核心数学规则被破坏）
}