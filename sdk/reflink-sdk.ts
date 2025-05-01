import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { Reflink } from "../target/types/reflink";

export class ReflinkSDK {
  readonly program: anchor.Program<Reflink>;
  readonly provider: anchor.AnchorProvider;

  constructor(provider: anchor.AnchorProvider) {
    this.provider = provider;
    const idl = require("../target/idl/reflink.json"); // <-- Make sure you have the idl
    this.program = new anchor.Program<Reflink>(idl, provider);
  }

  async airdrop(publicKey: PublicKey, solAmount = 2): Promise<void> {
    const sig = await this.provider.connection.requestAirdrop(
      publicKey,
      solAmount * LAMPORTS_PER_SOL
    );
    await this.provider.connection.confirmTransaction(sig);
  }

  async createPromotion(
    merchant: Keypair,
    commissionRate: number
  ): Promise<PublicKey> {
    const promotion = anchor.web3.Keypair.generate();

    await this.program.methods
      .createPromotion(commissionRate)
      .accounts({
        promotion: promotion.publicKey,
        merchant: merchant.publicKey,
      })
      .signers([merchant, promotion])
      .rpc();

    return promotion.publicKey;
  }

  async promote(promoter: Keypair, promotion: PublicKey): Promise<PublicKey> {
    const [promotionLink, _bump] = await this.findPromotionLinkPDA(
      promoter.publicKey,
      promotion
    );

    await this.program.methods
      .promote()
      .accounts({
        promotionLink: promotionLink as any,
        promoter: promoter.publicKey,
        promotion,
      })
      .signers([promoter])
      .rpc();

    return promotionLink;
  }

  async purchase(
    buyer: Keypair,
    promotion: PublicKey,
    promoter: PublicKey,
    merchant: PublicKey,
    platform: PublicKey,
    totalAmount: anchor.BN
  ): Promise<void> {
    await this.program.methods
      .purchase(totalAmount)
      .accounts({
        promotion,
        buyer: buyer.publicKey,
        promoter,
        merchant,
        platform,
      })
      .signers([buyer])
      .rpc();
  }

  async closePromotion(merchant: Keypair, promotion: PublicKey): Promise<void> {
    await this.program.methods
      .closePromotion()
      .accounts({
        promotion,
        merchant: merchant.publicKey,
      })
      .signers([merchant])
      .rpc();
  }

  //
  // 🔥 PDA Helpers
  //
  async findPromotionLinkPDA(
    promoter: PublicKey,
    promotion: PublicKey
  ): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddress(
      [
        Buffer.from("promotion_link"),
        promoter.toBuffer(),
        promotion.toBuffer(),
      ],
      this.program.programId
    );
  }

  //
  // 🔥 Account Fetchers
  //
  async fetchPromotion(promotion: PublicKey) {
    return await this.program.account.promotion.fetch(promotion);
  }

  async fetchPromotionLink(promotionLink: PublicKey) {
    return await this.program.account.promotionLink.fetch(promotionLink);
  }

  async getBalance(publicKey: PublicKey): Promise<number> {
    const lamports = await this.provider.connection.getBalance(publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }
}
