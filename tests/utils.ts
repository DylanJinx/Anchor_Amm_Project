import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";

export interface TestValues {
  // CreateAmm
  id: PublicKey;
  fee: number;
  admin: Keypair;
  ammPda: PublicKey;
}

export function createTestValues(): TestValues {
  const id = Keypair.generate().publicKey;
  const admin = Keypair.generate();
  const fee = 500;
  const [ammPda, bump] = PublicKey.findProgramAddressSync(
    [id.toBuffer()],
    anchor.workspace.MyAmmProject.programId
  );

  return {
    id,
    fee,
    admin,
    ammPda,
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
