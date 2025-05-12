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

  // Wallets for platform, merchant, and referrer
  const platformWallet = anchor.web3.Keypair.generate();
  const merchantWallet = anchor.web3.Keypair.generate();
  const referrerWallet = anchor.web3.Keypair.generate();

  // SPL Token accounts and mint
  let tokenMint: anchor.web3.PublicKey;
  let platformTokenAccount: anchor.web3.PublicKey;
  let merchantTokenAccount: anchor.web3.PublicKey;
  let referrerTokenAccount: anchor.web3.PublicKey;
  let buyerTokenAccount: anchor.web3.PublicKey;

  const PLATFORM_FEE_BPS = 200; // 2%
  const REFERRER_FEE_BPS = 500; // 5%
  const TOKEN_DECIMALS = 6; // Similar to USDC

  // Helper function to convert values based on decimals
  const tokenAmount = (amount: number) => {
    return new anchor.BN(amount * Math.pow(10, TOKEN_DECIMALS));
  };

  it("Airdrop SOL to test accounts", async () => {
    // Airdrop SOL to user wallet
    const sig = await connection.requestAirdrop(user.publicKey, 2_000_000_000);
    await connection.confirmTransaction(sig);

    // Airdrop to platform, merchant, and referrer wallets
    for (const wallet of [platformWallet, merchantWallet, referrerWallet]) {
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
        platformWallet.publicKey
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
        referrerWallet.publicKey
      ),
      getOrCreateAssociatedTokenAccount(
        connection,
        user.payer,
        tokenMint,
        user.publicKey
      ),
    ]);

    platformTokenAccount = accounts[0].address;
    merchantTokenAccount = accounts[1].address;
    referrerTokenAccount = accounts[2].address;
    buyerTokenAccount = accounts[3].address;

    // Mint some tokens to the buyer for testing
    await mintTo(
      connection,
      user.payer,
      tokenMint,
      buyerTokenAccount,
      user.publicKey,
      1_000_000_000, // 1000 tokens with 6 decimals
      []
    );

    // Verify the buyer has tokens
    const tokenBalance = await connection.getTokenAccountBalance(
      buyerTokenAccount
    );
    assert.equal(
      tokenBalance.value.uiAmount,
      1000,
      "Buyer should have 1000 tokens"
    );
  });

  it("Initialize Platform", async () => {
    // Derive Platform PDA
    const [platformPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("platform")],
      program.programId
    );

    await program.methods
      .initializePlatform(PLATFORM_FEE_BPS)
      .accounts({
        platform: platformPDA,
        authority: platformWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([platformWallet])
      .rpc();

    // Verify platform account data
    const platformAccount = await program.account.platform.fetch(platformPDA);
    assert.equal(
      platformAccount.feeBasisPoints,
      PLATFORM_FEE_BPS,
      "Platform fee not set correctly"
    );
  });

  it("Create Merchant", async () => {
    // Derive Merchant PDA
    const [merchantPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("merchant"), merchantWallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createMerchant("Test Merchant")
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
    assert.equal(merchantAccount.name, "Test Merchant");
    assert.equal(merchantAccount.isActive, true, "Merchant should be active");
  });

  it("Create Affiliate Program", async () => {
    // Derive Merchant and Affiliate Program PDAs
    const [merchantPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("merchant"), merchantWallet.publicKey.toBuffer()],
      program.programId
    );
    const [affiliateProgramPDA] =
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("affiliate_program"), merchantPDA.toBuffer()],
        program.programId
      );

    await program.methods
      .createAffiliateProgram("Test Affiliate Program", REFERRER_FEE_BPS)
      .accounts({
        affiliateProgram: affiliateProgramPDA,
        merchant: merchantPDA,
        authority: merchantWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([merchantWallet])
      .rpc();

    // Verify affiliate program account data
    const affiliateProgramAccount =
      await program.account.affiliateProgram.fetch(affiliateProgramPDA);
    assert.ok(
      affiliateProgramAccount.merchant.equals(merchantPDA),
      "Merchant key does not match"
    );
    assert.equal(affiliateProgramAccount.name, "Test Affiliate Program");
    assert.equal(
      affiliateProgramAccount.referrerFeeBasisPoints,
      REFERRER_FEE_BPS,
      "Referrer fee not set correctly"
    );
    assert.equal(
      affiliateProgramAccount.isActive,
      true,
      "Affiliate program should be active"
    );
  });

  it("Create Referral Link", async () => {
    // Derive Merchant, Affiliate Program, and Referral Link PDAs
    const [merchantPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("merchant"), merchantWallet.publicKey.toBuffer()],
      program.programId
    );
    const [affiliateProgramPDA] =
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("affiliate_program"), merchantPDA.toBuffer()],
        program.programId
      );
    const [referralLinkPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("referral_link"),
        affiliateProgramPDA.toBuffer(),
        referrerWallet.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .createReferralLink("TESTCODE123")
      .accounts({
        referralLink: referralLinkPDA,
        affiliateProgram: affiliateProgramPDA,
        referrer: referrerWallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([referrerWallet])
      .rpc();

    // Verify referral link account data
    const referralLinkAccount = await program.account.referralLink.fetch(
      referralLinkPDA
    );
    assert.ok(
      referralLinkAccount.affiliateProgram.equals(affiliateProgramPDA),
      "Affiliate program key does not match"
    );
    assert.ok(
      referralLinkAccount.referrer.equals(referrerWallet.publicKey),
      "Referrer key does not match"
    );
    assert.equal(referralLinkAccount.code, "TESTCODE123");
    assert.equal(referralLinkAccount.clickCount, 0);
    assert.equal(referralLinkAccount.conversionCount, 0);
    assert.equal(referralLinkAccount.totalSales, 0);
    assert.equal(referralLinkAccount.totalCommission, 0);
    assert.equal(referralLinkAccount.isActive, true);
  });

  it("Process Sale", async () => {
    // Derive all necessary PDAs
    const [platformPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("platform")],
      program.programId
    );
    const [merchantPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("merchant"), merchantWallet.publicKey.toBuffer()],
      program.programId
    );
    const [affiliateProgramPDA] =
      await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("affiliate_program"), merchantPDA.toBuffer()],
        program.programId
      );
    const [referralLinkPDA] = await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("referral_link"),
        affiliateProgramPDA.toBuffer(),
        referrerWallet.publicKey.toBuffer(),
      ],
      program.programId
    );

    const saleAmount = tokenAmount(100); // 100 tokens

    await program.methods
      .processSale(saleAmount)
      .accounts({
        platform: platformPDA,
        merchant: merchantPDA,
        affiliateProgram: affiliateProgramPDA,
        referralLink: referralLinkPDA,
        buyer: user.publicKey,
        buyerTokenAccount: buyerTokenAccount,
        merchantTokenAccount: merchantTokenAccount,
        referrerTokenAccount: referrerTokenAccount,
        platformTokenAccount: platformTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Verify referral link stats were updated
    const referralLinkAccount = await program.account.referralLink.fetch(
      referralLinkPDA
    );
    assert.equal(referralLinkAccount.conversionCount, 1);
    assert.equal(referralLinkAccount.totalSales, saleAmount.toNumber());

    // Note: You might want to add more detailed checks for token balance changes
  });

  // Additional tests for other methods like incrementClick, updatePlatformFee, etc.
});
