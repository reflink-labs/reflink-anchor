import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Reflink } from "../target/types/reflink";
import { assert } from "chai";
import { PublicKey, SystemProgram } from "@solana/web3.js";

describe("reflink", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Reflink as Program<Reflink>;

  const merchant = anchor.web3.Keypair.generate();
  const referrer = anchor.web3.Keypair.generate();
  const customer = anchor.web3.Keypair.generate();
  const payer = provider.wallet;

  const campaignId = "demo-campaign";
  const referralRewardBps = 1000; // 10%
  const conversionAmount = anchor.web3.LAMPORTS_PER_SOL;

  let campaignPda: PublicKey;
  let referralPda: PublicKey;
  let campaignBump: number;
  let referralBump: number;

  it("Airdrops lamports to merchant and referrer", async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        merchant.publicKey,
        2 * conversionAmount
      ),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        referrer.publicKey,
        1 * conversionAmount
      ),
      "confirmed"
    );
  });

  it("Creates campaign with reward config", async () => {
    [campaignPda, campaignBump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), merchant.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createCampaign(campaignId, referralRewardBps)
      .accounts({
        campaign: campaignPda,
        merchant: merchant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([merchant])
      .rpc();

    const campaign = await program.account.campaign.fetch(campaignPda);
    assert.equal(campaign.campaignId, campaignId);
    assert.equal(campaign.referralRewardBps, referralRewardBps);
  });

  it("Logs conversion and pays referrer", async () => {
    [referralPda, referralBump] = await PublicKey.findProgramAddressSync(
      [
        Buffer.from("record"),
        campaignPda.toBuffer(),
        customer.publicKey.toBuffer(),
        Buffer.from("conversion"),
      ],
      program.programId
    );

    const referrerBefore = await provider.connection.getBalance(
      referrer.publicKey
    );
    const merchantBefore = await provider.connection.getBalance(
      merchant.publicKey
    );

    await program.methods
      .logConversion(
        "conversion",
        "some-metadata",
        new anchor.BN(conversionAmount)
      )
      .accounts({
        referralRecord: referralPda,
        campaign: campaignPda,
        referrer: referrer.publicKey,
        customer: customer.publicKey,
        merchant: merchant.publicKey,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const referrerAfter = await provider.connection.getBalance(
      referrer.publicKey
    );
    const merchantAfter = await provider.connection.getBalance(
      merchant.publicKey
    );

    const referrerGain = referrerAfter - referrerBefore;
    const merchantGain = merchantAfter - merchantBefore;

    assert.equal(referrerGain, conversionAmount * 0.1);
    assert.equal(merchantGain, conversionAmount * 0.9);

    const record = await program.account.referralRecord.fetch(referralPda);
    assert.equal(record.amount.toNumber(), conversionAmount);
    assert.equal(record.eventType, "conversion");
    assert.equal(record.metadata, "some-metadata");
  });
});
