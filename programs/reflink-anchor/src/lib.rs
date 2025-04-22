use anchor_lang::prelude::*;

declare_id!("4PpiC9e179ufENLcgmK5NQJKHZ48NepLguqCJPsnBT9A");

#[program]
pub mod reflink {
    use super::*;

    pub fn create_campaign(ctx: Context<CreateCampaign>, campaign_id: String) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        campaign.merchant = ctx.accounts.merchant.key();
        campaign.campaign_id = campaign_id;
        Ok(())
    }

    pub fn log_referral_event(
        ctx: Context<LogReferralEvent>,
        event_type: String,
        metadata: String,
    ) -> Result<()> {
        let record = &mut ctx.accounts.referral_record;
        record.referrer = ctx.accounts.referrer.key();
        record.customer = ctx.accounts.customer.key();
        record.event_type = event_type;
        record.metadata = metadata;
        record.timestamp = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    #[account(
        init,
        payer = merchant,
        space = 8 + 32 + 64,
        seeds = [b"campaign", merchant.key().as_ref()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,
    #[account(mut)]
    pub merchant: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(event_type: String)]
pub struct LogReferralEvent<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + 64 + 256 + 8,
        seeds = [b"record", campaign.key().as_ref(), customer.key().as_ref(), event_type.as_bytes()],
        bump
    )]
    pub referral_record: Account<'info, ReferralRecord>,

    pub campaign: Account<'info, Campaign>,
    /// CHECK: Stored as-is
    pub referrer: AccountInfo<'info>,
    /// CHECK: Stored as-is
    pub customer: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Campaign {
    pub merchant: Pubkey,
    pub campaign_id: String,
}

#[account]
pub struct ReferralRecord {
    pub referrer: Pubkey,
    pub customer: Pubkey,
    pub event_type: String,
    pub metadata: String,
    pub timestamp: i64,
}
