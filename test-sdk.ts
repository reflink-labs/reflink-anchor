import { AnchorProvider, web3, BN } from "@coral-xyz/anchor";
import { ReflinkSDK } from "./sdk";

const provider = AnchorProvider.env();
const sdk = new ReflinkSDK(provider);

const merchant = web3.Keypair.generate();
const promoter = web3.Keypair.generate();
const buyer = web3.Keypair.generate();
const platform = web3.Keypair.generate();

(async () => {
  // Airdrop some SOL
  await Promise.all([
    sdk.airdrop(merchant.publicKey),
    sdk.airdrop(promoter.publicKey),
    sdk.airdrop(buyer.publicKey),
    sdk.airdrop(platform.publicKey),
  ]);

  const promotion = await sdk.createPromotion(merchant, 10);

  const promotionLink = await sdk.promote(promoter, promotion);

  await sdk.purchase(
    buyer,
    promotion,
    promoter.publicKey,
    merchant.publicKey,
    platform.publicKey,
    new BN(1_000_000_000)
  );

  await sdk.closePromotion(merchant, promotion);

  const promoAccount = await sdk.fetchPromotion(promotion);
  console.log("Promotion is open:", promoAccount.isOpen);

  const promoLinkAccount = await sdk.fetchPromotionLink(promotionLink);
  console.log(
    "Promoter of promotion link:",
    promoLinkAccount.promoter.toBase58()
  );
})();
