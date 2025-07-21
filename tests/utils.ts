import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { BN } from "bn.js";

// 需要Keypair的情况：
// - 要创建新的资源（mint、账户等）
// - 可能需要签名的操作

// 需要PublicKey的情况：
// - 计算出的地址（PDA、ATA）
// - 只需要引用的地址

export interface TestValues {
  // CreateAmm
  id: PublicKey;
  fee: number;
  admin: Keypair;
  ammPda: PublicKey;

  // CreatePool
  mint_a: Keypair;
  mint_b: Keypair;
  poolPda: PublicKey;
  poolAuthority: PublicKey;
  mintLiquidity: PublicKey;
  poolAccountA: PublicKey;
  poolAccountB: PublicKey;
}

export function createTestValues(): TestValues {
  const id = Keypair.generate().publicKey;
  const admin = Keypair.generate();
  const fee = 500;
  const [ammPda, bump_amm] = PublicKey.findProgramAddressSync(
    [id.toBuffer()],
    anchor.workspace.MyAmmProject.programId
  );

  const mint_a = Keypair.generate();
  let mint_b = Keypair.generate();
  while (
    new BN(mint_b.publicKey.toBytes()).lt(new BN(mint_a.publicKey.toBytes())) // lt = lessThan，如果mint_b < mint_a 那么就继续生成
  ) {
    mint_b = Keypair.generate();
  }

  const [poolPda, bump_pool] = PublicKey.findProgramAddressSync(
    [
      ammPda.toBuffer(),
      mint_a.publicKey.toBuffer(),
      mint_b.publicKey.toBuffer(),
    ],
    anchor.workspace.MyAmmProject.programId
  );
  const poolAuthority = PublicKey.findProgramAddressSync(
    [
      ammPda.toBuffer(),
      mint_a.publicKey.toBuffer(),
      mint_b.publicKey.toBuffer(),
      Buffer.from("authority"),
    ],
    anchor.workspace.MyAmmProject.programId
  )[0];
  const mintLiquidity = PublicKey.findProgramAddressSync(
    [
      ammPda.toBuffer(),
      mint_a.publicKey.toBuffer(),
      mint_b.publicKey.toBuffer(),
      Buffer.from("liquidity"),
    ],
    anchor.workspace.MyAmmProject.programId
  )[0];
  const poolAccountA = getAssociatedTokenAddressSync(
    mint_a.publicKey,
    poolAuthority,
    true
  );
  const poolAccountB = getAssociatedTokenAddressSync(
    mint_b.publicKey,
    poolAuthority,
    true
  );

  return {
    id,
    fee,
    admin,
    ammPda,
    mint_a,
    mint_b,
    poolPda,
    poolAuthority,
    mintLiquidity,
    poolAccountA,
    poolAccountB,
  };
}

export const expectRevert = async (promise: Promise<any>) => {
  try {
    await promise;
    // 如果到这里，说明操作成功了，但我们期望失败
    throw new Error("Expected operation to fail, but it succeeded");
  } catch (error: any) {
    // 如果到这里，说明操作失败了，这是我们期望的
    // 但要确保不是我们自己抛出的错误
    if (error.message == "Expected operation to fail, but it succeeded") {
      throw error; // 重新抛出我们的错误
    }
    // 其他错误都是预期的，正常返回
    return;
  }
};
