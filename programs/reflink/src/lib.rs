use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("2BkHiWJxLd91RWQWWcr97ggCsdA3PY1MTRoC9AJuZad9");

#[program]
pub mod reflink {
    use super::*;

    // Merchant Management
    pub fn register_merchant(
        ctx: Context<RegisterMerchant>,
        name: String,
        commission_rate: u8,
        website_url: String,
    ) -> Result<()> {
        require!(commission_rate <= 100, ErrorCode::InvalidCommissionRate);

        let merchant = &mut ctx.accounts.merchant;
        merchant.authority = ctx.accounts.authority.key();
        merchant.name = name;
        merchant.commission_rate = commission_rate;
        merchant.website_url = website_url;
        merchant.total_revenue = 0;
        merchant.total_referrals = 0;
        merchant.is_active = true;
        merchant.bump = ctx.bumps.merchant;

        Ok(())
    }

    pub fn update_merchant(
        ctx: Context<UpdateMerchant>,
        name: Option<String>,
        commission_rate: Option<u8>,
        website_url: Option<String>,
        is_active: Option<bool>,
    ) -> Result<()> {
        let merchant = &mut ctx.accounts.merchant;

        if let Some(new_name) = name {
            merchant.name = new_name;
        }

        if let Some(new_rate) = commission_rate {
            require!(new_rate <= 100, ErrorCode::InvalidCommissionRate);
            merchant.commission_rate = new_rate;
        }

        if let Some(new_url) = website_url {
            merchant.website_url = new_url;
        }

        if let Some(active_status) = is_active {
            merchant.is_active = active_status;
        }

        Ok(())
    }

    // Affiliate Management
    pub fn register_affiliate(ctx: Context<RegisterAffiliate>, name: String) -> Result<()> {
        let affiliate = &mut ctx.accounts.affiliate;
        affiliate.authority = ctx.accounts.authority.key();
        affiliate.name = name;
        affiliate.total_commission = 0;
        affiliate.total_referrals = 0;
        affiliate.bump = ctx.bumps.affiliate;

        Ok(())
    }

    pub fn update_affiliate(ctx: Context<UpdateAffiliate>, name: Option<String>) -> Result<()> {
        let affiliate = &mut ctx.accounts.affiliate;

        if let Some(new_name) = name {
            affiliate.name = new_name;
        }

        Ok(())
    }

    // Affiliate-Merchant Relationship
    pub fn join_merchant(ctx: Context<JoinMerchant>) -> Result<()> {
        let relation = &mut ctx.accounts.affiliate_merchant;
        relation.merchant = ctx.accounts.merchant.key();
        relation.affiliate = ctx.accounts.affiliate.key();
        relation.commission_earned = 0;
        relation.successful_referrals = 0;
        relation.bump = ctx.bumps.affiliate_merchant;

        Ok(())
    }

    // Customer Purchase
    pub fn process_purchase(ctx: Context<ProcessPurchase>, amount: u64) -> Result<()> {
        // Calculate commission
        let merchant = &ctx.accounts.merchant;
        let commission_rate = merchant.commission_rate as u64;
        let commission_amount = (amount * commission_rate) / 100;
        let merchant_amount = amount - commission_amount;

        // Transfer commission to affiliate
        if commission_amount > 0 {
            let cpi_accounts = Transfer {
                from: ctx.accounts.customer_token_account.to_account_info(),
                to: ctx.accounts.affiliate_token_account.to_account_info(),
                authority: ctx.accounts.customer.to_account_info(),
            };
            let cpi_program = ctx.accounts.token_program.to_account_info();
            let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
            token::transfer(cpi_ctx, commission_amount)?;
        }

        // Transfer remainder to merchant
        let cpi_accounts = Transfer {
            from: ctx.accounts.customer_token_account.to_account_info(),
            to: ctx.accounts.merchant_token_account.to_account_info(),
            authority: ctx.accounts.customer.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, merchant_amount)?;

        // Update statistics
        let merchant_account = &mut ctx.accounts.merchant;
        merchant_account.total_revenue =
            merchant_account.total_revenue.checked_add(amount).unwrap();
        merchant_account.total_referrals = merchant_account.total_referrals.checked_add(1).unwrap();

        let affiliate_account = &mut ctx.accounts.affiliate;
        affiliate_account.total_commission = affiliate_account
            .total_commission
            .checked_add(commission_amount)
            .unwrap();
        affiliate_account.total_referrals =
            affiliate_account.total_referrals.checked_add(1).unwrap();

        let relation = &mut ctx.accounts.affiliate_merchant;
        relation.commission_earned = relation
            .commission_earned
            .checked_add(commission_amount)
            .unwrap();
        relation.successful_referrals = relation.successful_referrals.checked_add(1).unwrap();

        Ok(())
    }
}

