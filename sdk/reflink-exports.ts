// Here we export some useful types and functions for interacting with the Anchor program.
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import { Cluster, PublicKey } from '@solana/web3.js'
import ReflinkIDL from '../target/idl/reflink.json'
import type { Reflink } from '../target/types/reflink'

// Re-export the generated IDL and type
export { Reflink, ReflinkIDL }

// The programId is imported from the program IDL.
export const REFLINK_PROGRAM_ID = new PublicKey(ReflinkIDL.address)

// This is a helper function to get the Reflink Anchor program.
export function getReflinkProgram(provider: AnchorProvider, address?: PublicKey) {
  return new Program({ ...ReflinkIDL, address: address ? address.toBase58() : ReflinkIDL.address } as Reflink, provider)
}

// This is a helper function to get the program ID for the Reflink program depending on the cluster.
export function getReflinkProgramId(cluster: Cluster) {
  switch (cluster) {
    case 'devnet':
    case 'testnet':
      // This is the program ID for the Reflink program on devnet and testnet.
      return new PublicKey('coUnmi3oBUtwtd9fjeAvSsJssXh5A5xyPbhpewyzRVF')
    case 'mainnet-beta':
    default:
      return REFLINK_PROGRAM_ID
  }
}
