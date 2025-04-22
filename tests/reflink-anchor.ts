import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Reflink } from "../target/types/reflink";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

describe("reflink", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Reflink as Program<Reflink>;

  it("Create campaign and log referral", async () => {
    const campaign = Keypair.generate();
    const merchant = provider.wallet;
    const campaignId = "campaign001";

    await program.methods
      .createCampaign(campaignId)
      .accounts({
        campaign: campaign.publicKey,
        merchant: merchant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([campaign])
      .rpc();

    const referralRecord = Keypair.generate();
    const referrer = Keypair.generate();
    const customer = Keypair.generate();

    await program.methods
      .logReferralEvent("purchase", "order123|amount:50")
      .accounts({
        referralRecord: referralRecord.publicKey,
        campaign: campaign.publicKey,
        referrer: referrer.publicKey,
        customer: customer.publicKey,
        payer: merchant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([referralRecord])
      .rpc();

    console.log("✅ Referral logged");
  });
});
