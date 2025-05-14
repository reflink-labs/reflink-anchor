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

  // Wallets for merchant, affiliate, and customer
  const merchantWallet = anchor.web3.Keypair.generate();
  const affiliateWallet = anchor.web3.Keypair.generate();
  const customerWallet = anchor.web3.Keypair.generate();

  const COMMISSION_RATE = 10; // 10%

  // PDAs
  let merchantPDA: anchor.web3.PublicKey;
  let affiliatePDA: anchor.web3.PublicKey;
  let affiliateMerchantPDA: anchor.web3.PublicKey;

  it("Airdrop SOL to test accounts", async () => {
    // Airdrop SOL to user wallet
    const sig = await connection.requestAirdrop(user.publicKey, 2_000_000_000);
    await connection.confirmTransaction(sig);

    // Airdrop to merchant, affiliate, and customer wallets
    for (const wallet of [merchantWallet, affiliateWallet, customerWallet]) {
      const walletSig = await connection.requestAirdrop(
        wallet.publicKey,
        1_000_000_000
      );
      await connection.confirmTransaction(walletSig);
    }
  });

  it("Register Merchant", async () => {
    // Derive Merchant PDA
    [merchantPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("merchant"), merchantWallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerMerchant(
        "Test Merchant",
        COMMISSION_RATE,
        "https://testsite.com"
      )
      .accounts({
        authority: merchantWallet.publicKey,
        merchant: merchantPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([merchantWallet])
      .rpc();

    // Verify merchant account data
    const merchantAccount = await program.account.merchant.fetch(merchantPDA);
    assert.ok(
      merchantAccount.authority.equals(merchantWallet.publicKey),
      "Merchant authority does not match"
    );
    assert.equal(merchantAccount.name, "Test Merchant");
    assert.equal(merchantAccount.commissionRate, COMMISSION_RATE);
    assert.equal(merchantAccount.websiteUrl, "https://testsite.com");
    assert.equal(merchantAccount.isActive, true, "Merchant should be active");
    assert.equal(merchantAccount.totalRevenue.toString(), "0");
    assert.equal(merchantAccount.totalReferrals.toString(), "0");
  });

  it("Register Affiliate", async () => {
    // Derive Affiliate PDA
    [affiliatePDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("affiliate"), affiliateWallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .registerAffiliate("Test Affiliate")
      .accounts({
        authority: affiliateWallet.publicKey,
        affiliate: affiliatePDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([affiliateWallet])
      .rpc();

    // Verify affiliate account data
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliatePDA
    );
    assert.ok(
      affiliateAccount.authority.equals(affiliateWallet.publicKey),
      "Affiliate authority does not match"
    );
    assert.equal(affiliateAccount.name, "Test Affiliate");
    assert.equal(affiliateAccount.totalCommission.toString(), "0");
    assert.equal(affiliateAccount.totalReferrals.toString(), "0");
  });

  it("Join Merchant", async () => {
    // Derive AffiliateMerchant PDA
    [affiliateMerchantPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("affiliate-merchant"),
        affiliatePDA.toBuffer(),
        merchantPDA.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .joinMerchant()
      .accounts({
        authority: affiliateWallet.publicKey,
        affiliate: affiliatePDA,
        merchant: merchantPDA,
        affiliateMerchant: affiliateMerchantPDA,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([affiliateWallet])
      .rpc();

    // Verify affiliate-merchant relationship account data
    const affiliateMerchantAccount =
      await program.account.affiliateMerchant.fetch(affiliateMerchantPDA);
    assert.ok(
      affiliateMerchantAccount.merchant.equals(merchantPDA),
      "Merchant PDA does not match"
    );
    assert.ok(
      affiliateMerchantAccount.affiliate.equals(affiliatePDA),
      "Affiliate PDA does not match"
    );
    assert.equal(affiliateMerchantAccount.commissionEarned.toString(), "0");
    assert.equal(affiliateMerchantAccount.successfulReferrals.toString(), "0");
  });

  it("Process Purchase", async () => {
    const purchaseAmount = new anchor.BN(1_000_000_000); // 1 SOL

    // Get initial balances
    const initialMerchantBalance = await connection.getBalance(
      merchantWallet.publicKey
    );
    const initialAffiliateBalance = await connection.getBalance(
      affiliateWallet.publicKey
    );
    const initialCustomerBalance = await connection.getBalance(
      customerWallet.publicKey
    );

    await program.methods
      .processPurchase(purchaseAmount)
      .accounts({
        customer: customerWallet.publicKey,
        merchant: merchantPDA,
        affiliate: affiliatePDA,
        affiliateMerchant: affiliateMerchantPDA,
        merchantAuthority: merchantWallet.publicKey,
        affiliateAuthority: affiliateWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([customerWallet])
      .rpc();

    // Verify updates to accounts
    const merchantAccount = await program.account.merchant.fetch(merchantPDA);
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliatePDA
    );
    const affiliateMerchantAccount =
      await program.account.affiliateMerchant.fetch(affiliateMerchantPDA);

    // Expected amounts
    const expectedCommission = purchaseAmount.muln(COMMISSION_RATE).divn(100);
    const expectedMerchantAmount = purchaseAmount.sub(expectedCommission);

    // Verify merchant stats were updated
    assert.equal(
      merchantAccount.totalRevenue.toString(),
      purchaseAmount.toString()
    );
    assert.equal(merchantAccount.totalReferrals.toString(), "1");

    // Verify affiliate stats were updated
    assert.equal(
      affiliateAccount.totalCommission.toString(),
      expectedCommission.toString()
    );
    assert.equal(affiliateAccount.totalReferrals.toString(), "1");

    // Verify relationship stats were updated
    assert.equal(
      affiliateMerchantAccount.commissionEarned.toString(),
      expectedCommission.toString()
    );
    assert.equal(affiliateMerchantAccount.successfulReferrals.toString(), "1");

    // Verify SOL balances
    const finalMerchantBalance = await connection.getBalance(
      merchantWallet.publicKey
    );
    const finalAffiliateBalance = await connection.getBalance(
      affiliateWallet.publicKey
    );
    const finalCustomerBalance = await connection.getBalance(
      customerWallet.publicKey
    );

    // Check merchant received payment
    assert.approximately(
      finalMerchantBalance - initialMerchantBalance,
      expectedMerchantAmount.toNumber(),
      1000000, // Allow for transaction fees
      "Merchant should have received payment"
    );

    // Check affiliate received commission
    assert.approximately(
      finalAffiliateBalance - initialAffiliateBalance,
      expectedCommission.toNumber(),
      1000000, // Allow for transaction fees
      "Affiliate should have received commission"
    );

    // Check customer balance was reduced
    assert.approximately(
      initialCustomerBalance - finalCustomerBalance,
      purchaseAmount.toNumber(),
      1000000, // Allow for transaction fees
      "Customer balance should be reduced by purchase amount"
    );
  });

  it("Process Multiple Purchases", async () => {
    // Airdrop more SOL to customer for multiple purchases
    const customerAirdropSig = await connection.requestAirdrop(
      customerWallet.publicKey,
      2_000_000_000 // 2 SOL
    );
    await connection.confirmTransaction(customerAirdropSig);

    const firstPurchaseAmount = new anchor.BN(200_000_000); // 0.2 SOL
    const secondPurchaseAmount = new anchor.BN(200_000_000); // Same amount to test the issue

    // Get initial balances
    const initialMerchantBalance = await connection.getBalance(
      merchantWallet.publicKey
    );
    const initialAffiliateBalance = await connection.getBalance(
      affiliateWallet.publicKey
    );
    const initialCustomerBalance = await connection.getBalance(
      customerWallet.publicKey
    );

    console.log("Initial balances:");
    console.log("- Customer:", initialCustomerBalance);
    console.log("- Merchant:", initialMerchantBalance);
    console.log("- Affiliate:", initialAffiliateBalance);

    // First purchase
    console.log(
      "\nAttempting first purchase of",
      firstPurchaseAmount.toString(),
      "lamports"
    );
    try {
      const tx1 = await program.methods
        .processPurchase(firstPurchaseAmount)
        .accounts({
          customer: customerWallet.publicKey,
          merchant: merchantPDA,
          affiliate: affiliatePDA,
          affiliateMerchant: affiliateMerchantPDA,
          merchantAuthority: merchantWallet.publicKey,
          affiliateAuthority: affiliateWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([customerWallet])
        .rpc();

      console.log("First purchase successful:", tx1);
    } catch (e) {
      console.error("First purchase failed:", e);
      throw e;
    }

    // Add a delay between purchases
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const midBalances = {
      customer: await connection.getBalance(customerWallet.publicKey),
      merchant: await connection.getBalance(merchantWallet.publicKey),
      affiliate: await connection.getBalance(affiliateWallet.publicKey),
    };

    console.log("\nBalances after first purchase:");
    console.log("- Customer:", midBalances.customer);
    console.log("- Merchant:", midBalances.merchant);
    console.log("- Affiliate:", midBalances.affiliate);

    // Second purchase with same amount
    console.log(
      "\nAttempting second purchase of",
      secondPurchaseAmount.toString(),
      "lamports"
    );
    try {
      const tx2 = await program.methods
        .processPurchase(secondPurchaseAmount)
        .accounts({
          customer: customerWallet.publicKey,
          merchant: merchantPDA,
          affiliate: affiliatePDA,
          affiliateMerchant: affiliateMerchantPDA,
          merchantAuthority: merchantWallet.publicKey,
          affiliateAuthority: affiliateWallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([customerWallet])
        .rpc();

      console.log("Second purchase successful:", tx2);
    } catch (e) {
      console.error("Second purchase failed:", e);
      throw e;
    }

    const finalBalances = {
      customer: await connection.getBalance(customerWallet.publicKey),
      merchant: await connection.getBalance(merchantWallet.publicKey),
      affiliate: await connection.getBalance(affiliateWallet.publicKey),
    };

    console.log("\nFinal balances:");
    console.log("- Customer:", finalBalances.customer);
    console.log("- Merchant:", finalBalances.merchant);
    console.log("- Affiliate:", finalBalances.affiliate);

    // Get final account states
    const merchantAccount = await program.account.merchant.fetch(merchantPDA);
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliatePDA
    );
    const affiliateMerchantAccount =
      await program.account.affiliateMerchant.fetch(affiliateMerchantPDA);

    console.log("\nFinal stats:");
    console.log("Merchant revenue:", merchantAccount.totalRevenue.toString());
    console.log(
      "Merchant referrals:",
      merchantAccount.totalReferrals.toString()
    );
    console.log(
      "Affiliate commission:",
      affiliateAccount.totalCommission.toString()
    );
    console.log(
      "Affiliate referrals:",
      affiliateAccount.totalReferrals.toString()
    );
    console.log(
      "Relationship commission:",
      affiliateMerchantAccount.commissionEarned.toString()
    );
    console.log(
      "Relationship referrals:",
      affiliateMerchantAccount.successfulReferrals.toString()
    );
  });
});
