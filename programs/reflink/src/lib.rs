use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("2BkHiWJxLd91RWQWWcr97ggCsdA3PY1MTRoC9AJuZad9");

#[program]
pub mod reflink {
    use super::*;

    pub fn initialize_platform(
        ctx: Context<InitializePlatform>,
        platform_fee_basis_points: u16,
    ) -> Result<()> {
        require!(
            platform_fee_basis_points <= 10000,
            RefLinkError::InvalidFeeBasisPoints
        );

        let platform = &mut ctx.accounts.platform;
        platform.authority = ctx.accounts.authority.key();
        platform.fee_basis_points = platform_fee_basis_points;
        platform.bump = ctx.bumps.platform;

        msg!(
            "Reflink platform initialized with fee of {}bp",
            platform_fee_basis_points
        );
        Ok(())
    }

    pub fn create_merchant(ctx: Context<CreateMerchant>, merchant_name: String) -> Result<()> {
        require!(merchant_name.len() <= 50, RefLinkError::NameTooLong);

        let merchant = &mut ctx.accounts.merchant;
        merchant.authority = ctx.accounts.authority.key();
        merchant.name = merchant_name.clone();
        merchant.is_active = true;
        merchant.bump = ctx.bumps.merchant;

        msg!("Merchant account created for {}", merchant_name);
        Ok(())
    }

    pub fn create_affiliate_program(
        ctx: Context<CreateAffiliateProgram>,
        program_name: String,
        referrer_fee_basis_points: u16,
    ) -> Result<()> {
        require!(program_name.len() <= 50, RefLinkError::NameTooLong);
        require!(
            referrer_fee_basis_points <= 10000,
            RefLinkError::InvalidFeeBasisPoints
        );

        let affiliate_program = &mut ctx.accounts.affiliate_program;
        affiliate_program.merchant = ctx.accounts.merchant.key();
        affiliate_program.name = program_name.clone();
        affiliate_program.referrer_fee_basis_points = referrer_fee_basis_points;
        affiliate_program.is_active = true;
        affiliate_program.bump = ctx.bumps.affiliate_program;

        msg!(
            "Affiliate program '{}' created with referrer fee of {}bp",
            program_name,
            referrer_fee_basis_points
        );
        Ok(())
    }

    pub fn create_referral_link(
        ctx: Context<CreateReferralLink>,
        unique_code: String,
    ) -> Result<()> {
        require!(unique_code.len() <= 20, RefLinkError::RefCodeTooLong);

        let referral_link = &mut ctx.accounts.referral_link;
        referral_link.affiliate_program = ctx.accounts.affiliate_program.key();
        referral_link.referrer = ctx.accounts.referrer.key();
        referral_link.code = unique_code.clone();
        referral_link.click_count = 0;
        referral_link.conversion_count = 0;
        referral_link.total_sales = 0;
        referral_link.total_commission = 0;
        referral_link.is_active = true;
        referral_link.bump = ctx.bumps.referral_link;

        msg!("Referral link created with code: {}", unique_code);
        Ok(())
    }

