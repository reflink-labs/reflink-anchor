import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Reflink } from "../target/types/reflink";
import { assert } from "chai";

describe("reflink", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Reflink as Program<Reflink>;
  const connection = provider.connection;
  const user = provider.wallet;

  // Keypairs for testing
  const merchant = anchor.web3.Keypair.generate();
  const affiliate = anchor.web3.Keypair.generate();
  const referral = anchor.web3.Keypair.generate();

  // Wallets to receive payments
  const merchantWallet = anchor.web3.Keypair.generate();
  const affiliateWallet = anchor.web3.Keypair.generate();

  const COMMISSION_BPS = 500; // 5%

  it("Airdrop SOL to test accounts", async () => {
    // Airdrop to user wallet (who will be paying for transactions and making the payment)
    const sig = await connection.requestAirdrop(user.publicKey, 2_000_000_000);
    await connection.confirmTransaction(sig);

    // Airdrop to the merchant and affiliate wallets (small amount just to create them)
    for (const wallet of [merchantWallet, affiliateWallet]) {
      const walletSig = await connection.requestAirdrop(
        wallet.publicKey,
        10_000_000
      );
      await connection.confirmTransaction(walletSig);
    }
  });

  it("Registers a merchant", async () => {
    await program.methods
      .registerMerchant(COMMISSION_BPS)
      .accounts({
        merchant: merchant.publicKey,
        authority: merchantWallet.publicKey,
      })
      .signers([merchant, merchantWallet])
      .rpc();

    // Verify merchant account data
    const merchantAccount = await program.account.merchant.fetch(
      merchant.publicKey
    );
    assert.ok(
      merchantAccount.authority.equals(merchantWallet.publicKey),
      "Merchant authority does not match"
    );
    assert.equal(
      merchantAccount.commissionBps,
      COMMISSION_BPS,
      "Commission rate not set correctly"
    );
  });

  it("Registers an affiliate", async () => {
    await program.methods
      .registerAffiliate()
      .accounts({
        affiliate: affiliate.publicKey,
        authority: affiliateWallet.publicKey,
      })
      .signers([affiliate, affiliateWallet])
      .rpc();

    // Verify affiliate account data
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliate.publicKey
    );
    assert.ok(
      affiliateAccount.authority.equals(affiliateWallet.publicKey),
      "Affiliate authority does not match"
    );
    assert.ok(
      affiliateAccount.totalEarned.eq(new anchor.BN(0)),
      "Initial earned amount should be zero"
    );
  });

  const testReferralAmount = new anchor.BN(100_000_000); // 0.1 SOL
  const expectedCommission = new anchor.BN(
    (testReferralAmount.toNumber() * COMMISSION_BPS) / 10_000
  );
  const expectedMerchantAmount = testReferralAmount.sub(expectedCommission);

  it("Registers a referral and distributes payment correctly", async () => {
    // Get initial balances
    const initialMerchantBalance = await connection.getBalance(
      merchantWallet.publicKey
    );
    const initialAffiliateBalance = await connection.getBalance(
      affiliateWallet.publicKey
    );

    await program.methods
      .registerReferral(testReferralAmount)
      .accounts({
        affiliate: affiliate.publicKey,
        referral: referral.publicKey,
        merchant: merchant.publicKey,
        merchantWallet: merchantWallet.publicKey,
        affiliateWallet: affiliateWallet.publicKey,
        payer: user.publicKey,
      })
      .signers([referral])
      .rpc();

    // Verify referral data
    const referralAccount = await program.account.referral.fetch(
      referral.publicKey
    );
    assert.ok(
      referralAccount.affiliate.equals(affiliate.publicKey),
      "Referral affiliate doesn't match"
    );
    assert.ok(
      referralAccount.amount.eq(testReferralAmount),
      "Referral amount doesn't match"
    );
    assert.ok(
      referralAccount.commission.eq(expectedCommission),
      "Commission doesn't match expected amount"
    );

    // Verify affiliate tracking data was updated
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliate.publicKey
    );
    assert.ok(
      affiliateAccount.totalEarned.eq(expectedCommission),
      "Affiliate's total earned not updated correctly"
    );

    // Verify actual payment transfers
    const finalMerchantBalance = await connection.getBalance(
      merchantWallet.publicKey
    );
    const finalAffiliateBalance = await connection.getBalance(
      affiliateWallet.publicKey
    );

    // Account for some floating point/BN precision issues with approximately equal
    assert.approximately(
      finalMerchantBalance - initialMerchantBalance,
      expectedMerchantAmount.toNumber(),
      10, // Allow small difference due to conversion
      "Merchant didn't receive the correct amount"
    );

    assert.approximately(
      finalAffiliateBalance - initialAffiliateBalance,
      expectedCommission.toNumber(),
      10, // Allow small difference due to conversion
      "Affiliate didn't receive the correct commission"
    );
  });
});
