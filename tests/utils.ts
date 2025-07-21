import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

export interface TestValues {
  // CreateAmm
  id: PublicKey;
  fee: number;
  admin: Keypair;
  ammPda: PublicKey;
}
