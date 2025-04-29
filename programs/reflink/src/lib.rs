use anchor_lang::prelude::*;

declare_id!("4PpiC9e179ufENLcgmK5NQJKHZ48NepLguqCJPsnBT9A");

#[program]
pub mod reflink {
    use super::*;

    pub fn create_promotion(ctx: Context<CreatePromotion>, commission_rate: u8) -> Result<()> {
        let promotion = &mut ctx.accounts.promotion;
        promotion.merchant = ctx.accounts.merchant.key();
        promotion.commission_rate = commission_rate;
        promotion.is_open = true;
        Ok(())
    }

    pub fn promote(ctx: Context<Promote>) -> Result<()> {
        let promotion_link = &mut ctx.accounts.promotion_link;
        promotion_link.promoter = ctx.accounts.promoter.key();
        promotion_link.promotion = ctx.accounts.promotion.key();
        Ok(())
    }

    pub fn close_promotion(ctx: Context<ClosePromotion>) -> Result<()> {
        let promotion = &mut ctx.accounts.promotion;
        require_keys_eq!(
            promotion.merchant,
            ctx.accounts.merchant.key(),
            ReflinkError::Unauthorized
        );
        promotion.is_open = false;
        Ok(())
    }

    pub fn purchase(ctx: Context<Purchase>, total_amount: u64) -> Result<()> {
        let promotion = &ctx.accounts.promotion;
        require!(promotion.is_open, ReflinkError::PromotionClosed);

        let commission_percentage = promotion.commission_rate as u64;
        let platform_fee_percentage = 1u64;

        require!(
            commission_percentage + platform_fee_percentage <= 100,
            ReflinkError::InvalidCommissionRate
        );

        let promoter_amount = total_amount
            .checked_mul(commission_percentage)
            .unwrap()
            .checked_div(100)
            .unwrap();
        let platform_amount = total_amount
            .checked_mul(platform_fee_percentage)
            .unwrap()
            .checked_div(100)
            .unwrap();
        let merchant_amount = total_amount
            .checked_sub(promoter_amount)
            .unwrap()
            .checked_sub(platform_amount)
            .unwrap();

        // Only SOL transfers
        system_program_transfer(
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.buyer.to_account_info(),
            ctx.accounts.promoter.to_account_info(),
            promoter_amount,
        )?;
        system_program_transfer(
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.buyer.to_account_info(),
            ctx.accounts.merchant.to_account_info(),
            merchant_amount,
        )?;
        system_program_transfer(
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.buyer.to_account_info(),
            ctx.accounts.platform.to_account_info(),
            platform_amount,
        )?;

        Ok(())
    }
}

//
// Helper function
//

fn system_program_transfer<'info>(
    system_program: AccountInfo<'info>,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let cpi_ctx = CpiContext::new(
        system_program,
        anchor_lang::system_program::Transfer { from, to },
    );
    anchor_lang::system_program::transfer(cpi_ctx, amount)
}

//
// Data Accounts
//

#[account]
pub struct Promotion {
    pub merchant: Pubkey,
    pub commission_rate: u8,
    pub is_open: bool,
}

#[account]
pub struct PromotionLink {
    pub promoter: Pubkey,
    pub promotion: Pubkey,
}

//
// Contexts
//

#[derive(Accounts)]
pub struct CreatePromotion<'info> {
    #[account(init, payer = merchant, space = Promotion::LEN)]
    pub promotion: Account<'info, Promotion>,
    #[account(mut)]
    pub merchant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Promote<'info> {
    #[account(
        init_if_needed,
        payer = promoter,
        space = PromotionLink::LEN,
        seeds = [b"promotion_link", promoter.key().as_ref(), promotion.key().as_ref()],
        bump
    )]
    pub promotion_link: Account<'info, PromotionLink>,

    #[account(mut)]
    pub promoter: Signer<'info>,
    pub promotion: Account<'info, Promotion>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePromotion<'info> {
    #[account(mut)]
    pub promotion: Account<'info, Promotion>,
    #[account(mut)]
    pub merchant: Signer<'info>,
}

#[derive(Accounts)]
pub struct Purchase<'info> {
    pub promotion: Account<'info, Promotion>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut)]
    pub promoter: SystemAccount<'info>,
    #[account(mut)]
    pub merchant: SystemAccount<'info>,
    #[account(mut)]
    pub platform: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

//
// Errors
//

#[error_code]
pub enum ReflinkError {
    #[msg("The promotion is already closed.")]
    PromotionClosed,
    #[msg("Unauthorized action.")]
    Unauthorized,
    #[msg("Invalid commission rate.")]
    InvalidCommissionRate,
}

//
// Account Sizes
//

impl Promotion {
    const LEN: usize = 8 + 32 + 1 + 1; // anchor discriminator + pubkey + u8 + bool
}

impl PromotionLink {
    const LEN: usize = 8 + 32 + 32; // anchor discriminator + 2 pubkeys
}
