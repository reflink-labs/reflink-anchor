# RefLink - Solana Affiliate Program

A decentralized affiliate marketing protocol built on Solana that enables merchants to offer commission-based referrals for both SOL and SPL token payments.

## Overview

RefLink is a Solana program that facilitates affiliate marketing by allowing:

- Merchants to register and set commission rates
- Affiliates to register and track their referrals
- Automatic distribution of payments between merchants and affiliates
- Support for both native SOL and any SPL token

## Features

- **Flexible Commission Structure**: Merchants can set and update their commission rates (in basis points)
- **Native SOL Support**: Process affiliate payments using Solana's native currency
- **SPL Token Support**: Process affiliate payments using any SPL token
- **Merchant Controls**: Merchants can toggle their program on/off and adjust commission rates
- **Performance Tracking**: Track affiliate performance metrics including total earned and number of referrals

## Account Structure

The program uses the following account types:

- **Merchant**: Stores merchant details and commission rates
- **Affiliate**: Tracks affiliate information and performance
- **Referral**: Records individual referral transactions

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor](https://www.anchor-lang.com/docs/installation)
- Node.js & npm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/reflink.git
   cd reflink
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
   await program.methods
     .registerMerchant(500) // 5% commission (500 basis points)
     .accounts({
       merchant: merchantKeypair.publicKey,
       authority: yourWallet.publicKey,
     })
     .signers([merchantKeypair, yourWallet])
     .rpc();
   ```

2. Update commission rate:
   ```javascript
   await program.methods
     .updateMerchantCommission(1000) // 10% commission (1000 basis points)
     .accounts({
       merchant: merchantPublicKey,
       authority: yourWallet.publicKey,
     })
     .signers([yourWallet])
     .rpc();
   ```

3. Toggle active status:
   ```javascript
   await program.methods
     .toggleMerchantStatus()
     .accounts({
       merchant: merchantPublicKey,
       authority: yourWallet.publicKey,
     })
     .signers([yourWallet])
     .rpc();
   ```

### For Affiliates

1. Register as an affiliate:
   ```javascript
   await program.methods
     .registerAffiliate()
     .accounts({
       affiliate: affiliateKeypair.publicKey,
       authority: yourWallet.publicKey,
     })
     .signers([affiliateKeypair, yourWallet])
     .rpc();
   ```

### Processing Referrals

#### Native SOL Payment

```javascript
await program.methods
  .registerReferralSol(new anchor.BN(100_000_000)) // 0.1 SOL
  .accounts({
    affiliate: affiliatePublicKey,
    referral: referralKeypair.publicKey,
    merchant: merchantPublicKey,
    merchantWallet: merchantWalletPublicKey,
    affiliateWallet: affiliateWalletPublicKey,
    payer: customerWallet.publicKey,
  })
  .signers([referralKeypair, customerWallet])
  .rpc();
```

#### SPL Token Payment

```javascript
await program.methods
  .registerReferralToken(tokenAmount(100)) // 100 tokens
  .accounts({
    affiliate: affiliatePublicKey,
    referral: referralKeypair.publicKey,
    merchant: merchantPublicKey,
    tokenMint: tokenMintPublicKey,
    merchantTokenAccount: merchantTokenAccountPublicKey,
    affiliateTokenAccount: affiliateTokenAccountPublicKey,
    payerTokenAccount: customerTokenAccountPublicKey,
    payer: customerWallet.publicKey,
  })
  .signers([referralKeypair, customerWallet])
  .rpc();
```

## Integration Guide

To integrate RefLink into your dApp or website:

1. Create merchant and affiliate accounts
2. When a purchase is made through an affiliate link:
   - Collect payment from customer
   - Call the appropriate referral registration instruction
   - Payment is automatically split between merchant and affiliate

## Security Considerations

- All payment operations require appropriate signatures
- Commission rate is capped at 100% (10,000 basis points)
- Verification checks ensure merchants are active
- Calculations use checked math operations to prevent overflows

## Testing

Run the test suite:

```bash
anchor test
```

The tests cover:
- Account creation
- SOL payment processing
- SPL token payment processing
- Commission calculations
- Merchant status and rate updates

## License

[MIT](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request