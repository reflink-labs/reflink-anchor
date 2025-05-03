use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("4PpiC9e179ufENLcgmK5NQJKHZ48NepLguqCJPsnBT9A");

#[program]
pub mod reflink {
    use super::*;

    pub fn register_affiliate(ctx: Context<RegisterAffiliate>) -> Result<()> {
        let affiliate = &mut ctx.accounts.affiliate;
        affiliate.authority = ctx.accounts.authority.key();
        affiliate.total_earned = 0;
        affiliate.total_referrals = 0;

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
        merchant.active = true;
        Ok(())
    }

    // Native SOL payment handling
    pub fn register_referral_sol(ctx: Context<RegisterReferralSol>, amount: u64) -> Result<()> {
        let referral = &mut ctx.accounts.referral;
        let merchant = &ctx.accounts.merchant;
        let affiliate = &mut ctx.accounts.affiliate;

        // Validate the merchant is active
        require!(merchant.active, AffiliateError::InactiveMerchant);

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
        referral.merchant = merchant.key();
        referral.amount = amount;
        referral.commission = commission;
        referral.timestamp = Clock::get()?.unix_timestamp;
        referral.is_token = false;
        referral.token_mint = Pubkey::default(); // No token for SOL payments

        // Update the affiliate's total earned and referrals
        affiliate.total_earned = affiliate
            .total_earned
            .checked_add(commission)
            .ok_or(AffiliateError::CalculationError)?;

        affiliate.total_referrals = affiliate
            .total_referrals
            .checked_add(1)
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

    // SPL Token payment handling
    pub fn register_referral_token(ctx: Context<RegisterReferralToken>, amount: u64) -> Result<()> {
        let referral = &mut ctx.accounts.referral;
        let merchant = &ctx.accounts.merchant;
        let affiliate = &mut ctx.accounts.affiliate;
        let token_mint = ctx.accounts.token_mint.key();

        // Validate the merchant is active
        require!(merchant.active, AffiliateError::InactiveMerchant);

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
        referral.merchant = merchant.key();
        referral.amount = amount;
        referral.commission = commission;
        referral.timestamp = Clock::get()?.unix_timestamp;
        referral.is_token = true;
        referral.token_mint = token_mint;

        // Update the affiliate's total earned and referrals
        // Note: This is just counting in raw numbers, not token value
        affiliate.total_earned = affiliate
            .total_earned
            .checked_add(commission)
            .ok_or(AffiliateError::CalculationError)?;

        affiliate.total_referrals = affiliate
            .total_referrals
            .checked_add(1)
            .ok_or(AffiliateError::CalculationError)?;

        // Transfer commission tokens to affiliate wallet
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.affiliate_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            commission,
        )?;

        // Transfer merchant tokens to merchant wallet
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer_token_account.to_account_info(),
                    to: ctx.accounts.merchant_token_account.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            merchant_amount,
        )?;

        Ok(())
    }

    // Allow merchants to update their commission rates
    pub fn update_merchant_commission(
        ctx: Context<UpdateMerchant>,
        new_commission_bps: u16,
    ) -> Result<()> {
        require!(
            new_commission_bps <= 10000,
            AffiliateError::InvalidCommissionRate
        );

        let merchant = &mut ctx.accounts.merchant;

        // Only the merchant authority can update the commission
        require!(
            merchant.authority == ctx.accounts.authority.key(),
            AffiliateError::Unauthorized
        );

        merchant.commission_bps = new_commission_bps;

        Ok(())
    }

    // Allow merchants to toggle their active status
    pub fn toggle_merchant_status(ctx: Context<UpdateMerchant>) -> Result<()> {
        let merchant = &mut ctx.accounts.merchant;

        // Only the merchant authority can toggle status
        require!(
            merchant.authority == ctx.accounts.authority.key(),
            AffiliateError::Unauthorized
        );

        merchant.active = !merchant.active;

        Ok(())
    }
}

#[account]
pub struct Affiliate {
    pub authority: Pubkey,
    pub total_earned: u64,    // Total earnings (raw numbers, not actual value)
    pub total_referrals: u64, // Total number of referrals made
}

#[account]
pub struct Referral {
    pub affiliate: Pubkey,
    pub merchant: Pubkey, // Added merchant reference
    pub amount: u64,
    pub commission: u64,
    pub timestamp: i64,
    pub is_token: bool,     // Indicates if this is a token payment
    pub token_mint: Pubkey, // The mint address for token payments (default for SOL)
}

#[account]
pub struct Merchant {
    pub authority: Pubkey,
    pub commission_bps: u16, // basis points, 500 = 5%
    pub active: bool,        // Allows merchants to pause their program
}

#[derive(Accounts)]
pub struct RegisterAffiliate<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8 + 8)]
    pub affiliate: Account<'info, Affiliate>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 2 + 1)]
    pub merchant: Account<'info, Merchant>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterReferralSol<'info> {
    #[account(mut)]
    pub affiliate: Account<'info, Affiliate>,

    #[account(init, payer = payer, space = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 32)]
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

#[derive(Accounts)]
pub struct RegisterReferralToken<'info> {
    #[account(mut)]
    pub affiliate: Account<'info, Affiliate>,

    #[account(init, payer = payer, space = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 32)]
    pub referral: Account<'info, Referral>,

    pub merchant: Account<'info, Merchant>,

    /// The token mint being used for payment
    pub token_mint: Account<'info, token::Mint>,

    /// The merchant's token account that will receive payment
    #[account(mut, constraint = merchant_token_account.mint == token_mint.key())]
    pub merchant_token_account: Account<'info, TokenAccount>,

    /// The affiliate's token account that will receive commission
    #[account(mut, constraint = affiliate_token_account.mint == token_mint.key())]
    pub affiliate_token_account: Account<'info, TokenAccount>,

    /// The payer's token account
    #[account(mut, constraint = payer_token_account.mint == token_mint.key(),
              constraint = payer_token_account.owner == payer.key())]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// The wallet that is making the payment
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMerchant<'info> {
    #[account(mut, constraint = merchant.authority == authority.key())]
    pub merchant: Account<'info, Merchant>,

    pub authority: Signer<'info>,
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

    #[msg("Merchant is not active.")]
    InactiveMerchant,
}