// Account Structures
#[account]
pub struct Merchant {
    pub authority: Pubkey,    // Merchant wallet address
    pub name: String,         // Name of the merchant
    pub commission_rate: u8,  // Commission percentage (0-100)
    pub website_url: String,  // Website URL
    pub total_revenue: u64,   // Total revenue earned
    pub total_referrals: u64, // Total number of referrals
    pub is_active: bool,      // Merchant status
    pub bump: u8,             // PDA bump
}

#[account]
pub struct Affiliate {
    pub authority: Pubkey,     // Affiliate wallet address
    pub name: String,          // Name of the affiliate
    pub total_commission: u64, // Total commission earned
    pub total_referrals: u64,  // Total successful referrals
    pub bump: u8,              // PDA bump
}

#[account]
pub struct AffiliateMerchant {
    pub merchant: Pubkey,          // Merchant PDA
    pub affiliate: Pubkey,         // Affiliate PDA
    pub commission_earned: u64,    // Commission earned from this merchant
    pub successful_referrals: u64, // Successful referrals for this merchant
    pub bump: u8,                  // PDA bump
}

// Context Structures
#[derive(Accounts)]
pub struct InitializeProgram<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterMerchant<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 4 + 50 + 1 + 4 + 100 + 8 + 8 + 1 + 1, // Allocate space for Merchant account
        seeds = [b"merchant", authority.key().as_ref()],
        bump
    )]
    pub merchant: Account<'info, Merchant>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMerchant<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"merchant", authority.key().as_ref()],
        bump = merchant.bump,
        constraint = merchant.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub merchant: Account<'info, Merchant>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterAffiliate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 4 + 50 + 8 + 8 + 1, // Allocate space for Affiliate account
        seeds = [b"affiliate", authority.key().as_ref()],
        bump
    )]
    pub affiliate: Account<'info, Affiliate>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAffiliate<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"affiliate", authority.key().as_ref()],
        bump = affiliate.bump,
        constraint = affiliate.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub affiliate: Account<'info, Affiliate>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinMerchant<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"affiliate", authority.key().as_ref()],
        bump = affiliate.bump,
        constraint = affiliate.authority == authority.key() @ ErrorCode::Unauthorized
    )]
    pub affiliate: Account<'info, Affiliate>,

    #[account(
        seeds = [b"merchant", merchant.authority.as_ref()],
        bump = merchant.bump,
        constraint = merchant.is_active @ ErrorCode::MerchantInactive
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 8 + 1, // Allocate space for AffiliateMerchant account
        seeds = [b"affiliate-merchant", affiliate.key().as_ref(), merchant.key().as_ref()],
        bump
    )]
    pub affiliate_merchant: Account<'info, AffiliateMerchant>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProcessPurchase<'info> {
    #[account(mut)]
    pub customer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"merchant", merchant.authority.as_ref()],
        bump = merchant.bump,
        constraint = merchant.is_active @ ErrorCode::MerchantInactive
    )]
    pub merchant: Account<'info, Merchant>,

    #[account(
        mut,
        seeds = [b"affiliate", affiliate.authority.as_ref()],
        bump = affiliate.bump
    )]
    pub affiliate: Account<'info, Affiliate>,

    #[account(
        mut,
        seeds = [b"affiliate-merchant", affiliate.key().as_ref(), merchant.key().as_ref()],
        bump = affiliate_merchant.bump
    )]
    pub affiliate_merchant: Account<'info, AffiliateMerchant>,

    #[account(mut)]
    pub customer_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = affiliate_token_account.owner == affiliate.authority @ ErrorCode::InvalidTokenAccount
    )]
    pub affiliate_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = merchant_token_account.owner == merchant.authority @ ErrorCode::InvalidTokenAccount
    )]
    pub merchant_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action")]
    Unauthorized,

    #[msg("Commission rate must be between 0 and 100")]
    InvalidCommissionRate,

    #[msg("Merchant is not active")]
    MerchantInactive,

    #[msg("Invalid token account")]
    InvalidTokenAccount,
}
