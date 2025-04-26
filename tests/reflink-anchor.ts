import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";
import { Reflink } from "../target/types/reflink";

describe("reflink", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Reflink as Program<Reflink>;

  let merchant = provider.wallet; // Merchant is the deployer's wallet for test
  let promoter = anchor.web3.Keypair.generate(); // A random promoter
  let consumer = anchor.web3.Keypair.generate(); // A random consumer (optional for now)

  let promotion = anchor.web3.Keypair.generate();
  let promotionLink = anchor.web3.Keypair.generate();

  it("Merchant creates a promotion", async () => {
    const tx = await program.methods
      .createPromotion(new anchor.BN(10)) // 10% commission
      .accounts({
        promotion: promotion.publicKey,
        merchant: merchant.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([promotion])
      .rpc();

    console.log("Promotion created:", tx);

    const promotionAccount = await program.account.promotion.fetch(
      promotion.publicKey
    );
    assert.ok(promotionAccount.merchant.equals(merchant.publicKey));
    assert.equal(promotionAccount.commissionRate, 10);
    assert.equal(promotionAccount.isOpen, true);
  });

  it("Promoter promotes the promotion", async () => {
    // Airdrop SOL to promoter for rent
    await provider.connection.requestAirdrop(
      promoter.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await sleep(1000);

    const tx = await program.methods
      .promote()
      .accounts({
        promotionLink: promotionLink.publicKey,
        promoter: promoter.publicKey,
        promotion: promotion.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([promotionLink, promoter])
      .rpc();

    console.log("Promotion link created:", tx);

    const linkAccount = await program.account.promotionLink.fetch(
      promotionLink.publicKey
    );
    assert.ok(linkAccount.promoter.equals(promoter.publicKey));
    assert.ok(linkAccount.promotion.equals(promotion.publicKey));
  });

  it("Consumer purchases through promotion link", async () => {
    const tx = await program.methods
      .purchase()
      .accounts({
        promotion: promotion.publicKey,
      })
      .rpc();

    console.log("Purchase completed:", tx);
  });

  it("Merchant closes the promotion", async () => {
    const tx = await program.methods
      .closePromotion()
      .accounts({
        promotion: promotion.publicKey,
        merchant: merchant.publicKey,
      })
      .rpc();

    console.log("Promotion closed:", tx);

    const promotionAccount = await program.account.promotion.fetch(
      promotion.publicKey
    );
    assert.equal(promotionAccount.isOpen, false);
  });

  it("Purchase should fail after closing the promotion", async () => {
    try {
      await program.methods
        .purchase()
        .accounts({
          promotion: promotion.publicKey,
        })
        .rpc();
      assert.fail("Purchase should have failed");
    } catch (err) {
      const errMsg = "The promotion is already closed.";
      assert.ok(err.error.errorMessage.includes(errMsg));
    }
  });
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