    pub fn process_sale(ctx: Context<ProcessSale>, amount: u64) -> Result<()> {
        // Validate the transaction
        require!(amount > 0, RefLinkError::InvalidAmount);
        require!(
            ctx.accounts.affiliate_program.is_active,
            RefLinkError::InactiveAffiliateProgram
        );
        require!(
            ctx.accounts.referral_link.is_active,
            RefLinkError::InactiveReferralLink
        );

        // Calculate commission amounts
        let platform_fee_basis_points = ctx.accounts.platform.fee_basis_points;
        let referrer_fee_basis_points = ctx.accounts.affiliate_program.referrer_fee_basis_points;

        // Calculate fees (10000 basis points = 100%)
        let platform_fee = amount
            .checked_mul(platform_fee_basis_points as u64)
            .unwrap()
            .checked_div(10000)
            .unwrap();

        let referrer_fee = amount
            .checked_mul(referrer_fee_basis_points as u64)
            .unwrap()
            .checked_div(10000)
            .unwrap();

        let merchant_amount = amount
            .checked_sub(platform_fee)
            .unwrap()
            .checked_sub(referrer_fee)
            .unwrap();

        // Transfer platform fee
        if platform_fee > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.buyer_token_account.to_account_info(),
                        to: ctx.accounts.platform_token_account.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                platform_fee,
            )?;
        }

        // Transfer referrer commission
        if referrer_fee > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.buyer_token_account.to_account_info(),
                        to: ctx.accounts.referrer_token_account.to_account_info(),
                        authority: ctx.accounts.buyer.to_account_info(),
                    },
                ),
                referrer_fee,
            )?;

            // Update the referral link statistics
            let referral_link = &mut ctx.accounts.referral_link;
            referral_link.conversion_count = referral_link.conversion_count.checked_add(1).unwrap();
            referral_link.total_sales = referral_link.total_sales.checked_add(amount).unwrap();
            referral_link.total_commission = referral_link
                .total_commission
                .checked_add(referrer_fee)
                .unwrap();
        }

        // Transfer merchant amount
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_token_account.to_account_info(),
                    to: ctx.accounts.merchant_token_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            merchant_amount,
        )?;

        msg!("Sale processed: {} total amount", amount);
        msg!("  Merchant received: {}", merchant_amount);
        msg!("  Referrer commission: {}", referrer_fee);
        msg!("  Platform fee: {}", platform_fee);

        Ok(())
    }

    pub fn increment_click(ctx: Context<IncrementClick>) -> Result<()> {
        let referral_link = &mut ctx.accounts.referral_link;
        require!(referral_link.is_active, RefLinkError::InactiveReferralLink);

        referral_link.click_count = referral_link.click_count.checked_add(1).unwrap();

        msg!("Click tracked for referral link: {}", referral_link.code);
        Ok(())
    }

    pub fn update_platform_fee(
        ctx: Context<UpdatePlatformFee>,
        new_fee_basis_points: u16,
    ) -> Result<()> {
        require!(
            new_fee_basis_points <= 10000,
            RefLinkError::InvalidFeeBasisPoints
        );

        let platform = &mut ctx.accounts.platform;
        platform.fee_basis_points = new_fee_basis_points;

        msg!("Platform fee updated to {}bp", new_fee_basis_points);
        Ok(())
    }

    pub fn toggle_merchant_status(ctx: Context<ToggleMerchantStatus>) -> Result<()> {
        let merchant = &mut ctx.accounts.merchant;
        merchant.is_active = !merchant.is_active;

        let status = if merchant.is_active {
            "active"
        } else {
            "inactive"
        };
        msg!("Merchant status toggled to: {}", status);
        Ok(())
    }

    pub fn toggle_affiliate_program_status(
        ctx: Context<ToggleAffiliateProgramStatus>,
    ) -> Result<()> {
        let affiliate_program = &mut ctx.accounts.affiliate_program;
        affiliate_program.is_active = !affiliate_program.is_active;

        let status = if affiliate_program.is_active {
            "active"
        } else {
            "inactive"
        };
        msg!("Affiliate program status toggled to: {}", status);
        Ok(())
    }

    pub fn toggle_referral_link_status(ctx: Context<ToggleReferralLinkStatus>) -> Result<()> {
        let referral_link = &mut ctx.accounts.referral_link;
        referral_link.is_active = !referral_link.is_active;

        let status = if referral_link.is_active {
            "active"
        } else {
            "inactive"
        };
        msg!("Referral link status toggled to: {}", status);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePlatform<'info> {
    #[account(
        init,
        payer = authority,
        space = Platform::LEN,
        seeds = [b"platform"],
        bump
    )]
    pub platform: Account<'info, Platform>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateMerchant<'info> {
    #[account(
        init,
        payer = authority,
        space = Merchant::LEN,
        seeds = [b"merchant", authority.key().as_ref()],
        bump
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateAffiliateProgram<'info> {
    #[account(
        init,
        payer = authority,
        space = AffiliateProgram::LEN,
        seeds = [b"affiliate_program", merchant.key().as_ref()],
        bump
    )]
    pub affiliate_program: Account<'info, AffiliateProgram>,

    #[account(
        constraint = merchant.authority == authority.key() @ RefLinkError::NotMerchantAuthority,
        constraint = merchant.is_active @ RefLinkError::InactiveMerchant
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateReferralLink<'info> {
    #[account(
        init,
        payer = referrer,
        space = ReferralLink::LEN,
        seeds = [
            b"referral_link", 
            affiliate_program.key().as_ref(),
            referrer.key().as_ref()
        ],
        bump
    )]
    pub referral_link: Account<'info, ReferralLink>,

    #[account(
        constraint = affiliate_program.is_active @ RefLinkError::InactiveAffiliateProgram
    )]
    pub affiliate_program: Account<'info, AffiliateProgram>,

    #[account(mut)]
    pub referrer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessSale<'info> {
    pub platform: Account<'info, Platform>,

    pub merchant: Account<'info, Merchant>,

    #[account(
        constraint = affiliate_program.merchant == merchant.key() @ RefLinkError::InvalidAffiliateProgramMerchant
    )]
    pub affiliate_program: Account<'info, AffiliateProgram>,

    #[account(
        constraint = referral_link.affiliate_program == affiliate_program.key() @ RefLinkError::InvalidReferralLinkAffiliateProgram,
        mut
    )]
    pub referral_link: Account<'info, ReferralLink>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        constraint = buyer_token_account.owner == buyer.key() @ RefLinkError::InvalidOwner
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = merchant_token_account.owner == merchant.authority @ RefLinkError::InvalidOwner
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = referrer_token_account.owner == referral_link.referrer @ RefLinkError::InvalidOwner
    )]
    pub referrer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = platform_token_account.owner == platform.authority @ RefLinkError::InvalidOwner
    )]
    pub platform_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct IncrementClick<'info> {
    #[account(mut)]
    pub referral_link: Account<'info, ReferralLink>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePlatformFee<'info> {
    #[account(
        mut,
        constraint = platform.authority == authority.key() @ RefLinkError::NotPlatformAuthority
    )]
    pub platform: Account<'info, Platform>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ToggleMerchantStatus<'info> {
    #[account(
        mut,
        constraint = merchant.authority == authority.key() @ RefLinkError::NotMerchantAuthority
    )]
    pub merchant: Account<'info, Merchant>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ToggleAffiliateProgramStatus<'info> {
    #[account(
        mut,
        constraint = affiliate_program.merchant == merchant.key() @ RefLinkError::InvalidAffiliateProgramMerchant,
        constraint = merchant.authority == authority.key() @ RefLinkError::NotMerchantAuthority
    )]
    pub affiliate_program: Account<'info, AffiliateProgram>,

    pub merchant: Account<'info, Merchant>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ToggleReferralLinkStatus<'info> {
    #[account(
        mut,
        constraint = referral_link.referrer == authority.key() @ RefLinkError::NotReferrer
    )]
    pub referral_link: Account<'info, ReferralLink>,

    pub authority: Signer<'info>,
}

