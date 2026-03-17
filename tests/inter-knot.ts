import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { InterKnot } from "../target/types/inter_knot";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import * as crypto from "crypto";

describe("inter-knot", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.interKnot as Program<InterKnot>;
  const authority = provider.wallet;

  // Devnet USDC mint (for testing we just use a random pubkey)
  const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("inter_knot_config")],
    program.programId
  );

  describe("initialize", () => {
    it("initializes the platform config", async () => {
      const tx = await program.methods
        .initialize(usdcMint)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Initialize tx:", tx);

      const config = await program.account.platformConfig.fetch(configPda);
      expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(config.commissionCount.toNumber()).to.equal(0);
      expect(config.usdcMint.toBase58()).to.equal(usdcMint.toBase58());
      expect(config.platformFeeBps).to.equal(0);
    });

    it("fails to initialize twice", async () => {
      try {
        await program.methods
          .initialize(usdcMint)
          .accounts({
            authority: authority.publicKey,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err) {
        // Expected: PDA already exists
        expect(err).to.exist;
      }
    });
  });

  describe("create_commission", () => {
    const taskType = "compute/llm-inference";
    const taskSpec = JSON.stringify({
      type: "compute/llm-inference",
      version: "0.1.0",
      spec: { model: "llama-3-8b", maxTokens: 1024 },
    });
    const taskSpecHash = Array.from(
      crypto.createHash("sha256").update(taskSpec).digest()
    );
    const taskSpecUri = "https://example.com/task-spec.json";
    const maxPrice = new BN(500_000); // 0.50 USDC
    // Deadline: 5 minutes from now
    const deadline = new BN(Math.floor(Date.now() / 1000) + 300);

    it("creates a commission", async () => {
      // Commission ID will be 0 (first one)
      const commissionId = new BN(0);
      const [commissionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("commission"), commissionId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const tx = await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, deadline)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: commissionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Create commission tx:", tx);

      const commission = await program.account.commission.fetch(commissionPda);
      expect(commission.commissionId.toNumber()).to.equal(0);
      expect(commission.delegator.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(commission.taskType).to.equal(taskType);
      expect(commission.taskSpecUri).to.equal(taskSpecUri);
      expect(commission.maxPrice.toNumber()).to.equal(500_000);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ open: {} }));
      expect(commission.selectedExecutor).to.be.null;
      expect(commission.selectedBidPrice).to.be.null;
      expect(commission.bidCount).to.equal(0);

      // Verify config.commission_count incremented
      const config = await program.account.platformConfig.fetch(configPda);
      expect(config.commissionCount.toNumber()).to.equal(1);
    });

    it("creates a second commission with incremented ID", async () => {
      const commissionId = new BN(1);
      const [commissionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("commission"), commissionId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const tx = await program.methods
        .createCommission(
          taskType,
          taskSpecHash,
          "https://example.com/task-spec-2.json",
          new BN(1_000_000), // 1 USDC
          deadline
        )
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: commissionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Create commission #2 tx:", tx);

      const commission = await program.account.commission.fetch(commissionPda);
      expect(commission.commissionId.toNumber()).to.equal(1);

      const config = await program.account.platformConfig.fetch(configPda);
      expect(config.commissionCount.toNumber()).to.equal(2);
    });

    it("fails with zero max_price", async () => {
      const commissionId = new BN(2);
      const [commissionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("commission"), commissionId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      try {
        await program.methods
          .createCommission(taskType, taskSpecHash, taskSpecUri, new BN(0), deadline)
          .accounts({
            delegator: authority.publicKey,
            config: configPda,
            commission: commissionPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("PriceZero");
      }
    });

    it("fails with past deadline", async () => {
      const commissionId = new BN(2);
      const [commissionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("commission"), commissionId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const pastDeadline = new BN(Math.floor(Date.now() / 1000) - 100);

      try {
        await program.methods
          .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, pastDeadline)
          .accounts({
            delegator: authority.publicKey,
            config: configPda,
            commission: commissionPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("DeadlineNotFuture");
      }
    });

    it("fails with task type too long", async () => {
      const commissionId = new BN(2);
      const [commissionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("commission"), commissionId.toArrayLike(Buffer, "le", 8)],
        program.programId
      );

      const longTaskType = "a".repeat(33);

      try {
        await program.methods
          .createCommission(longTaskType, taskSpecHash, taskSpecUri, maxPrice, deadline)
          .accounts({
            delegator: authority.publicKey,
            config: configPda,
            commission: commissionPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("TaskTypeTooLong");
      }
    });
  });
});
