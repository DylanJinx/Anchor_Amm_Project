import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { MyAmmProject } from "../target/types/my_amm_project";

describe("my_amm_project", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  // const provider = anchor.Anchor.AnchorProvider.env();
  // anchor.setProvider(provider);

  const program = anchor.workspace.MyAmmProject as Program<MyAmmProject>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
