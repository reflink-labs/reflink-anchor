import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Reflink } from "../target/types/reflink";
import { assert } from "chai";

describe("reflink", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Reflink as Program<Reflink>;

  const merchant = anchor.web3.Keypair.generate();
  const promoter = anchor.web3.Keypair.generate();
  const buyer = anchor.web3.Keypair.generate();
  const platform = anchor.web3.Keypair.generate();

  const promotionKeypair = anchor.web3.Keypair.generate();
  let promotion = promotionKeypair.publicKey;
  let promotionLink: anchor.web3.PublicKey;
  let promotionLinkBump: number;

  it("Airdrop SOL to merchant, promoter, buyer, and platform", async () => {
    const connection = provider.connection;
    for (const user of [
      merchant.publicKey,
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
      })
      .signers([merchant, promotionKeypair])
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
    const connection = provider.connection;
    const totalAmount = new anchor.BN(1_000_000_000); // 1 SOL

    // Helper to fetch balance
    const getBalance = async (pubkey: anchor.web3.PublicKey) => {
      return await connection.getBalance(pubkey);
    };

    const balancesBefore = {
      buyer: await getBalance(buyer.publicKey),
      promoter: await getBalance(promoter.publicKey),
      merchant: await getBalance(merchant.publicKey),
      platform: await getBalance(platform.publicKey),
    };

    console.log("----- Balances Before Purchase -----");
    console.log(
      "Buyer:",
      balancesBefore.buyer / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Promoter:",
      balancesBefore.promoter / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Merchant:",
      balancesBefore.merchant / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Platform:",
      balancesBefore.platform / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );

    const tx = await program.methods
      .purchase(totalAmount)
      .accounts({
        promotion,
        buyer: buyer.publicKey,
        promoter: promoter.publicKey,
        merchant: merchant.publicKey,
        platform: platform.publicKey,
      })
      .signers([buyer])
      .rpc();

    console.log("✅ Purchase tx:", tx);

    const balancesAfter = {
      buyer: await getBalance(buyer.publicKey),
      promoter: await getBalance(promoter.publicKey),
      merchant: await getBalance(merchant.publicKey),
      platform: await getBalance(platform.publicKey),
    };

    console.log("----- Balances After Purchase -----");
    console.log(
      "Buyer:",
      balancesAfter.buyer / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Promoter:",
      balancesAfter.promoter / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Merchant:",
      balancesAfter.merchant / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Platform:",
      balancesAfter.platform / anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );

    console.log("----- Balance Changes (Δ) -----");
    console.log(
      "Buyer Δ:",
      (balancesAfter.buyer - balancesBefore.buyer) /
        anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Promoter Δ:",
      (balancesAfter.promoter - balancesBefore.promoter) /
        anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Merchant Δ:",
      (balancesAfter.merchant - balancesBefore.merchant) /
        anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log(
      "Platform Δ:",
      (balancesAfter.platform - balancesBefore.platform) /
        anchor.web3.LAMPORTS_PER_SOL,
      "SOL"
    );
  });

  it("Merchant closes the promotion", async () => {
    const tx = await program.methods
      .closePromotion()
      .accounts({
        promotion,
        merchant: merchant.publicKey,
      })
      .signers([merchant])
      .rpc();

    console.log("✅ Close promotion tx:", tx);

    const promotionAccount = await program.account.promotion.fetch(promotion);
    assert.ok(!promotionAccount.isOpen);
  });
});
