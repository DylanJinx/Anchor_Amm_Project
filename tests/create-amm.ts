import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { MyAmmProject } from "../target/types/my_amm_project";
import { type TestValues, createTestValues, expectRevert } from "./utils";

describe("Create AMM", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;

  let values: TestValues;

  beforeEach(() => {
    values = createTestValues();
  });

  it("Success create AMM", async () => {
    await program.methods
      .createAmm(values.id, values.fee)
      .accounts({
        amm: values.ammPda,
        admin: values.admin.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      } as any)
      .rpc();

    const ammAccount = await program.account.amm.fetch(values.ammPda);
    expect(ammAccount.admin.toString()).to.equal(
      values.admin.publicKey.toString()
    );
    expect(ammAccount.fee).to.equal(values.fee);
    expect(ammAccount.id.toString()).to.equal(values.id.toString());
  });

  it("Invalid fee", async () => {
    values.fee = 100000;

    await expectRevert(
      program.methods
        .createAmm(values.id, values.fee)
        .accounts({
          amm: values.ammPda,
          admin: values.admin.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        } as any)
        .rpc()
    );
  });
});
