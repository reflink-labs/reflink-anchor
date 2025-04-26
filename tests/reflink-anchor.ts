import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Reflink } from "../target/types/reflink";
import { assert } from "chai";

describe("reflink", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Reflink as Program<Reflink>;

  const merchant = provider.wallet;
  const promoter = anchor.web3.Keypair.generate();
  const buyer = anchor.web3.Keypair.generate();
  const platform = anchor.web3.Keypair.generate();

  const promotionKeypair = anchor.web3.Keypair.generate();
  let promotion = promotionKeypair.publicKey;
  let promotionLink: anchor.web3.PublicKey;
  let promotionLinkBump: number;

  it("Airdrop SOL to promoter, buyer, and platform", async () => {
    const connection = provider.connection;
    for (const user of [
      promoter.publicKey,
      buyer.publicKey,
      platform.publicKey,
    ]) {
      const tx = await connection.requestAirdrop(
        user,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(tx);
    }
  });

  it("Merchant creates a promotion", async () => {
    const tx = await program.methods
      .createPromotion(10) // 10% commission
      .accounts({
        promotion: promotion,
        merchant: merchant.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([promotionKeypair])
      .rpc();

    console.log("✅ Create promotion tx:", tx);

    const promotionAccount = await program.account.promotion.fetch(promotion);
    assert.ok(promotionAccount.isOpen);
    assert.ok(promotionAccount.merchant.equals(merchant.publicKey));
  });

  it("Promoter promotes a promotion", async () => {
    const [promoLinkPubkey, bump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("promotion_link"),
          promoter.publicKey.toBuffer(),
          promotion.toBuffer(),
        ],
        program.programId
      );
    promotionLink = promoLinkPubkey;
    promotionLinkBump = bump;

    const tx = await program.methods
      .promote()
      .accounts({
        promotionLink,
        promoter: promoter.publicKey,
        promotion,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([promoter])
      .rpc();

    console.log("✅ Promote tx:", tx);

    const promotionLinkAccount = await program.account.promotionLink.fetch(
      promotionLink
    );
    assert.ok(promotionLinkAccount.promoter.equals(promoter.publicKey));
  });

  it("Buyer makes a purchase (SOL transfer)", async () => {
    const totalAmount = new anchor.BN(1_000_000); // 0.001 SOL

    const tx = await program.methods
      .purchase(totalAmount)
      .accounts({
        promotion,
        buyer: buyer.publicKey,
        promoter: promoter.publicKey,
        merchant: merchant.publicKey,
        platform: platform.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

    console.log("✅ Purchase tx:", tx);
  });

  it("Merchant closes the promotion", async () => {
    const tx = await program.methods
      .closePromotion()
      .accounts({
        promotion,
        merchant: merchant.publicKey,
      })
      .rpc();

    console.log("✅ Close promotion tx:", tx);

    const promotionAccount = await program.account.promotion.fetch(promotion);
    assert.ok(!promotionAccount.isOpen);
  });
});
