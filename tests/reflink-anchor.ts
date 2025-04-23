import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Reflink } from "../target/types/reflink";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

describe("reflink", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Reflink as Program<Reflink>;

  it("Create campaign and log referral", async () => {
    const merchant = provider.wallet;
    const campaignId = "campaign001";

    const [campaignPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), merchant.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .createCampaign(campaignId)
      .accounts({
        campaign: campaignPda,
        merchant: merchant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const referrer = Keypair.generate();
    const customer = Keypair.generate();

    const [referralRecordPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("record"),
        campaignPda.toBuffer(),
        customer.publicKey.toBuffer(),
        Buffer.from("purchase"),
      ],
      program.programId
    );

    await program.methods
      .logReferralEvent("purchase", "order123|amount:50")
      .accounts({
        referralRecord: referralRecordPda,
        campaign: campaignPda,
        referrer: referrer.publicKey,
        customer: customer.publicKey,
        payer: merchant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Referral logged");
  });
});
