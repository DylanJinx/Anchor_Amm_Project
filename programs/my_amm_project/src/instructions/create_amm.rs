use anchor_lang::prelude::*;

use crate::{errors::*, state::Amm};

pub fn create_amm(
    ctx: Context<CreateAmm>,
    id: Pubkey,
    fee: u16
) -> Result<()> {
    let amm = &mut ctx.accounts.amm;
    amm.admin = ctx.accounts.admin.key();
    amm.id = id;
    amm.fee = fee;

    Ok(())
}

#[derive(Accounts)]
#[instruction(id: Pubkey, fee: u16)]
pub struct CreateAmm<'info>{
    #[account(
        init,
        payer = payer,
        space = Amm::LEN,
        seeds = [id.as_ref()],
        constraint = fee < 10000 @ TutorialError::InvalidFee,
        bump,
    )]
    pub amm: Account<'info, Amm>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Read only, delegatable creation
    pub admin: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}
