use anchor_lang::prelude::*;

// The minimum amount of liquidity
#[constant]
pub const MINIMUM_LIQUIDITY: u64 = 100;

// Seed of the permission account
#[constant]
pub const AUTHORITY_SEED: &[u8] = b"authority";

// Seeds related to liquidity
#[constant]
pub const LIQUIDITY_SEED: &[u8] = b"liquidity";

