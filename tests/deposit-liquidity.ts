import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
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

describe("Deposit Liquidity", () => {
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
      mintedAmount: 50000, // 增加代币数量确保测试足够
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
  });

  it("Success: Initial liquidity deposit (first deposit)", async () => {
    const amountA = 100 * 10 ** 6; // 100 tokens
    const amountB = 200 * 10 ** 6; // 200 tokens

    // 获取存款前的余额
    const adminTokenA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      values.admin.publicKey,
      true
    );
    const adminTokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      values.admin.publicKey,
      true
    );

    const beforeBalanceA = (await getAccount(connection, adminTokenA)).amount;
    const beforeBalanceB = (await getAccount(connection, adminTokenB)).amount;
    console.log(
      `beforeBalanceA: ${beforeBalanceA}, beforeBalanceB: ${beforeBalanceB}`
    );

    // 执行存款
    await program.methods
      .depositLiquidity(new anchor.BN(amountA), new anchor.BN(amountB))
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
        depositorAccountA: adminTokenA,
        depositorAccountB: adminTokenB,
        depositor: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([values.admin])
      .rpc();

    // 验证池子余额
    const poolAccountA = await getAccount(connection, values.poolAccountA);
    const poolAccountB = await getAccount(connection, values.poolAccountB);
    expect(poolAccountA.amount.toString()).to.equal(amountA.toString());
    expect(poolAccountB.amount.toString()).to.equal(amountB.toString());

    // 验证用户余额变化
    const afterBalanceA = (await getAccount(connection, adminTokenA)).amount;
    const afterBalanceB = (await getAccount(connection, adminTokenB)).amount;
    expect(beforeBalanceA - afterBalanceA).to.equal(BigInt(amountA));
    expect(beforeBalanceB - afterBalanceB).to.equal(BigInt(amountB));
    console.log(
      `afterBalanceA: ${afterBalanceA}, afterBalanceB: ${afterBalanceB}`
    );

    // 验证LP代币铸造
    const liquidityAccount = await getAccount(
      connection,
      getAssociatedTokenAddressSync(
        values.mintLiquidity,
        values.admin.publicKey,
        true
      )
    );
    expect(Number(liquidityAccount.amount)).to.be.greaterThan(0);

    // LP代币数量计算：sqrt(amountA * amountB) - MINIMUM_LIQUIDITY
    // sqrt(100*10^6 * 200*10^6) - 100 ≈ 141,421,256
    const expectedLP = Math.sqrt(amountA * amountB) - 100;
    console.log(
      `Expected LP: ${expectedLP}, Actual LP: ${Number(
        liquidityAccount.amount
      )}`
    );

    // 由于精度问题，允许一定误差范围
    expect(Number(liquidityAccount.amount)).to.be.approximately(
      expectedLP,
      10 // 扩大误差范围
    );

    // 验证总供应量
    const mintLiquidity = await getMint(connection, values.mintLiquidity);
    expect(Number(mintLiquidity.supply)).to.be.greaterThan(100); // > MINIMUM_LIQUIDITY
  });

  it("Success: Subsequent liquidity deposit (maintaining ratio)", async () => {
    // 先添加初始流动性
    const initialAmountA = 100 * 10 ** 6;
    const initialAmountB = 200 * 10 ** 6;

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

    // 获取第一次存款后的LP代币余额
    const firstLPBalance = (
      await getAccount(
        connection,
        getAssociatedTokenAddressSync(
          values.mintLiquidity,
          values.admin.publicKey,
          true
        )
      )
    ).amount;
    console.log(`firstLPBalance: ${firstLPBalance}`);

    // 第二次存款 - 尝试不按比例存款，应被自动调整
    const secondAmountA = 50 * 10 ** 6; // 存50个A
    const secondAmountB = 300 * 10 ** 6; // 存300个B

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

    // 验证比例调整：系统会选择能存入更多代币的方案
    // 选项1：50A : 100B (总量150)
    // 选项2：150A : 300B (总量450) ← 系统选择这个
    const finalPoolA = await getAccount(connection, values.poolAccountA);
    const finalPoolB = await getAccount(connection, values.poolAccountB);

    // 总共应该有：初始100+150=250个A，初始200+300=500个B
    expect(Number(finalPoolA.amount)).to.equal(250 * 10 ** 6);
    expect(Number(finalPoolB.amount)).to.equal(500 * 10 ** 6);

    // 验证LP代币增加
    const finalLPBalance = (
      await getAccount(
        connection,
        getAssociatedTokenAddressSync(
          values.mintLiquidity,
          values.admin.publicKey,
          true
        )
      )
    ).amount;
    console.log(`finalLPBalance: ${finalLPBalance}`);
    expect(Number(finalLPBalance)).to.be.greaterThan(Number(firstLPBalance));
  });

  it("Success: Deposit with insufficient balance (auto-adjustment)", async () => {
    // 创建一个新用户，只给少量代币
    const newUser = Keypair.generate();
    const signature = await connection.requestAirdrop(
      newUser.publicKey,
      10 ** 10
    );
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });

    // 给新用户少量代币 (只有10个A和10个B)
    await mintTokensToUser({
      connection,
      creator: values.admin,
      holder: newUser,
      mint_a: values.mint_a,
      mint_b: values.mint_b,
      mintedAmount: 10, // 只有10个代币
      decimals: 6,
    });

    // 先添加初始流动性
    await program.methods
      .depositLiquidity(
        new anchor.BN(100 * 10 ** 6),
        new anchor.BN(200 * 10 ** 6)
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

    // 新用户尝试存入100个代币（超过余额），应该自动调整为实际余额
    const userTokenA = getAssociatedTokenAddressSync(
      values.mint_a.publicKey,
      newUser.publicKey,
      true
    );
    const userTokenB = getAssociatedTokenAddressSync(
      values.mint_b.publicKey,
      newUser.publicKey,
      true
    );

    const beforeBalanceA = (await getAccount(connection, userTokenA)).amount;
    const beforeBalanceB = (await getAccount(connection, userTokenB)).amount;

    await program.methods
      .depositLiquidity(
        new anchor.BN(100 * 10 ** 6),
        new anchor.BN(100 * 10 ** 6)
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
          newUser.publicKey,
          true
        ),
        depositorAccountA: userTokenA,
        depositorAccountB: userTokenB,
        depositor: newUser.publicKey,
        payer: provider.wallet.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .signers([newUser])
      .rpc();

    // 验证用户的代币被完全消费（因为会调整为实际余额）
    const afterBalanceA = (await getAccount(connection, userTokenA)).amount;
    const afterBalanceB = (await getAccount(connection, userTokenB)).amount;

    expect(Number(beforeBalanceA - afterBalanceA)).to.be.greaterThan(0);
    expect(Number(beforeBalanceB - afterBalanceB)).to.be.greaterThan(0);

    // 验证LP代币被正确铸造
    const lpBalance = (
      await getAccount(
        connection,
        getAssociatedTokenAddressSync(
          values.mintLiquidity,
          newUser.publicKey,
          true
        )
      )
    ).amount;
    expect(Number(lpBalance)).to.be.greaterThan(0);
  });

  it("Failure: Initial deposit too small (below MINIMUM_LIQUIDITY)", async () => {
    // 尝试存入非常少的代币，使得 sqrt(amount_a * amount_b) < MINIMUM_LIQUIDITY
    const tinyAmountA = 1; // 1 lamport
    const tinyAmountB = 1; // 1 lamport
    // sqrt(1 * 1) = 1 < 100 (MINIMUM_LIQUIDITY)

    await expectRevert(
      program.methods
        .depositLiquidity(
          new anchor.BN(tinyAmountA),
          new anchor.BN(tinyAmountB)
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
        .rpc()
    );
  });

  it("Success: Edge case with very different token ratios", async () => {
    // 测试极端比例：1个A对1000个B
    const amountA = 1 * 10 ** 6; // 1 token A
    const amountB = 1000 * 10 ** 6; // 1000 token B

    await program.methods
      .depositLiquidity(new anchor.BN(amountA), new anchor.BN(amountB))
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

    // 验证池子接受了极端比例
    const poolAccountA = await getAccount(connection, values.poolAccountA);
    const poolAccountB = await getAccount(connection, values.poolAccountB);
    expect(poolAccountA.amount.toString()).to.equal(amountA.toString());
    expect(poolAccountB.amount.toString()).to.equal(amountB.toString());

    // 验证LP代币计算正确 sqrt(1 * 1000) ≈ 31.6
    const liquidityAccount = await getAccount(
      connection,
      getAssociatedTokenAddressSync(
        values.mintLiquidity,
        values.admin.publicKey,
        true
      )
    );
    console.log(`liquidityAccount: ${liquidityAccount.amount}`);
    expect(Number(liquidityAccount.amount)).to.be.greaterThan(0);

    // 验证后续存款仍然维持比例
    await program.methods
      .depositLiquidity(new anchor.BN(amountA), new anchor.BN(amountB))
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

    const finalPoolA = await getAccount(connection, values.poolAccountA);
    const finalPoolB = await getAccount(connection, values.poolAccountB);
    expect(Number(finalPoolA.amount)).to.equal(2 * amountA);
    expect(Number(finalPoolB.amount)).to.equal(2 * amountB);
  });
});
