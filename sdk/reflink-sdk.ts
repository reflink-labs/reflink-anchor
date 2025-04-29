import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { Reflink } from "../target/types/reflink";

export class ReflinkSDK {
  program: anchor.Program<Reflink>;
  provider: anchor.AnchorProvider;

  constructor(provider: anchor.AnchorProvider, programId: PublicKey) {
    this.provider = provider;
    const idl = require("../target/idl/reflink.json"); // Make sure your idl is built
    this.program = new anchor.Program(
      idl,
      programId,
      provider
    ) as anchor.Program<Reflink>;
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
        systemProgram: SystemProgram.programId,
      })
      .signers([merchant, promotion])
      .rpc();

    return promotion.publicKey;
  }

  async promote(promoter: Keypair, promotion: PublicKey): Promise<PublicKey> {
    const [promotionLink, _bump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("promotion_link"),
        promoter.publicKey.toBuffer(),
        promotion.toBuffer(),
      ],
      this.program.programId
    );

    await this.program.methods
      .promote()
      .accounts({
        promotionLink,
        promoter: promoter.publicKey,
        promotion,
        systemProgram: SystemProgram.programId,
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
        systemProgram: SystemProgram.programId,
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
}
