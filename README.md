# RefLink - Solana Affiliate Program

A decentralized affiliate marketing protocol built on Solana that enables merchants to offer commission-based referrals for SOL payments.

## Overview

RefLink is a Solana program that facilitates affiliate marketing by allowing:

- Merchants to register their business, set commission rates (as a percentage, e.g., 10 for 10%), and manage their program status.
- Affiliates to register and then join specific merchant programs.
- Automatic distribution of SOL payments between merchants and affiliates upon a successful referral.
- Support for native SOL.

## Features

- **Flexible Commission Structure**: Merchants can set and update their commission rates (as a percentage, 0-100).
- **Native SOL Support**: Process affiliate payments using Solana's native currency.
- **Merchant Controls**: Merchants can toggle their program on/off, update their name, website, and adjust commission rates.
- **Affiliate-Merchant Linking**: Affiliates can formally join a merchant's program, creating a tracked relationship via an `AffiliateMerchant` account.
- **Performance Tracking**: Track merchant and affiliate performance metrics including total earned/revenue and number of referrals.

## Account Structure

The program uses the following account types:

- **Merchant**: Stores merchant details (name, authority, commission rate, website, status) and aggregates performance (total revenue, total referrals).
- **Affiliate**: Tracks affiliate details (name, authority) and aggregates performance (total commission, total referrals across all merchants).
- **AffiliateMerchant**: Represents the relationship between an affiliate and a specific merchant, tracking commission earned and referrals for that particular merchant.

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor](https://www.anchor-lang.com/docs/installation)
- Node.js & npm

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/reflink-labs/reflink-anchor.git
   cd reflink-anchor
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the program:

   ```bash
   anchor build
   ```

4. Deploy the program:
   ```bash
   anchor deploy
   ```

## Usage

### For Merchants

1. Register as a merchant:

   ```javascript
   // merchantAuthorityWallet is the Keypair for the merchant's authority
   const [merchantPDA, _merchantBump] =
     await anchor.web3.PublicKey.findProgramAddress(
       [Buffer.from("merchant"), merchantAuthorityWallet.publicKey.toBuffer()],
       program.programId
     );

   await program.methods
     .registerMerchant("My Online Store", 10, "https://mystore.com") // 10% commission
     .accounts({
       authority: merchantAuthorityWallet.publicKey, // This is the signer and payer
       merchant: merchantPDA, // Address for the new merchant account
       systemProgram: anchor.web3.SystemProgram.programId,
     })
     .signers([merchantAuthorityWallet]) // merchantAuthorityWallet signs as authority
     .rpc();
   ```

2. Update merchant details:
   The `updateMerchant` method can be used to change the name, commission rate, website URL, or active status.
   Pass `null` for fields you don't want to change.

   Example: Update commission rate to 15%

   ```javascript
   // merchantPDA is the public key of the existing merchant account
   // merchantAuthorityWallet is the Keypair that is the authority for the merchantPDA
   await program.methods
     .updateMerchant(null, 15, null, null) // Update commission to 15%
     .accounts({
       authority: merchantAuthorityWallet.publicKey,
       merchant: merchantPDA,
       // systemProgram might be needed if reallocating, but often not for simple updates
     })
     .signers([merchantAuthorityWallet])
     .rpc();
   ```

   Example: Deactivate merchant program

   ```javascript
   await program.methods
     .updateMerchant(null, null, null, false) // Deactivate merchant program
     .accounts({
       authority: merchantAuthorityWallet.publicKey,
       merchant: merchantPDA,
     })
     .signers([merchantAuthorityWallet])
     .rpc();
   ```

### For Affiliates

1. Register as an affiliate:

   ```javascript
   // affiliateAuthorityWallet is the Keypair for the affiliate's authority
   const [affiliatePDA, _affiliateBump] =
     await anchor.web3.PublicKey.findProgramAddress(
       [
         Buffer.from("affiliate"),
         affiliateAuthorityWallet.publicKey.toBuffer(),
       ],
       program.programId
     );

   await program.methods
     .registerAffiliate("Super Affiliate")
     .accounts({
       authority: affiliateAuthorityWallet.publicKey, // Signer and payer
       affiliate: affiliatePDA, // Address for the new affiliate account
       systemProgram: anchor.web3.SystemProgram.programId,
     })
     .signers([affiliateAuthorityWallet]) // affiliateAuthorityWallet signs as authority
     .rpc();
   ```

2. Join a Merchant's Program:
   Affiliates must join a merchant's program to start earning commissions from them. This creates an `AffiliateMerchant` account.

   ```javascript
   // affiliateAuthorityWallet is the Keypair of the affiliate wishing to join
   // affiliatePDA is the affiliate's account PDA (created in the previous step)
   // merchantPDA is the merchant's account PDA they are joining

   const [affiliateMerchantPDA, _amBump] =
     await anchor.web3.PublicKey.findProgramAddress(
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
       authority: affiliateAuthorityWallet.publicKey, // Affiliate's authority signs
       affiliate: affiliatePDA,
       merchant: merchantPDA,
       affiliateMerchant: affiliateMerchantPDA, // Address for the new relationship account
       systemProgram: anchor.web3.SystemProgram.programId,
     })
     .signers([affiliateAuthorityWallet])
     .rpc();
   ```

### Processing Purchases (SOL only)

When a customer makes a purchase referred by an affiliate, use the `processPurchase` instruction.

```javascript
// customerWallet: Keypair of the customer making the purchase (will sign and pay)
// merchantPDA: The merchant's program account PDA
// affiliatePDA: The affiliate's account PDA who referred the customer
// affiliateMerchantPDA: The AffiliateMerchant relationship account PDA (created via joinMerchant)
// merchantAuthorityPublicKey: The public key of the merchant's main wallet (where their share of funds go)
// affiliateAuthorityPublicKey: The public key of the affiliate's main wallet (where their commission goes)

const purchaseAmount = new anchor.BN(1_000_000_000); // Example: 1 SOL (in lamports)

await program.methods
  .processPurchase(purchaseAmount)
  .accounts({
    customer: customerWallet.publicKey, // Customer signs and pays
    merchant: merchantPDA,
    affiliate: affiliatePDA,
    affiliateMerchant: affiliateMerchantPDA,
    merchantAuthority: merchantAuthorityPublicKey, // Merchant's wallet to receive funds
    affiliateAuthority: affiliateAuthorityPublicKey, // Affiliate's wallet to receive commission
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .signers([customerWallet]) // Customer signs
  .rpc();
```

## Integration Guide

To integrate RefLink into your dApp or website:

1. Merchants create their program account using `registerMerchant`.
2. Affiliates register using `registerAffiliate`.
3. Affiliates join merchant programs using `joinMerchant` to establish a trackable link (`AffiliateMerchant` account).
4. When a purchase is made through an affiliate:
   - Call the `processPurchase` instruction with the purchase amount, relevant merchant, affiliate, and affiliate-merchant accounts, and the respective authority wallets for fund distribution.
   - Payment is automatically split and transferred (in SOL) from the customer to the merchant's and affiliate's authority wallets based on the merchant's commission rate.

## Security Considerations

- All payment operations require appropriate signatures.
- Commission rate is capped at 100%.
- Verification checks ensure merchants are active before processing purchases.

## Testing

Run the test suite:

```bash
anchor test
```

The tests cover:

- Account creation (Merchant, Affiliate, AffiliateMerchant)
- SOL payment processing
- Commission calculations
- Merchant updates (name, rate, status, website)
- Affiliate joining merchant programs

## License

[MIT](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
