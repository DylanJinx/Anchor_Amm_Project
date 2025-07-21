import * as anchor from "@coral-xyz/anchor";
import {
  type Connection,
  Keypair,
  PublicKey,
  type Signer,
} from "@solana/web3.js";
import {
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
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

export const mintingTokens = async ({
  connection, // solana 网络连接
  creator, // 创建代币的人（需要支付费用）
  holder = creator, // 持有代币的人（默认是creator)
  mint_a, // 代币A的密钥对
  mint_b, // 代币B的密钥对
  mintedAmount = 100, // 给holder铸造多少个币（默认100）
  decimals = 6, // 代币小数位数（默认6位，像USDC）
}: {
  connection: Connection;
  creator: Signer;
  holder?: Signer;
  mint_a: Keypair;
  mint_b: Keypair;
  mintedAmount?: number;
  decimals?: number;
}) => {
  // 第1步：给creator充值SOL
  // - 创建代币、创建账户都需要SOL作为"燃料费"
  // - 10 ** 10 = 100亿lamports = 10 SOL
  // - requestAirdrop: 在测试网络中免费获得SOL
  // - confirmTransaction: 等待交易确认完成
  await connection.confirmTransaction(
    await connection.requestAirdrop(creator.publicKey, 10 ** 10)
  );

  // 第2步：创建两种代币
  await createMint(
    connection, // 网络连接
    creator, // 谁来支付创建费用
    creator.publicKey, // mint authority（谁有权限铸造代币）
    creator.publicKey, // freeze authority（谁有权限冻结代币）
    decimals, // 小数位数
    mint_a // 代币的身份
  );
  await createMint(
    connection, // 网络连接
    creator, // 谁来支付创建费用
    creator.publicKey, // mint authority（谁有权限铸造代币）
    creator.publicKey, // freeze authority（谁有权限冻结代币）
    decimals, // 小数位数
    mint_b // 代币的身份
  );

  // 第3步：为holder创建代币账户
  await getOrCreateAssociatedTokenAccount(
    connection, // 网络连接
    holder, // 谁来支付创建费用
    mint_a.publicKey, // 存储哪种代币
    holder.publicKey, // 谁拥有这个代币账户
    true // allowOwnerOffCurve参数
  );
  await getOrCreateAssociatedTokenAccount(
    connection,
    holder,
    mint_b.publicKey,
    holder.publicKey,
    true
  );

  // 第4步：向代币账户铸造代币
  await mintTo(
    connection,
    creator, // 谁来签名（必须是mint authority）
    mint_a.publicKey, // 哪种代币的mint
    getAssociatedTokenAddressSync(mint_a.publicKey, holder.publicKey, true), // 目标账户
    creator.publicKey, // mint authority
    mintedAmount * 10 ** decimals // 铸造数量（注意小数位转换）
  );
  await mintTo(
    connection,
    creator, // 谁来签名（必须是mint authority）
    mint_b.publicKey, // 哪种代币的mint
    getAssociatedTokenAddressSync(mint_b.publicKey, holder.publicKey, true), // 目标账户
    creator.publicKey, // mint authority
    mintedAmount * 10 ** decimals // 铸造数量（注意小数位转换）
  );
};
