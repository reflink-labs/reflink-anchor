use anchor_lang::prelude::*;

declare_id!("4PpiC9e179ufENLcgmK5NQJKHZ48NepLguqCJPsnBT9A");

#[program]
pub mod reflink {
    use super::*;

    /// Merchant creates a promotion
    pub fn create_promotion(ctx: Context<CreatePromotion>, commission_rate: u8) -> Result<()> {
        let promotion = &mut ctx.accounts.promotion;
        promotion.merchant = ctx.accounts.merchant.key();
        promotion.commission_rate = commission_rate;
        promotion.is_open = true;
        Ok(())
    }

    /// Promoter decides to promote
    pub fn promote(ctx: Context<Promote>) -> Result<()> {
        let promotion_link = &mut ctx.accounts.promotion_link;
        promotion_link.promoter = ctx.accounts.promoter.key();
        promotion_link.promotion = ctx.accounts.promotion.key();
        Ok(())
    }

    /// Consumer clicks and purchases
    pub fn purchase(ctx: Context<Purchase>) -> Result<()> {
        require!(
            ctx.accounts.promotion.is_open,
            ReflinkError::PromotionClosed
        );
        // Optional: Add logic to reward promoter or consumer if needed
        Ok(())
    }

    /// Merchant closes a promotion
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
}

//
// Accounts
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
// Instruction Contexts
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
    #[account(init, payer = promoter, space = PromotionLink::LEN)]
    pub promotion_link: Account<'info, PromotionLink>,
    #[account(mut)]
    pub promoter: Signer<'info>,
    pub promotion: Account<'info, Promotion>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Purchase<'info> {
    pub promotion: Account<'info, Promotion>,
}

#[derive(Accounts)]
pub struct ClosePromotion<'info> {
    #[account(mut)]
    pub promotion: Account<'info, Promotion>,
    #[account(mut)]
    pub merchant: Signer<'info>,
}

//
// Error Codes
//

#[error_code]
pub enum ReflinkError {
    #[msg("The promotion is already closed.")]
    PromotionClosed,
    #[msg("Unauthorized action.")]
    Unauthorized,
}

//
// Manual Space constants (space = 8 + fields_size)
//

impl Promotion {
    const LEN: usize = 8 + 32 + 1 + 1; // 8 for anchor, 32 pubkey, 1 u8 commission, 1 bool
}

impl PromotionLink {
    const LEN: usize = 8 + 32 + 32; // 8 for anchor, 32 promoter, 32 promotion
}
