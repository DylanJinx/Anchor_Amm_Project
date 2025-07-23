import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";
import { MyAmmProject } from "../target/types/my_amm_project";
import {
  type TestValues,
  createTestValues,
  expectRevert,
  mintingTokens,
  mintTokensToUser,
} from "./utils";

describe("Swap Exact Tokens For Tokens", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  anchor.setProvider(provider);

  const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;

  let values: TestValues;

  beforeEach(async () => {
    // Setup: 生成测试数据
    values = createTestValues();

    // Setup: 创建AMM
    await program.methods
      .createAmm(values.id, values.fee)
      .accounts({
        amm: values.ammPda,
        admin: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    // Setup: 创建代币并给admin铸造
    await mintingTokens({
      connection,
      creator: values.admin,
      holder: values.admin,
      mint_a: values.mint_a,
      mint_b: values.mint_b,
      mintedAmount: 10000, // 10000个代币用于测试
      decimals: 6,
    });

    // Setup: 创建Pool
    await program.methods
      .createPool()
      .accounts({
        amm: values.ammPda,
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        mintLiquidity: values.mintLiquidity,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    // Setup: 添加初始流动性 (1000个A, 2000个B)
    const initialAmountA = 1000 * 10 ** 6;
    const initialAmountB = 2000 * 10 ** 6;
    
    await program.methods
      .depositLiquidity(new anchor.BN(initialAmountA), new anchor.BN(initialAmountB))
      .accounts({
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        mintLiquidity: values.mintLiquidity,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        depositorAccountLiquidity: getAssociatedTokenAddressSync(
          values.mintLiquidity,
          values.admin.publicKey,
          true
        ),
        depositorAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          values.admin.publicKey,
          true
        ),
        depositorAccountB: getAssociatedTokenAddressSync(
          values.mint_b.publicKey,
          values.admin.publicKey,
          true
        ),
        depositor: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([values.admin])
      .rpc();
  });

  it("Success: Swap A for B (swap_a = true)", async () => {
    const inputAmount = 100 * 10 ** 6; // 100个token A
    const minOutputAmount = 160 * 10 ** 6; // 降低最小输出期望，理论值约173

    // 获取交换前的余额
    const traderTokenA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      values.admin.publicKey,
      true
    );
    const traderTokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      values.admin.publicKey,
      true
    );

    const beforeTraderA = (await getAccount(connection, traderTokenA)).amount;
    const beforeTraderB = (await getAccount(connection, traderTokenB)).amount;
    const beforePoolA = (await getAccount(connection, values.poolAccountA)).amount;
    const beforePoolB = (await getAccount(connection, values.poolAccountB)).amount;

    // 计算理论输出 (手动计算用于验证)
    // fee = 500 (5%), taxed_input = 100 * (1 - 0.05) = 95
    // output = 95 * 2000 / (1000 + 95) = 95 * 2000 / 1095 ≈ 173.52
    const expectedTaxedInput = inputAmount * (10000 - values.fee) / 10000;
    const expectedOutput = Math.floor(
      (expectedTaxedInput * Number(beforePoolB)) / (Number(beforePoolA) + expectedTaxedInput)
    );

    // 执行交换
    await program.methods
      .swapExactTokensForTokens(
        true, // swap_a = true (A -> B)
        new anchor.BN(inputAmount),
        new anchor.BN(minOutputAmount)
      )
      .accounts({
        amm: values.ammPda,
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        trader: values.admin.publicKey,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        traderAccountA: traderTokenA,
        traderAccountB: traderTokenB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([values.admin])
      .rpc();

    // 验证余额变化
    const afterTraderA = (await getAccount(connection, traderTokenA)).amount;
    const afterTraderB = (await getAccount(connection, traderTokenB)).amount;
    const afterPoolA = (await getAccount(connection, values.poolAccountA)).amount;
    const afterPoolB = (await getAccount(connection, values.poolAccountB)).amount;

    // 用户代币A减少，代币B增加
    expect(Number(beforeTraderA - afterTraderA)).to.equal(inputAmount);
    expect(Number(afterTraderB - beforeTraderB)).to.be.greaterThan(minOutputAmount);

    // 池子代币A增加，代币B减少
    expect(Number(afterPoolA - beforePoolA)).to.equal(inputAmount);
    expect(Number(beforePoolB - afterPoolB)).to.be.greaterThan(0);

    // 验证不变量增加或保持（由于手续费，应该略有增加）
    const beforeK = Number(beforePoolA) * Number(beforePoolB);
    const afterK = Number(afterPoolA) * Number(afterPoolB);
    expect(afterK).to.be.greaterThanOrEqual(beforeK);

    console.log(`Swapped ${inputAmount / 10**6} A for ${Number(afterTraderB - beforeTraderB) / 10**6} B`);
    console.log(`Expected output: ~${expectedOutput / 10**6}, Actual: ${Number(afterTraderB - beforeTraderB) / 10**6}`);
  });

  it("Success: Swap B for A (swap_a = false)", async () => {
    const inputAmount = 200 * 10 ** 6; // 200个token B
    const minOutputAmount = 80 * 10 ** 6;  // 降低最小输出期望

    // 获取交换前的余额
    const traderTokenA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      values.admin.publicKey,
      true
    );
    const traderTokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      values.admin.publicKey,
      true
    );

    const beforeTraderA = (await getAccount(connection, traderTokenA)).amount;
    const beforeTraderB = (await getAccount(connection, traderTokenB)).amount;
    const beforePoolA = (await getAccount(connection, values.poolAccountA)).amount;
    const beforePoolB = (await getAccount(connection, values.poolAccountB)).amount;

    // 执行交换
    await program.methods
      .swapExactTokensForTokens(
        false, // swap_a = false (B -> A)
        new anchor.BN(inputAmount),
        new anchor.BN(minOutputAmount)
      )
      .accounts({
        amm: values.ammPda,
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        trader: values.admin.publicKey,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        traderAccountA: traderTokenA,
        traderAccountB: traderTokenB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([values.admin])
      .rpc();

    // 验证余额变化
    const afterTraderA = (await getAccount(connection, traderTokenA)).amount;
    const afterTraderB = (await getAccount(connection, traderTokenB)).amount;
    const afterPoolA = (await getAccount(connection, values.poolAccountA)).amount;
    const afterPoolB = (await getAccount(connection, values.poolAccountB)).amount;

    // 用户代币B减少，代币A增加
    expect(Number(beforeTraderB - afterTraderB)).to.equal(inputAmount);
    expect(Number(afterTraderA - beforeTraderA)).to.be.greaterThan(minOutputAmount);

    // 池子代币B增加，代币A减少
    expect(Number(afterPoolB - beforePoolB)).to.equal(inputAmount);
    expect(Number(beforePoolA - afterPoolA)).to.be.greaterThan(0);

    // 验证不变量
    const beforeK = Number(beforePoolA) * Number(beforePoolB);
    const afterK = Number(afterPoolA) * Number(afterPoolB);
    expect(afterK).to.be.greaterThanOrEqual(beforeK);

    console.log(`Swapped ${inputAmount / 10**6} B for ${Number(afterTraderA - beforeTraderA) / 10**6} A`);
  });

  it("Failure: Slippage protection (output below minimum)", async () => {
    const inputAmount = 50 * 10 ** 6;
    const unrealisticMinOutput = 200 * 10 ** 6; // 期望得到200个B，但实际只能得到~90个

    await expectRevert(
      program.methods
        .swapExactTokensForTokens(
          true,
          new anchor.BN(inputAmount),
          new anchor.BN(unrealisticMinOutput)
        )
        .accounts({
          amm: values.ammPda,
          pool: values.poolPda,
          poolAuthority: values.poolAuthority,
          trader: values.admin.publicKey,
          mintA: values.mint_a.publicKey,
          mintB: values.mint_b.publicKey,
          poolAccountA: values.poolAccountA,
          poolAccountB: values.poolAccountB,
          traderAccountA: getAssociatedTokenAddressSync(
            values.mint_a.publicKey,
            values.admin.publicKey,
            true
          ),
          traderAccountB: getAssociatedTokenAddressSync(
            values.mint_b.publicKey,
            values.admin.publicKey,
            true
          ),
          payer: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([values.admin])
        .rpc()
    );
  });

  it("Success: Swap with insufficient balance (auto-adjustment)", async () => {
    // 创建新用户，只给少量代币
    const newTrader = Keypair.generate();
    const signature = await connection.requestAirdrop(newTrader.publicKey, 10 ** 10);
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    // 给新用户50个代币A
    await mintTokensToUser({
      connection,
      creator: values.admin,
      holder: newTrader,
      mint_a: values.mint_a,
      mint_b: values.mint_b,
      mintedAmount: 50,
      decimals: 6,
    });

    const traderTokenA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      newTrader.publicKey,
      true
    );
    const traderTokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      newTrader.publicKey,
      true
    );

    const beforeBalance = (await getAccount(connection, traderTokenA)).amount;

    // 尝试交换100个A（超过余额），应该自动调整为50个
    await program.methods
      .swapExactTokensForTokens(
        true,
        new anchor.BN(100 * 10 ** 6), // 想换100个，但只有50个
        new anchor.BN(1) // 最小输出设为1
      )
      .accounts({
        amm: values.ammPda,
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        trader: newTrader.publicKey,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        traderAccountA: traderTokenA,
        traderAccountB: traderTokenB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([newTrader])
      .rpc();

    // 验证实际消费了50个A（全部余额）
    const afterBalance = (await getAccount(connection, traderTokenA)).amount;
    expect(Number(beforeBalance - afterBalance)).to.equal(50 * 10 ** 6);

    // 验证得到了一些B代币
    const receivedB = (await getAccount(connection, traderTokenB)).amount;
    expect(Number(receivedB)).to.be.greaterThan(0);
  });

  it("Success: Fee calculation accuracy", async () => {
    // 创建一个0手续费的AMM进行对比测试
    const zeroFeeId = Keypair.generate().publicKey;
    const zeroFeeAmmPda = PublicKey.findProgramAddressSync(
      [zeroFeeId.toBuffer()],
      program.programId
    )[0];

    // 创建0手续费AMM
    await program.methods
      .createAmm(zeroFeeId, 0) // 0% fee
      .accounts({
        amm: zeroFeeAmmPda,
        admin: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    // 计算零手续费池子的地址
    const zeroFeePoolPda = PublicKey.findProgramAddressSync(
      [
        zeroFeeAmmPda.toBuffer(),
        values.mint_a.publicKey.toBuffer(),
        values.mint_b.publicKey.toBuffer(),
      ],
      program.programId
    )[0];

    const zeroFeePoolAuthority = PublicKey.findProgramAddressSync(
      [
        zeroFeeAmmPda.toBuffer(),
        values.mint_a.publicKey.toBuffer(),
        values.mint_b.publicKey.toBuffer(),
        Buffer.from("authority"),
      ],
      program.programId
    )[0];

    const zeroFeeMintLiquidity = PublicKey.findProgramAddressSync(
      [
        zeroFeeAmmPda.toBuffer(),
        values.mint_a.publicKey.toBuffer(),
        values.mint_b.publicKey.toBuffer(),
        Buffer.from("liquidity"),
      ],
      program.programId
    )[0];

    const zeroFeePoolAccountA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      zeroFeePoolAuthority,
      true
    );
    const zeroFeePoolAccountB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      zeroFeePoolAuthority,
      true
    );

    // 创建零手续费池子
    await program.methods
      .createPool()
      .accounts({
        amm: zeroFeeAmmPda,
        pool: zeroFeePoolPda,
        poolAuthority: zeroFeePoolAuthority,
        mintLiquidity: zeroFeeMintLiquidity,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: zeroFeePoolAccountA,
        poolAccountB: zeroFeePoolAccountB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    // 给零手续费池子添加相同的流动性
    await program.methods
      .depositLiquidity(new anchor.BN(1000 * 10 ** 6), new anchor.BN(2000 * 10 ** 6))
      .accounts({
        pool: zeroFeePoolPda,
        poolAuthority: zeroFeePoolAuthority,
        mintLiquidity: zeroFeeMintLiquidity,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: zeroFeePoolAccountA,
        poolAccountB: zeroFeePoolAccountB,
        depositorAccountLiquidity: getAssociatedTokenAddressSync(
          zeroFeeMintLiquidity,
          values.admin.publicKey,
          true
        ),
        depositorAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          values.admin.publicKey,
          true
        ),
        depositorAccountB: getAssociatedTokenAddressSync(
          values.mint_b.publicKey,
          values.admin.publicKey,
          true
        ),
        depositor: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([values.admin])
      .rpc();

    // 在两个池子执行相同的交换，比较结果
    const inputAmount = 100 * 10 ** 6;

    // 创建两个新的交易者账户
    const trader1 = Keypair.generate();
    const trader2 = Keypair.generate();
    const sig1 = await connection.requestAirdrop(trader1.publicKey, 10 ** 10);
    const sig2 = await connection.requestAirdrop(trader2.publicKey, 10 ** 10);
    const latestBlockhash1 = await connection.getLatestBlockhash();
    const latestBlockhash2 = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature: sig1,
      blockhash: latestBlockhash1.blockhash,
      lastValidBlockHeight: latestBlockhash1.lastValidBlockHeight,
    });
    await connection.confirmTransaction({
      signature: sig2,
      blockhash: latestBlockhash2.blockhash,
      lastValidBlockHeight: latestBlockhash2.lastValidBlockHeight,
    });

    // 给两个交易者相同的代币
    await mintTokensToUser({
      connection,
      creator: values.admin,
      holder: trader1,
      mint_a: values.mint_a,
      mint_b: values.mint_b,
      mintedAmount: 1000,
      decimals: 6,
    });
    await mintTokensToUser({
      connection,
      creator: values.admin,
      holder: trader2,
      mint_a: values.mint_a,
      mint_b: values.mint_b,
      mintedAmount: 1000,
      decimals: 6,
    });

    // 在有手续费池子交换
    const trader1TokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      trader1.publicKey,
      true
    );
    const beforeBalanceTrader1 = (await getAccount(connection, trader1TokenB)).amount;

    await program.methods
      .swapExactTokensForTokens(true, new anchor.BN(inputAmount), new anchor.BN(1))
      .accounts({
        amm: values.ammPda,
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        trader: trader1.publicKey,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        traderAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          trader1.publicKey,
          true
        ),
        traderAccountB: trader1TokenB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([trader1])
      .rpc();

    // 在零手续费池子交换
    const trader2TokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      trader2.publicKey,
      true
    );
    const beforeBalanceTrader2 = (await getAccount(connection, trader2TokenB)).amount;

    await program.methods
      .swapExactTokensForTokens(true, new anchor.BN(inputAmount), new anchor.BN(1))
      .accounts({
        amm: zeroFeeAmmPda,
        pool: zeroFeePoolPda,
        poolAuthority: zeroFeePoolAuthority,
        trader: trader2.publicKey,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: zeroFeePoolAccountA,
        poolAccountB: zeroFeePoolAccountB,
        traderAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          trader2.publicKey,
          true
        ),
        traderAccountB: trader2TokenB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([trader2])
      .rpc();

    // 比较结果
    const outputWithFee = (await getAccount(connection, trader1TokenB)).amount - beforeBalanceTrader1;
    const outputNoFee = (await getAccount(connection, trader2TokenB)).amount - beforeBalanceTrader2;

    // 有手续费的应该得到更少的代币
    expect(Number(outputNoFee)).to.be.greaterThan(Number(outputWithFee));

    // 计算手续费影响：应该大约是5%的差异
    const feeImpact = Number(outputNoFee - outputWithFee) / Number(outputNoFee);
    expect(feeImpact).to.be.greaterThan(0.04); // 至少4%差异
    expect(feeImpact).to.be.lessThan(0.06);    // 不超过6%差异

    console.log(`Output with 5% fee: ${Number(outputWithFee) / 10**6}`);
    console.log(`Output with 0% fee: ${Number(outputNoFee) / 10**6}`);
    console.log(`Fee impact: ${(feeImpact * 100).toFixed(2)}%`);
  });

  it("Success: Multiple consecutive swaps maintain invariant", async () => {
    // 执行多次连续交换，验证不变量始终保持或增加
    let currentK = 0;

    for (let i = 0; i < 5; i++) {
      const poolA = await getAccount(connection, values.poolAccountA);
      const poolB = await getAccount(connection, values.poolAccountB);
      const newK = Number(poolA.amount) * Number(poolB.amount);
      
      if (i > 0) {
        expect(newK).to.be.greaterThanOrEqual(currentK);
      }
      currentK = newK;

      // 交替进行A->B和B->A的交换
      const swapA = i % 2 === 0;
      const inputAmount = 10 * 10 ** 6; // 每次交换10个代币

      await program.methods
        .swapExactTokensForTokens(swapA, new anchor.BN(inputAmount), new anchor.BN(1))
        .accounts({
          amm: values.ammPda,
          pool: values.poolPda,
          poolAuthority: values.poolAuthority,
          trader: values.admin.publicKey,
          mintA: values.mint_a.publicKey,
          mintB: values.mint_b.publicKey,
          poolAccountA: values.poolAccountA,
          poolAccountB: values.poolAccountB,
          traderAccountA: getAssociatedTokenAddressSync(
            values.mint_a.publicKey,
            values.admin.publicKey,
            true
          ),
          traderAccountB: getAssociatedTokenAddressSync(
            values.mint_b.publicKey,
            values.admin.publicKey,
            true
          ),
          payer: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([values.admin])
        .rpc();

      console.log(`Swap ${i + 1}: K = ${newK / (10**12)} (${swapA ? 'A->B' : 'B->A'})`);
    }
  });

  it("Success: Large swap with significant price impact", async () => {
    const largeInputAmount = 500 * 10 ** 6; // 500个A (相对于1000个池子余额，这是大量交换)

    // const beforePoolA = (await getAccount(connection, values.poolAccountA)).amount;
    // const beforePoolB = (await getAccount(connection, values.poolAccountB)).amount;

    const traderTokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      values.admin.publicKey,
      true
    );
    const beforeTraderB = (await getAccount(connection, traderTokenB)).amount;

    await program.methods
      .swapExactTokensForTokens(
        true,
        new anchor.BN(largeInputAmount),
        new anchor.BN(1) // 接受任何输出
      )
      .accounts({
        amm: values.ammPda,
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        trader: values.admin.publicKey,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        traderAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          values.admin.publicKey,
          true
        ),
        traderAccountB: traderTokenB,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([values.admin])
      .rpc();

    // const afterPoolA = (await getAccount(connection, values.poolAccountA)).amount;
    // const afterPoolB = (await getAccount(connection, values.poolAccountB)).amount;
    const afterTraderB = (await getAccount(connection, traderTokenB)).amount;

    // 验证大量交换的价格影响
    const outputReceived = Number(afterTraderB - beforeTraderB);
    const priceImpact = 1 - (outputReceived / largeInputAmount / 2); // 初始价格比例是1:2
    
    console.log(`Large swap: ${largeInputAmount / 10**6}A -> ${outputReceived / 10**6}B`);
    console.log(`Price impact: ${(priceImpact * 100).toFixed(2)}%`);
    
    expect(priceImpact).to.be.greaterThan(0.1); // 大量交换应该有显著价格影响 (>10%)
    expect(outputReceived).to.be.lessThan(largeInputAmount * 2); // 由于价格影响，不能按初始比例兑换
  });
});