#[account]
pub struct Platform {
    pub authority: Pubkey,
    pub fee_basis_points: u16, // 100 = 1%, 10000 = 100%
    pub bump: u8,
}

impl Platform {
    pub const LEN: usize = 8 + // discriminator
        32 +                   // authority
        2 +                    // fee_basis_points
        1; // bump
}

#[account]
pub struct Merchant {
    pub authority: Pubkey,
    pub name: String, // merchant store name
    pub is_active: bool,
    pub bump: u8,
}

impl Merchant {
    pub const LEN: usize = 8 + // discriminator
        32 +                   // authority
        4 + 50 +               // name (max length 50)
        1 +                    // is_active
        1; // bump
}

#[account]
pub struct AffiliateProgram {
    pub merchant: Pubkey,               // merchant public key
    pub name: String,                   // program name
    pub referrer_fee_basis_points: u16, // 100 = 1%, 10000 = 100%
    pub is_active: bool,
    pub bump: u8,
}

impl AffiliateProgram {
    pub const LEN: usize = 8 + // discriminator
        32 +                   // merchant
        4 + 50 +               // name (max length 50)
        2 +                    // referrer_fee_basis_points
        1 +                    // is_active
        1; // bump
}

#[account]
pub struct ReferralLink {
    pub affiliate_program: Pubkey, // affiliate program this link belongs to
    pub referrer: Pubkey,          // referrer public key
    pub code: String,              // unique referral code
    pub click_count: u64,          // number of clicks
    pub conversion_count: u64,     // number of conversions
    pub total_sales: u64,          // total sales amount
    pub total_commission: u64,     // total commission earned
    pub is_active: bool,
    pub bump: u8,
}

impl ReferralLink {
    pub const LEN: usize = 8 + // discriminator
        32 +                   // affiliate_program
        32 +                   // referrer
        4 + 20 +               // code (max length 20)
        8 +                    // click_count
        8 +                    // conversion_count
        8 +                    // total_sales
        8 +                    // total_commission
        1 +                    // is_active
        1; // bump
}

#[error_code]
pub enum RefLinkError {
    #[msg("Fee basis points must be <= 10000")]
    InvalidFeeBasisPoints,

    #[msg("Name too long")]
    NameTooLong,

    #[msg("Referral code too long")]
    RefCodeTooLong,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Not platform authority")]
    NotPlatformAuthority,

    #[msg("Not merchant authority")]
    NotMerchantAuthority,

    #[msg("Not referrer")]
    NotReferrer,

    #[msg("Invalid affiliate program merchant")]
    InvalidAffiliateProgramMerchant,

    #[msg("Invalid referral link affiliate program")]
    InvalidReferralLinkAffiliateProgram,

    #[msg("Invalid token account owner")]
    InvalidOwner,

    #[msg("Merchant is inactive")]
    InactiveMerchant,

    #[msg("Affiliate program is inactive")]
    InactiveAffiliateProgram,

    #[msg("Referral link is inactive")]
    InactiveReferralLink,
}
