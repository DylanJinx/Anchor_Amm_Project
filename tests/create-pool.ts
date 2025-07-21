import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import {
  type Connection,
  Keypair,
  PublicKey,
  type Signer,
} from "@solana/web3.js";
import { expect } from "chai";
import { MyAmmProject } from "../target/types/my_amm_project";
import {
  type TestValues,
  createTestValues,
  expectRevert,
  mintingTokens,
} from "./utils";

describe("Create Pool", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  anchor.setProvider(provider);

  const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;

  let values: TestValues;

  beforeEach(async () => {
    // setup1 生成测试数据
    values = createTestValues();

    // setup2 创建amm
    await program.methods
      .createAmm(values.id, values.fee)
      .accounts({
        amm: values.ammPda,
        admin: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    await mintingTokens({
      connection,
      creator: values.admin,
      holder: values.admin,
      mint_a: values.mint_a,
      mint_b: values.mint_b,
      mintedAmount: 100,
      decimals: 6,
    });
  });

  it("Success create Pool", async () => {
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

    const poolAccount = await program.account.pool.fetch(values.poolPda);
    expect(poolAccount.amm.toString()).to.equal(values.ammPda.toString());
    expect(poolAccount.mintA.toString()).to.equal(
      values.mint_a.publicKey.toString()
    );
    expect(poolAccount.mintB.toString()).to.equal(
      values.mint_b.publicKey.toString()
    );
  });

  it("Invalid mints", async () => {
    (values.mint_b = values.mint_a),
      (values.poolPda = PublicKey.findProgramAddressSync(
        [
          values.id.toBuffer(),
          values.mint_a.publicKey.toBuffer(),
          values.mint_b.publicKey.toBuffer(),
        ],
        anchor.workspace.MyAmmProject.programId
      )[0]);

    values.poolAuthority = PublicKey.findProgramAddressSync(
      [
        values.id.toBuffer(),
        values.mint_a.publicKey.toBuffer(),
        values.mint_b.publicKey.toBuffer(),
        Buffer.from("authority"),
      ],
      anchor.workspace.MyAmmProject.programId
    )[0];

    await expectRevert(
      program.methods
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
        } as any)
        .rpc()
    );
  });
});
