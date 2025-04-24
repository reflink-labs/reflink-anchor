use anchor_lang::prelude::*;

declare_id!("4PpiC9e179ufENLcgmK5NQJKHZ48NepLguqCJPsnBT9A");

#[program]
pub mod reflink {
    use super::*;

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: String,
        referral_reward_bps: u16, // in basis points (1% = 100)
    ) -> Result<()> {
        require!(
            referral_reward_bps <= 10_000,
            CustomError::InvalidRewardPercentage
        );

        let campaign: &mut Account<'_, Campaign> = &mut ctx.accounts.campaign;
        campaign.merchant = ctx.accounts.merchant.key();
        campaign.campaign_id = campaign_id;
        campaign.referral_reward_bps = referral_reward_bps;
        campaign.total_earned = 0;
        Ok(())
    }

    pub fn log_conversion(
        ctx: Context<LogConversion>,
        event_type: String,
        metadata: String,
        amount: u64,
    ) -> Result<()> {
        let referral: &mut Account<'_, ReferralRecord> = &mut ctx.accounts.referral_record;
        referral.referrer = ctx.accounts.referrer.key();
        referral.customer = ctx.accounts.customer.key();
        referral.event_type = event_type;
        referral.metadata = metadata;
        referral.timestamp = Clock::get()?.unix_timestamp;
        referral.amount = amount;

        let reward_bps: u16 = ctx.accounts.campaign.referral_reward_bps;
        let referrer_share: u64 = amount * reward_bps as u64 / 10_000;
        let merchant_share: u64 = amount - referrer_share;

        **ctx
            .accounts
            .payer
            .to_account_info()
            .try_borrow_mut_lamports()? -= amount;
        **ctx
            .accounts
            .referrer
            .to_account_info()
            .try_borrow_mut_lamports()? += referrer_share;
        **ctx
            .accounts
            .merchant
            .to_account_info()
            .try_borrow_mut_lamports()? += merchant_share;

        ctx.accounts.campaign.total_earned += amount;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    #[account(
        init,
        payer = merchant,
        space = 8 + 32 + 64 + 2 + 8,
        seeds = [b"campaign", merchant.key().as_ref()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    /// CHECK: merchant is the payer and initializer of the campaign. No validation needed.
    #[account(mut)]
    pub merchant: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_type: String)]
pub struct LogConversion<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 64 + 256 + 8 + 8,
        seeds = [b"record", campaign.key().as_ref(), customer.key().as_ref(), event_type.as_bytes()],
        bump
    )]
    pub referral_record: Account<'info, ReferralRecord>,

    #[account(mut)]
    pub campaign: Account<'info, Campaign>,

    /// CHECK: This account receives lamports. No additional checks needed.
    #[account(mut)]
    pub referrer: AccountInfo<'info>,

    /// CHECK: Customer identity is only logged; no lamports transferred.
    pub customer: AccountInfo<'info>,

    /// CHECK: This account receives lamports. No additional checks needed.
    #[account(mut)]
    pub merchant: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Campaign {
    pub merchant: Pubkey,
    pub campaign_id: String,
    pub referral_reward_bps: u16, // reward rate in basis points (1% = 100)
    pub total_earned: u64,
}

#[account]
pub struct ReferralRecord {
    pub referrer: Pubkey,
    pub customer: Pubkey,
    pub event_type: String,
    pub metadata: String,
    pub timestamp: i64,
    pub amount: u64,
}

#[error_code]
pub enum CustomError {
    #[msg("Referral reward must be 10000 (100%) or less.")]
    InvalidRewardPercentage,
}
