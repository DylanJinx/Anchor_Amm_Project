import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { expect } from "chai";
import { MyAmmProject } from "./target/types/my_amm_project";
import {
  type TestValues,
  createTestValues,
  mintingTokens,
} from "./tests/utils";

describe("Complete AMM Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  anchor.setProvider(provider);

  const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;

  let values: TestValues;
  let liquidityProvider1: Keypair;
  let liquidityProvider2: Keypair;
  let trader1: Keypair;
  let trader2: Keypair;

  beforeEach(async () => {
    // Setup: 生成测试数据和用户
    values = createTestValues();
    liquidityProvider1 = Keypair.generate();
    liquidityProvider2 = Keypair.generate();
    trader1 = Keypair.generate();
    trader2 = Keypair.generate();

    // 给所有用户充值SOL
    const users = [liquidityProvider1, liquidityProvider2, trader1, trader2];
    for (const user of users) {
      const signature = await connection.requestAirdrop(
        user.publicKey,
        10 ** 10
      );
      await connection.confirmTransaction(signature);
    }

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

    // Setup: 给所有用户创建代币
    for (const user of users) {
      await mintingTokens({
        connection,
        creator: values.admin,
        holder: user,
        mint_a: values.mint_a,
        mint_b: values.mint_b,
        mintedAmount: 10000, // 每个用户10000个代币
        decimals: 6,
      });
    }

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
  });

  it("Complete AMM Lifecycle: Create → Deposit → Swap → Withdraw", async () => {
    console.log("=== Complete AMM Lifecycle Test ===");

    // ========= Phase 1: 初始流动性提供 =========
    console.log("\n1. Initial Liquidity Provision");

    const initialAmountA = 1000 * 10 ** 6; // 1000 A
    const initialAmountB = 2000 * 10 ** 6; // 2000 B (1:2 价格比)

    await program.methods
      .depositLiquidity(
        new anchor.BN(initialAmountA),
        new anchor.BN(initialAmountB)
      )
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
          liquidityProvider1.publicKey,
          true
        ),
        depositorAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          liquidityProvider1.publicKey,
          true
        ),
        depositorAccountB: getAssociatedTokenAddressSync(
          values.mint_b.publicKey,
          liquidityProvider1.publicKey,
          true
        ),
        depositor: liquidityProvider1.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([liquidityProvider1])
      .rpc();

    // 验证初始流动性
    const initialPoolA = await getAccount(connection, values.poolAccountA);
    const initialPoolB = await getAccount(connection, values.poolAccountB);
    const lp1Balance = await getAccount(
      connection,
      getAssociatedTokenAddressSync(
        values.mintLiquidity,
        liquidityProvider1.publicKey,
        true
      )
    );

    expect(initialPoolA.amount.toString()).to.equal(initialAmountA.toString());
    expect(initialPoolB.amount.toString()).to.equal(initialAmountB.toString());
    expect(Number(lp1Balance.amount)).to.be.greaterThan(0);

    console.log(
      `✓ LP1 added ${initialAmountA / 10 ** 6}A + ${
        initialAmountB / 10 ** 6
      }B, got ${Number(lp1Balance.amount)} LP tokens`
    );

    // ========= Phase 2: 第二个流动性提供者 =========
    console.log("\n2. Second Liquidity Provider");

    const secondAmountA = 500 * 10 ** 6; // 500 A
    const secondAmountB = 1000 * 10 ** 6; // 1000 B (保持1:2比例)

    await program.methods
      .depositLiquidity(
        new anchor.BN(secondAmountA),
        new anchor.BN(secondAmountB)
      )
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
          liquidityProvider2.publicKey,
          true
        ),
        depositorAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          liquidityProvider2.publicKey,
          true
        ),
        depositorAccountB: getAssociatedTokenAddressSync(
          values.mint_b.publicKey,
          liquidityProvider2.publicKey,
          true
        ),
        depositor: liquidityProvider2.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([liquidityProvider2])
      .rpc();

    const afterSecondDeposit_PoolA = await getAccount(
      connection,
      values.poolAccountA
    );
    const afterSecondDeposit_PoolB = await getAccount(
      connection,
      values.poolAccountB
    );
    const lp2Balance = await getAccount(
      connection,
      getAssociatedTokenAddressSync(
        values.mintLiquidity,
        liquidityProvider2.publicKey,
        true
      )
    );

    expect(Number(afterSecondDeposit_PoolA.amount)).to.equal(1500 * 10 ** 6); // 1000 + 500
    expect(Number(afterSecondDeposit_PoolB.amount)).to.equal(3000 * 10 ** 6); // 2000 + 1000
    expect(Number(lp2Balance.amount)).to.be.greaterThan(0);

    console.log(
      `✓ LP2 added ${secondAmountA / 10 ** 6}A + ${
        secondAmountB / 10 ** 6
      }B, got ${Number(lp2Balance.amount)} LP tokens`
    );
    console.log(
      `✓ Total pool: ${Number(afterSecondDeposit_PoolA.amount) / 10 ** 6}A + ${
        Number(afterSecondDeposit_PoolB.amount) / 10 ** 6
      }B`
    );

    // ========= Phase 3: 交易活动 =========
    console.log("\n3. Trading Activity");

    // Trader1: A -> B 交换
    const swapAmountA = 150 * 10 ** 6; // 150 A
    const trader1TokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      trader1.publicKey,
      true
    );

    const beforeSwap_TraderB = (await getAccount(connection, trader1TokenB))
      .amount;
    const beforeSwap_PoolA = (await getAccount(connection, values.poolAccountA))
      .amount;
    const beforeSwap_PoolB = (await getAccount(connection, values.poolAccountB))
      .amount;

    await program.methods
      .swapExactTokensForTokens(
        true, // A -> B
        new anchor.BN(swapAmountA),
        new anchor.BN(250 * 10 ** 6) // 期望至少得到250B
      )
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

    const afterSwap1_TraderB = (await getAccount(connection, trader1TokenB))
      .amount;
    // const afterSwap1_PoolA = (await getAccount(connection, values.poolAccountA)).amount;
    // const afterSwap1_PoolB = (await getAccount(connection, values.poolAccountB)).amount;

    const receivedB = Number(afterSwap1_TraderB - beforeSwap_TraderB);
    console.log(
      `✓ Trader1: ${swapAmountA / 10 ** 6}A -> ${receivedB / 10 ** 6}B`
    );

    // Trader2: B -> A 交换
    const swapAmountB = 200 * 10 ** 6; // 200 B
    const trader2TokenA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      trader2.publicKey,
      true
    );

    const beforeSwap2_TraderA = (await getAccount(connection, trader2TokenA))
      .amount;

    await program.methods
      .swapExactTokensForTokens(
        false, // B -> A
        new anchor.BN(swapAmountB),
        new anchor.BN(80 * 10 ** 6) // 期望至少得到80A
      )
      .accounts({
        amm: values.ammPda,
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        trader: trader2.publicKey,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        traderAccountA: trader2TokenA,
        traderAccountB: getAssociatedTokenAddressSync(
          values.mint_b.publicKey,
          trader2.publicKey,
          true
        ),
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([trader2])
      .rpc();

    const afterSwap2_TraderA = (await getAccount(connection, trader2TokenA))
      .amount;
    const finalPoolA = (await getAccount(connection, values.poolAccountA))
      .amount;
    const finalPoolB = (await getAccount(connection, values.poolAccountB))
      .amount;

    const receivedA = Number(afterSwap2_TraderA - beforeSwap2_TraderA);
    console.log(
      `✓ Trader2: ${swapAmountB / 10 ** 6}B -> ${receivedA / 10 ** 6}A`
    );
    console.log(
      `✓ Final pool after swaps: ${Number(finalPoolA) / 10 ** 6}A + ${
        Number(finalPoolB) / 10 ** 6
      }B`
    );

    // 验证不变量增加（由于手续费）
    const initialK = Number(beforeSwap_PoolA) * Number(beforeSwap_PoolB);
    const finalK = Number(finalPoolA) * Number(finalPoolB);
    expect(finalK).to.be.greaterThan(initialK);
    console.log(
      `✓ Invariant increased: ${initialK / 10 ** 18} -> ${
        finalK / 10 ** 18
      } (${(((finalK - initialK) / initialK) * 100).toFixed(2)}% increase)`
    );

    // ========= Phase 4: 部分流动性提取 =========
    console.log("\n4. Partial Liquidity Withdrawal");

    // LP1 提取一半流动性
    const lp1CurrentBalance = (
      await getAccount(
        connection,
        getAssociatedTokenAddressSync(
          values.mintLiquidity,
          liquidityProvider1.publicKey,
          true
        )
      )
    ).amount;

    const withdrawAmount = lp1CurrentBalance / BigInt(2);

    const lp1TokenA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      liquidityProvider1.publicKey,
      true
    );
    const lp1TokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      liquidityProvider1.publicKey,
      true
    );

    const beforeWithdraw_LP1_A = (await getAccount(connection, lp1TokenA))
      .amount;
    const beforeWithdraw_LP1_B = (await getAccount(connection, lp1TokenB))
      .amount;

    await program.methods
      .withdrawLiquidity(new anchor.BN(withdrawAmount.toString()))
      .accounts({
        pool: values.poolPda,
        poolAuthority: values.poolAuthority,
        mintLiquidity: values.mintLiquidity,
        mintA: values.mint_a.publicKey,
        mintB: values.mint_b.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        depositorAccountA: lp1TokenA,
        depositorAccountB: lp1TokenB,
        depositorAccountLiquidity: getAssociatedTokenAddressSync(
          values.mintLiquidity,
          liquidityProvider1.publicKey,
          true
        ),
        depositor: liquidityProvider1.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([liquidityProvider1])
      .rpc();

    const afterWithdraw_LP1_A = (await getAccount(connection, lp1TokenA))
      .amount;
    const afterWithdraw_LP1_B = (await getAccount(connection, lp1TokenB))
      .amount;
    const finalWithdrawnA = Number(afterWithdraw_LP1_A - beforeWithdraw_LP1_A);
    const finalWithdrawnB = Number(afterWithdraw_LP1_B - beforeWithdraw_LP1_B);

    console.log(
      `✓ LP1 withdrew ${finalWithdrawnA / 10 ** 6}A + ${
        finalWithdrawnB / 10 ** 6
      }B for ${Number(withdrawAmount)} LP tokens`
    );

    // 验证LP1仍有剩余LP代币
    const lp1RemainingLP = (
      await getAccount(
        connection,
        getAssociatedTokenAddressSync(
          values.mintLiquidity,
          liquidityProvider1.publicKey,
          true
        )
      )
    ).amount;
    expect(Number(lp1RemainingLP)).to.be.greaterThan(0);
    console.log(`✓ LP1 remaining LP tokens: ${Number(lp1RemainingLP)}`);

    // ========= Phase 5: 最终状态验证 =========
    console.log("\n5. Final State Verification");

    const finalState = {
      poolA: await getAccount(connection, values.poolAccountA),
      poolB: await getAccount(connection, values.poolAccountB),
      mintInfo: await getMint(connection, values.mintLiquidity),
    };

    // 验证池子仍有流动性
    expect(Number(finalState.poolA.amount)).to.be.greaterThan(0);
    expect(Number(finalState.poolB.amount)).to.be.greaterThan(0);
    expect(Number(finalState.mintInfo.supply)).to.be.greaterThan(0);

    console.log(
      `✓ Final pool liquidity: ${
        Number(finalState.poolA.amount) / 10 ** 6
      }A + ${Number(finalState.poolB.amount) / 10 ** 6}B`
    );
    console.log(
      `✓ Final LP token supply: ${Number(finalState.mintInfo.supply)}`
    );

    // 计算价格变化
    const initialPrice = 2.0; // 初始 1A = 2B
    const finalPrice =
      Number(finalState.poolB.amount) / Number(finalState.poolA.amount);
    const priceChange = ((finalPrice - initialPrice) / initialPrice) * 100;
    console.log(
      `✓ Price change: 1A = ${initialPrice}B -> 1A = ${finalPrice.toFixed(
        3
      )}B (${priceChange.toFixed(2)}% change)`
    );

    // ========= Phase 6: 验证手续费收益 =========
    console.log("\n6. Fee Revenue Verification");

    // 计算理论上的手续费收益
    const totalTradedVolume = swapAmountA + swapAmountB; // 总交易量
    const feeRate = values.fee / 10000; // 5% = 0.05
    const theoreticalFeeRevenue = totalTradedVolume * feeRate;

    console.log(`✓ Total traded volume: ${totalTradedVolume / 10 ** 6} tokens`);
    console.log(`✓ Fee rate: ${feeRate * 100}%`);
    console.log(
      `✓ Theoretical fee revenue: ${theoreticalFeeRevenue / 10 ** 6} tokens`
    );

    // 手续费体现在K值的增加中
    const kIncrease = finalK - initialK;
    const kIncreasePercentage = (kIncrease / initialK) * 100;
    console.log(
      `✓ K increase: ${kIncreasePercentage.toFixed(
        4
      )}% (fees accumulated in pool)`
    );

    console.log("\n=== ✅ Complete AMM Lifecycle Test Passed ===");
  });

  it("Multi-User Concurrent Operations", async () => {
    console.log("=== Multi-User Concurrent Operations Test ===");

    // 初始流动性
    await program.methods
      .depositLiquidity(
        new anchor.BN(2000 * 10 ** 6),
        new anchor.BN(4000 * 10 ** 6)
      )
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
          liquidityProvider1.publicKey,
          true
        ),
        depositorAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          liquidityProvider1.publicKey,
          true
        ),
        depositorAccountB: getAssociatedTokenAddressSync(
          values.mint_b.publicKey,
          liquidityProvider1.publicKey,
          true
        ),
        depositor: liquidityProvider1.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([liquidityProvider1])
      .rpc();

    const initialK =
      Number((await getAccount(connection, values.poolAccountA)).amount) *
      Number((await getAccount(connection, values.poolAccountB)).amount);

    // 模拟多用户同时操作
    const operations = [];

    // LP2 添加流动性
    operations.push(
      program.methods
        .depositLiquidity(
          new anchor.BN(300 * 10 ** 6),
          new anchor.BN(600 * 10 ** 6)
        )
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
            liquidityProvider2.publicKey,
            true
          ),
          depositorAccountA: getAssociatedTokenAddressSync(
            values.mint_a.publicKey,
            liquidityProvider2.publicKey,
            true
          ),
          depositorAccountB: getAssociatedTokenAddressSync(
            values.mint_b.publicKey,
            liquidityProvider2.publicKey,
            true
          ),
          depositor: liquidityProvider2.publicKey,
          payer: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([liquidityProvider2])
        .rpc()
    );

    // Trader1 交换 A->B
    operations.push(
      program.methods
        .swapExactTokensForTokens(
          true,
          new anchor.BN(100 * 10 ** 6),
          new anchor.BN(1)
        )
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
          traderAccountB: getAssociatedTokenAddressSync(
            values.mint_b.publicKey,
            trader1.publicKey,
            true
          ),
          payer: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([trader1])
        .rpc()
    );

    // Trader2 交换 B->A
    operations.push(
      program.methods
        .swapExactTokensForTokens(
          false,
          new anchor.BN(150 * 10 ** 6),
          new anchor.BN(1)
        )
        .accounts({
          amm: values.ammPda,
          pool: values.poolPda,
          poolAuthority: values.poolAuthority,
          trader: trader2.publicKey,
          mintA: values.mint_a.publicKey,
          mintB: values.mint_b.publicKey,
          poolAccountA: values.poolAccountA,
          poolAccountB: values.poolAccountB,
          traderAccountA: getAssociatedTokenAddressSync(
            values.mint_a.publicKey,
            trader2.publicKey,
            true
          ),
          traderAccountB: getAssociatedTokenAddressSync(
            values.mint_b.publicKey,
            trader2.publicKey,
            true
          ),
          payer: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([trader2])
        .rpc()
    );

    // 等待所有操作完成
    const results = await Promise.allSettled(operations);

    // 验证至少有一些操作成功
    const successfulOps = results.filter(
      (r) => r.status === "fulfilled"
    ).length;
    expect(successfulOps).to.be.greaterThan(0);
    console.log(
      `✓ ${successfulOps}/${operations.length} operations completed successfully`
    );

    // 验证最终状态一致性
    const finalPoolA = await getAccount(connection, values.poolAccountA);
    const finalPoolB = await getAccount(connection, values.poolAccountB);
    const finalK = Number(finalPoolA.amount) * Number(finalPoolB.amount);

    expect(Number(finalPoolA.amount)).to.be.greaterThan(0);
    expect(Number(finalPoolB.amount)).to.be.greaterThan(0);
    expect(finalK).to.be.greaterThanOrEqual(initialK); // K值应该保持或增加

    console.log(
      `✓ Final pool state: ${Number(finalPoolA.amount) / 10 ** 6}A + ${
        Number(finalPoolB.amount) / 10 ** 6
      }B`
    );
    console.log(
      `✓ K invariant maintained: ${initialK / 10 ** 18} -> ${finalK / 10 ** 18}`
    );

    console.log("=== ✅ Multi-User Concurrent Operations Test Passed ===");
  });

  it("Stress Test: Multiple Sequential Operations", async () => {
    console.log("=== Stress Test: Multiple Sequential Operations ===");

    // 初始大量流动性
    await program.methods
      .depositLiquidity(
        new anchor.BN(5000 * 10 ** 6),
        new anchor.BN(10000 * 10 ** 6)
      )
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
          liquidityProvider1.publicKey,
          true
        ),
        depositorAccountA: getAssociatedTokenAddressSync(
          values.mint_a.publicKey,
          liquidityProvider1.publicKey,
          true
        ),
        depositorAccountB: getAssociatedTokenAddressSync(
          values.mint_b.publicKey,
          liquidityProvider1.publicKey,
          true
        ),
        depositor: liquidityProvider1.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([liquidityProvider1])
      .rpc();

    let currentK =
      Number((await getAccount(connection, values.poolAccountA)).amount) *
      Number((await getAccount(connection, values.poolAccountB)).amount);

    // 执行10轮连续操作
    for (let round = 1; round <= 10; round++) {
      console.log(`Round ${round}:`);

      // 随机交换方向
      const swapA = round % 2 === 1;
      const swapAmount = 50 * 10 ** 6; // 每次50个代币

      const trader = round % 2 === 1 ? trader1 : trader2;

      await program.methods
        .swapExactTokensForTokens(
          swapA,
          new anchor.BN(swapAmount),
          new anchor.BN(1)
        )
        .accounts({
          amm: values.ammPda,
          pool: values.poolPda,
          poolAuthority: values.poolAuthority,
          trader: trader.publicKey,
          mintA: values.mint_a.publicKey,
          mintB: values.mint_b.publicKey,
          poolAccountA: values.poolAccountA,
          poolAccountB: values.poolAccountB,
          traderAccountA: getAssociatedTokenAddressSync(
            values.mint_a.publicKey,
            trader.publicKey,
            true
          ),
          traderAccountB: getAssociatedTokenAddressSync(
            values.mint_b.publicKey,
            trader.publicKey,
            true
          ),
          payer: provider.wallet.publicKey,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .signers([trader])
        .rpc();

      // 验证每轮后的不变量
      const poolA = await getAccount(connection, values.poolAccountA);
      const poolB = await getAccount(connection, values.poolAccountB);
      const newK = Number(poolA.amount) * Number(poolB.amount);

      expect(newK).to.be.greaterThanOrEqual(currentK);

      const kIncrease = ((newK - currentK) / currentK) * 100;
      console.log(
        `  ✓ ${swapA ? "A->B" : "B->A"} swap, K: ${currentK / 10 ** 18} -> ${
          newK / 10 ** 18
        } (+${kIncrease.toFixed(4)}%)`
      );

      currentK = newK;
    }

    // 最终验证
    const finalPoolA = await getAccount(connection, values.poolAccountA);
    const finalPoolB = await getAccount(connection, values.poolAccountB);

    expect(Number(finalPoolA.amount)).to.be.greaterThan(0);
    expect(Number(finalPoolB.amount)).to.be.greaterThan(0);

    console.log(
      `✓ Stress test completed: Pool has ${
        Number(finalPoolA.amount) / 10 ** 6
      }A + ${Number(finalPoolB.amount) / 10 ** 6}B`
    );
    console.log("=== ✅ Stress Test Passed ===");
  });
});
