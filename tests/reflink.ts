import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Reflink } from "../target/types/reflink";
import { assert } from "chai";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

describe("reflink", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Reflink as Program<Reflink>;
  const connection = provider.connection;
  const user = provider.wallet;

  // Wallets for merchant and affiliate
  const merchantWallet = anchor.web3.Keypair.generate();
  const affiliateWallet = anchor.web3.Keypair.generate();

  // PDA accounts - we'll derive these in the tests
  let merchantPDA: anchor.web3.PublicKey;
  let merchantBump: number;
  let affiliatePDA: anchor.web3.PublicKey;
  let affiliateBump: number;
  let referralSolPDA: anchor.web3.PublicKey;
  let referralSolBump: number;
  let referralTokenPDA: anchor.web3.PublicKey;
  let referralTokenBump: number;

  // SPL Token accounts and mint
  let tokenMint: anchor.web3.PublicKey;
  let payerTokenAccount: anchor.web3.PublicKey;
  let merchantTokenAccount: anchor.web3.PublicKey;
  let affiliateTokenAccount: anchor.web3.PublicKey;

  const COMMISSION_BPS = 500; // 5%
  const TOKEN_DECIMALS = 6; // Similar to USDC

  // Helper function to convert values based on decimals
  const tokenAmount = (amount: number) => {
    return new anchor.BN(amount * Math.pow(10, TOKEN_DECIMALS));
  };

  it("Airdrop SOL to test accounts", async () => {
    // Airdrop to user wallet (who will be paying for transactions and making the payment)
    const sig = await connection.requestAirdrop(user.publicKey, 2_000_000_000);
    await connection.confirmTransaction(sig);

    // Airdrop to the merchant and affiliate wallets (small amount just to create them)
    for (const wallet of [merchantWallet, affiliateWallet]) {
      const walletSig = await connection.requestAirdrop(
        wallet.publicKey,
        1_000_000_000
      );
      await connection.confirmTransaction(walletSig);
    }
  });

  it("Sets up SPL token mint and accounts", async () => {
    // Create a new SPL token
    tokenMint = await createMint(
      connection,
      user.payer, // The payer of the transaction fees
      user.publicKey, // The mint authority
      null, // The freeze authority (null = no freeze authority)
      TOKEN_DECIMALS, // The number of decimals for the token
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    // Create token accounts for all participants
    const accounts = await Promise.all([
      getOrCreateAssociatedTokenAccount(
        connection,
        user.payer,
        tokenMint,
        user.publicKey
      ),
      getOrCreateAssociatedTokenAccount(
        connection,
        user.payer,
        tokenMint,
        merchantWallet.publicKey
      ),
      getOrCreateAssociatedTokenAccount(
        connection,
        user.payer,
        tokenMint,
        affiliateWallet.publicKey
      ),
    ]);

    payerTokenAccount = accounts[0].address;
    merchantTokenAccount = accounts[1].address;
    affiliateTokenAccount = accounts[2].address;

    // Mint some tokens to the payer for testing
    await mintTo(
      connection,
      user.payer,
      tokenMint,
      payerTokenAccount,
      user.publicKey,
      1_000_000_000, // 1000 tokens with 6 decimals
      []
    );

    // Verify the payer has tokens
    const tokenBalance = await connection.getTokenAccountBalance(
      payerTokenAccount
    );
    assert.equal(
      tokenBalance.value.uiAmount,
      1000,
      "Payer should have 1000 tokens"
    );
  });

  it("Finds PDA addresses", async () => {
    // Find merchant PDA
    [merchantPDA, merchantBump] =
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("merchant"), merchantWallet.publicKey.toBuffer()],
        program.programId
      );

    // Find affiliate PDA
    [affiliatePDA, affiliateBump] =
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("affiliate"), affiliateWallet.publicKey.toBuffer()],
        program.programId
      );

    console.log("Merchant PDA:", merchantPDA.toString());
    console.log("Affiliate PDA:", affiliatePDA.toString());
  });

  it("Registers a merchant", async () => {
    await program.methods
      .registerMerchant(COMMISSION_BPS)
      .accounts({
        merchant: merchantPDA,
        authority: merchantWallet.publicKey,
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
    assert.equal(
      merchantAccount.commissionBps,
      COMMISSION_BPS,
      "Commission rate not set correctly"
    );
    assert.equal(
      merchantAccount.active,
      true,
      "Merchant should be active by default"
    );
  });

  it("Registers an affiliate", async () => {
    await program.methods
      .registerAffiliate()
      .accounts({
        affiliate: affiliatePDA,
        authority: affiliateWallet.publicKey,
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
    assert.ok(
      affiliateAccount.totalEarned.eq(new anchor.BN(0)),
      "Initial earned amount should be zero"
    );
    assert.ok(
      affiliateAccount.totalReferrals.eq(new anchor.BN(0)),
      "Initial referral count should be zero"
    );
  });

  it("Calculates referral SOL PDA", async () => {
    // Get the affiliate account to get the current total referrals
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliatePDA
    );
    const referralCount = affiliateAccount.totalReferrals;

    // Find the referral PDA
    [referralSolPDA, referralSolBump] =
      await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("referral"),
          affiliatePDA.toBuffer(),
          merchantPDA.toBuffer(),
          referralCount.toArrayLike(Buffer, "le", 8), // Convert BN to little-endian 8-byte array
        ],
        program.programId
      );

    console.log("Referral SOL PDA:", referralSolPDA.toString());
  });

  const testReferralAmount = new anchor.BN(100_000_000); // 0.1 SOL
  const expectedCommission = new anchor.BN(
    (testReferralAmount.toNumber() * COMMISSION_BPS) / 10_000
  );
  const expectedMerchantAmount = testReferralAmount.sub(expectedCommission);

  it("Registers a SOL referral and distributes payment correctly", async () => {
    // Get initial balances
    const initialMerchantBalance = await connection.getBalance(
      merchantWallet.publicKey
    );
    const initialAffiliateBalance = await connection.getBalance(
      affiliateWallet.publicKey
    );

    await program.methods
      .registerReferralSol(testReferralAmount)
      .accounts({
        affiliate: affiliatePDA,
        referral: referralSolPDA,
        merchant: merchantPDA,
        merchantWallet: merchantWallet.publicKey,
        affiliateWallet: affiliateWallet.publicKey,
        payer: user.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Verify referral data
    const referralAccount = await program.account.referral.fetch(
      referralSolPDA
    );
    assert.ok(
      referralAccount.affiliate.equals(affiliatePDA),
      "Referral affiliate doesn't match"
    );
    assert.ok(
      referralAccount.merchant.equals(merchantPDA),
      "Referral merchant doesn't match"
    );
    assert.ok(
      referralAccount.amount.eq(testReferralAmount),
      "Referral amount doesn't match"
    );
    assert.ok(
      referralAccount.commission.eq(expectedCommission),
      "Commission doesn't match expected amount"
    );
    assert.equal(
      referralAccount.isToken,
      false,
      "Should be marked as a non-token payment"
    );
    assert.ok(
      referralAccount.tokenMint.equals(anchor.web3.PublicKey.default),
      "Token mint should be default public key for SOL payments"
    );

    // Verify affiliate tracking data was updated
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliatePDA
    );
    assert.ok(
      affiliateAccount.totalEarned.eq(expectedCommission),
      "Affiliate's total earned not updated correctly"
    );
    assert.ok(
      affiliateAccount.totalReferrals.eq(new anchor.BN(1)),
      "Affiliate's referral count should be 1"
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

  it("Calculates referral token PDA", async () => {
    // Get the affiliate account to get the current total referrals
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliatePDA
    );
    const referralCount = affiliateAccount.totalReferrals;

    // Find the referral PDA
    [referralTokenPDA, referralTokenBump] =
      await anchor.web3.PublicKey.findProgramAddress(
        [
          Buffer.from("referral"),
          affiliatePDA.toBuffer(),
          merchantPDA.toBuffer(),
          referralCount.toArrayLike(Buffer, "le", 8), // Convert BN to little-endian 8-byte array
        ],
        program.programId
      );

    console.log("Referral Token PDA:", referralTokenPDA.toString());
  });

  it("Registers a token referral and distributes payment correctly", async () => {
    // Test amount for token referrals - let's use 100 tokens
    const testTokenAmount = tokenAmount(100);
    const expectedTokenCommission = testTokenAmount
      .muln(COMMISSION_BPS)
      .divn(10_000);
    const expectedMerchantTokenAmount = testTokenAmount.sub(
      expectedTokenCommission
    );

    // Get initial token balances
    const initialMerchantTokenBalance = (
      await connection.getTokenAccountBalance(merchantTokenAccount)
    ).value.amount;
    const initialAffiliateTokenBalance = (
      await connection.getTokenAccountBalance(affiliateTokenAccount)
    ).value.amount;

    await program.methods
      .registerReferralToken(testTokenAmount)
      .accounts({
        affiliate: affiliatePDA,
        referral: referralTokenPDA,
        merchant: merchantPDA,
        tokenMint: tokenMint,
        merchantTokenAccount: merchantTokenAccount,
        affiliateTokenAccount: affiliateTokenAccount,
        payerTokenAccount: payerTokenAccount,
        payer: user.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Verify referral data
    const referralAccount = await program.account.referral.fetch(
      referralTokenPDA
    );
    assert.ok(
      referralAccount.affiliate.equals(affiliatePDA),
      "Referral affiliate doesn't match"
    );
    assert.ok(
      referralAccount.merchant.equals(merchantPDA),
      "Referral merchant doesn't match"
    );
    assert.ok(
      referralAccount.amount.eq(testTokenAmount),
      "Referral amount doesn't match"
    );
    assert.ok(
      referralAccount.commission.eq(expectedTokenCommission),
      "Commission doesn't match expected amount"
    );
    assert.equal(
      referralAccount.isToken,
      true,
      "Should be marked as a token payment"
    );
    assert.ok(
      referralAccount.tokenMint.equals(tokenMint),
      "Token mint should match the test mint"
    );

    // Verify affiliate tracking data was updated
    const affiliateAccount = await program.account.affiliate.fetch(
      affiliatePDA
    );
    assert.ok(
      affiliateAccount.totalReferrals.eq(new anchor.BN(2)),
      "Affiliate's referral count should be 2"
    );

    // Check the token balances were updated correctly
    const finalMerchantTokenBalance = (
      await connection.getTokenAccountBalance(merchantTokenAccount)
    ).value.amount;
    const finalAffiliateTokenBalance = (
      await connection.getTokenAccountBalance(affiliateTokenAccount)
    ).value.amount;

    const merchantTokenDifference = new anchor.BN(
      finalMerchantTokenBalance
    ).sub(new anchor.BN(initialMerchantTokenBalance));
    const affiliateTokenDifference = new anchor.BN(
      finalAffiliateTokenBalance
    ).sub(new anchor.BN(initialAffiliateTokenBalance));

    assert.ok(
      merchantTokenDifference.eq(expectedMerchantTokenAmount),
      "Merchant didn't receive the correct token amount"
    );

    assert.ok(
      affiliateTokenDifference.eq(expectedTokenCommission),
      "Affiliate didn't receive the correct token commission"
    );
  });

  it("Updates merchant commission rate", async () => {
    const newCommissionBps = 1000; // 10%

    await program.methods
      .updateMerchantCommission(newCommissionBps)
      .accounts({
        merchant: merchantPDA,
        authority: merchantWallet.publicKey,
      })
      .signers([merchantWallet])
      .rpc();

    // Verify the commission rate was updated
    const merchantAccount = await program.account.merchant.fetch(merchantPDA);
    assert.equal(
      merchantAccount.commissionBps,
      newCommissionBps,
      "Commission rate not updated correctly"
    );
  });

  it("Toggles merchant active status", async () => {
    await program.methods
      .toggleMerchantStatus()
      .accounts({
        merchant: merchantPDA,
        authority: merchantWallet.publicKey,
      })
      .signers([merchantWallet])
      .rpc();

    // Verify the active status was toggled
    let merchantAccount = await program.account.merchant.fetch(merchantPDA);
    assert.equal(
      merchantAccount.active,
      false,
      "Merchant active status should be toggled to false"
    );

    // Toggle it back to active
    await program.methods
      .toggleMerchantStatus()
      .accounts({
        merchant: merchantPDA,
        authority: merchantWallet.publicKey,
      })
      .signers([merchantWallet])
      .rpc();

    // Verify the active status was toggled back
    merchantAccount = await program.account.merchant.fetch(merchantPDA);
    assert.equal(
      merchantAccount.active,
      true,
      "Merchant active status should be toggled back to true"
    );
  });
});
