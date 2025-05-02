use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("4PpiC9e179ufENLcgmK5NQJKHZ48NepLguqCJPsnBT9A");

#[program]
pub mod reflink {
    use super::*;

    pub fn register_affiliate(ctx: Context<RegisterAffiliate>) -> Result<()> {
        let affiliate = &mut ctx.accounts.affiliate;
        affiliate.authority = ctx.accounts.authority.key();
        affiliate.total_earned = 0;

        Ok(())
    }

    pub fn register_merchant(ctx: Context<RegisterMerchant>, commission_bps: u16) -> Result<()> {
        require!(
            commission_bps <= 10000,
            AffiliateError::InvalidCommissionRate
        );
        let merchant = &mut ctx.accounts.merchant;
        merchant.authority = ctx.accounts.authority.key();
        merchant.commission_bps = commission_bps;
        Ok(())
    }

    pub fn register_referral(ctx: Context<RegisterReferral>, amount: u64) -> Result<()> {
        let referral = &mut ctx.accounts.referral;
        let merchant = &ctx.accounts.merchant;
        let affiliate = &mut ctx.accounts.affiliate;

        // Validate the affiliate account exists
        require!(
            affiliate.authority != Pubkey::default(),
            AffiliateError::InvalidAffiliate
        );

        // Calculate commission amount
        let commission = amount
            .checked_mul(merchant.commission_bps as u64)
            .ok_or(AffiliateError::CalculationError)?
            .checked_div(10_000)
            .ok_or(AffiliateError::CalculationError)?;

        // Calculate merchant amount (total payment minus commission)
        let merchant_amount = amount
            .checked_sub(commission)
            .ok_or(AffiliateError::CalculationError)?;

        // Store referral information
        referral.affiliate = affiliate.key();
        referral.amount = amount;
        referral.commission = commission;
        referral.timestamp = Clock::get()?.unix_timestamp;

        // Update the affiliate's total earned
        affiliate.total_earned = affiliate
            .total_earned
            .checked_add(commission)
            .ok_or(AffiliateError::CalculationError)?;

        // Transfer commission amount directly to affiliate wallet
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.affiliate_wallet.to_account_info(),
                },
            ),
            commission,
        )?;

        // Transfer merchant amount directly to the merchant wallet
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.merchant_wallet.to_account_info(),
                },
            ),
            merchant_amount,
        )?;

        Ok(())
    }
}

#[account]
pub struct Affiliate {
    pub authority: Pubkey,
    pub total_earned: u64, // Track total earnings for historical purposes
}

#[account]
pub struct Referral {
    pub affiliate: Pubkey,
    pub amount: u64,
    pub commission: u64,
    pub timestamp: i64,
}

#[account]
pub struct Merchant {
    pub authority: Pubkey,
    pub commission_bps: u16, // basis points, 500 = 5%
}

#[derive(Accounts)]
pub struct RegisterAffiliate<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8)]
    pub affiliate: Account<'info, Affiliate>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 2)]
    pub merchant: Account<'info, Merchant>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterReferral<'info> {
    #[account(mut)]
    pub affiliate: Account<'info, Affiliate>,

    #[account(init, payer = payer, space = 8 + 32 + 8 + 8 + 8)]
    pub referral: Account<'info, Referral>,

    pub merchant: Account<'info, Merchant>,

    /// The wallet that will receive the merchant's portion of the payment
    #[account(mut)]
    pub merchant_wallet: SystemAccount<'info>,

    /// The wallet that will receive the affiliate's commission
    #[account(mut)]
    pub affiliate_wallet: SystemAccount<'info>,

    /// The wallet that is making the payment
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum AffiliateError {
    #[msg("Invalid commission rate.")]
    InvalidCommissionRate,

    #[msg("Unauthorized.")]
    Unauthorized,

    #[msg("Invalid affiliate.")]
    InvalidAffiliate,

    #[msg("Calculation error.")]
    CalculationError,
}
