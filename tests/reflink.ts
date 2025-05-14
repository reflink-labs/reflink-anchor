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

  // Wallets for merchant, affiliate, and customer
  const merchantWallet = anchor.web3.Keypair.generate();
  const affiliateWallet = anchor.web3.Keypair.generate();
  const customerWallet = anchor.web3.Keypair.generate();

  // SPL Token accounts and mint
  let tokenMint: anchor.web3.PublicKey;
  let merchantTokenAccount: anchor.web3.PublicKey;
  let affiliateTokenAccount: anchor.web3.PublicKey;
  let customerTokenAccount: anchor.web3.PublicKey;

  const TOKEN_DECIMALS = 6; // Similar to USDC
  const COMMISSION_RATE = 10; // 10%

  // Helper function to convert values based on decimals
  const tokenAmount = (amount: number) => {
    return amount * Math.pow(10, TOKEN_DECIMALS);
  };

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

  it("Sets up SPL token mint and accounts", async () => {
    // Create a new SPL token
    tokenMint = await createMint(
      connection,
      user.payer,
      user.publicKey,
      null,
      TOKEN_DECIMALS,
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
        merchantWallet.publicKey
      ),
      getOrCreateAssociatedTokenAccount(
        connection,
        user.payer,
        tokenMint,
        affiliateWallet.publicKey
      ),
      getOrCreateAssociatedTokenAccount(
        connection,
        user.payer,
        tokenMint,
        customerWallet.publicKey
      ),
    ]);

    merchantTokenAccount = accounts[0].address;
    affiliateTokenAccount = accounts[1].address;
    customerTokenAccount = accounts[2].address;

    // Mint some tokens to the customer for testing
    await mintTo(
      connection,
      user.payer,
      tokenMint,
      customerTokenAccount,
      user.publicKey,
      tokenAmount(1000), // 1000 tokens with 6 decimals
      []
    );

    // Verify the customer has tokens
    const tokenBalance = await connection.getTokenAccountBalance(
      customerTokenAccount
    );
    assert.equal(
      tokenBalance.value.uiAmount,
      1000,
      "Customer should have 1000 tokens"
    );
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
    assert.equal(merchantAccount.totalRevenue, 0);
    assert.equal(merchantAccount.totalReferrals, 0);
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
    assert.equal(affiliateAccount.totalCommission, 0);
    assert.equal(affiliateAccount.totalReferrals, 0);
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
    assert.equal(affiliateMerchantAccount.commissionEarned, 0);
    assert.equal(affiliateMerchantAccount.successfulReferrals, 0);
  });

  it("Process Purchase", async () => {
    const purchaseAmount = tokenAmount(100); // 100 tokens

    await program.methods
      .processPurchase(new anchor.BN(purchaseAmount))
      .accounts({
        customer: customerWallet.publicKey,
        merchant: merchantPDA,
        affiliate: affiliatePDA,
        affiliateMerchant: affiliateMerchantPDA,
        customerTokenAccount: customerTokenAccount,
        affiliateTokenAccount: affiliateTokenAccount,
        merchantTokenAccount: merchantTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
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
    const expectedCommission = purchaseAmount * (COMMISSION_RATE / 100);
    const expectedMerchantAmount = purchaseAmount - expectedCommission;

    // Verify merchant stats were updated
    assert.equal(merchantAccount.totalRevenue, purchaseAmount);
    assert.equal(merchantAccount.totalReferrals, 1);

    // Verify affiliate stats were updated
    assert.equal(affiliateAccount.totalCommission, expectedCommission);
    assert.equal(affiliateAccount.totalReferrals, 1);

    // Verify relationship stats were updated
    assert.equal(affiliateMerchantAccount.commissionEarned, expectedCommission);
    assert.equal(affiliateMerchantAccount.successfulReferrals, 1);

    // Verify token balances
    const merchantTokenBalance = await connection.getTokenAccountBalance(
      merchantTokenAccount
    );
    const affiliateTokenBalance = await connection.getTokenAccountBalance(
      affiliateTokenAccount
    );
    const customerTokenBalance = await connection.getTokenAccountBalance(
      customerTokenAccount
    );

    assert.approximately(
      merchantTokenBalance.value.uiAmount || 0,
      expectedMerchantAmount / Math.pow(10, TOKEN_DECIMALS),
      0.001,
      "Merchant should have received payment"
    );

    assert.approximately(
      affiliateTokenBalance.value.uiAmount || 0,
      expectedCommission / Math.pow(10, TOKEN_DECIMALS),
      0.001,
      "Affiliate should have received commission"
    );

    assert.approximately(
      customerTokenBalance.value.uiAmount || 0,
      (1000 * Math.pow(10, TOKEN_DECIMALS) - purchaseAmount) /
        Math.pow(10, TOKEN_DECIMALS),
      0.001,
      "Customer balance should be reduced by purchase amount"
    );
  });

  // Additional tests for other methods like updateMerchant, updateAffiliate, etc.
});
