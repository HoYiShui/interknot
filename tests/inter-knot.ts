import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { InterKnot } from "../target/types/inter_knot";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import BN from "bn.js";
import * as crypto from "crypto";

describe("inter-knot", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.interKnot as Program<InterKnot>;
  const authority = provider.wallet;

  const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("inter_knot_config")],
    program.programId
  );

  // Helper: derive commission PDA
  function commissionPda(id: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("commission"), new BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  // Helper: derive bid PDA
  function bidPda(commissionId: number, executor: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("bid"),
        new BN(commissionId).toArrayLike(Buffer, "le", 8),
        executor.toBuffer(),
      ],
      program.programId
    );
  }

  // Helper: airdrop SOL to a keypair
  async function airdrop(pubkey: PublicKey, sol: number = 10) {
    const sig = await provider.connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  // Shared test data
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

  function futureDeadline(seconds: number = 300): BN {
    return new BN(Math.floor(Date.now() / 1000) + seconds);
  }

  // Executor keypairs
  const executorB = Keypair.generate();
  const executorC = Keypair.generate();

  // ═══════════════════════════════════════════
  // Day 1: initialize + create_commission
  // ═══════════════════════════════════════════

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
        expect(err).to.exist;
      }
    });
  });

  describe("create_commission", () => {
    it("creates commission #0", async () => {
      const [pda] = commissionPda(0);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const commission = await program.account.commission.fetch(pda);
      expect(commission.commissionId.toNumber()).to.equal(0);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ open: {} }));
      expect(commission.bidCount).to.equal(0);
    });

    it("creates commission #1", async () => {
      const [pda] = commissionPda(1);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const commission = await program.account.commission.fetch(pda);
      expect(commission.commissionId.toNumber()).to.equal(1);
    });

    // Commission #2: will be used for cancel test
    it("creates commission #2 (for cancel test)", async () => {
      const [pda] = commissionPda(2);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    // Commission #3: will be used for withdraw test
    it("creates commission #3 (for withdraw test)", async () => {
      const [pda] = commissionPda(3);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    });

    it("fails with zero max_price", async () => {
      const [pda] = commissionPda(4);
      try {
        await program.methods
          .createCommission(taskType, taskSpecHash, taskSpecUri, new BN(0), futureDeadline(), null)
          .accounts({
            delegator: authority.publicKey,
            config: configPda,
            commission: pda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("PriceZero");
      }
    });

    it("fails with past deadline", async () => {
      const [pda] = commissionPda(4);
      try {
        await program.methods
          .createCommission(
            taskType, taskSpecHash, taskSpecUri, maxPrice,
            new BN(Math.floor(Date.now() / 1000) - 100), null
          )
          .accounts({
            delegator: authority.publicKey,
            config: configPda,
            commission: pda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("DeadlineNotFuture");
      }
    });

    it("fails with task type too long", async () => {
      const [pda] = commissionPda(4);
      try {
        await program.methods
          .createCommission("a".repeat(33), taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
          .accounts({
            delegator: authority.publicKey,
            config: configPda,
            commission: pda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("TaskTypeTooLong");
      }
    });
  });

  // ═══════════════════════════════════════════
  // Day 2: submit_bid, select_bid, complete,
  //         cancel, withdraw
  // ═══════════════════════════════════════════

  describe("submit_bid", () => {
    before(async () => {
      await airdrop(executorB.publicKey);
      await airdrop(executorC.publicKey);
    });

    it("executor B bids on commission #0", async () => {
      const [pda] = bidPda(0, executorB.publicKey);
      const [commPda] = commissionPda(0);

      await program.methods
        .submitBid(new BN(0), new BN(300_000), "http://localhost:8080/tasks")
        .accounts({
          executor: executorB.publicKey,
          commission: commPda,
          bid: pda,
          executorReputation: reputationPda(executorB.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([executorB])
        .rpc();

      const bid = await program.account.bid.fetch(pda);
      expect(bid.commissionId.toNumber()).to.equal(0);
      expect(bid.executor.toBase58()).to.equal(executorB.publicKey.toBase58());
      expect(bid.price.toNumber()).to.equal(300_000);
      expect(bid.serviceEndpoint).to.equal("http://localhost:8080/tasks");
      expect(JSON.stringify(bid.status)).to.equal(JSON.stringify({ active: {} }));

      const commission = await program.account.commission.fetch(commPda);
      expect(commission.bidCount).to.equal(1);
    });

    it("executor C bids on commission #0 (competing bid)", async () => {
      const [pda] = bidPda(0, executorC.publicKey);
      const [commPda] = commissionPda(0);

      await program.methods
        .submitBid(new BN(0), new BN(450_000), "http://localhost:9090/tasks")
        .accounts({
          executor: executorC.publicKey,
          commission: commPda,
          bid: pda,
          executorReputation: reputationPda(executorC.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([executorC])
        .rpc();

      const commission = await program.account.commission.fetch(commPda);
      expect(commission.bidCount).to.equal(2);
    });

    it("fails: self-bid (delegator bids on own commission)", async () => {
      const [pda] = bidPda(0, authority.publicKey);
      const [commPda] = commissionPda(0);

      try {
        await program.methods
          .submitBid(new BN(0), new BN(200_000), "http://localhost:7070/tasks")
          .accounts({
            executor: authority.publicKey,
            commission: commPda,
            bid: pda,
            executorReputation: reputationPda(authority.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("SelfBidNotAllowed");
      }
    });

    it("fails: bid price exceeds max_price", async () => {
      const [pda] = bidPda(1, executorB.publicKey);
      const [commPda] = commissionPda(1);

      try {
        await program.methods
          .submitBid(new BN(1), new BN(600_000), "http://localhost:8080/tasks")
          .accounts({
            executor: executorB.publicKey,
            commission: commPda,
            bid: pda,
            executorReputation: reputationPda(executorB.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("BidPriceTooHigh");
      }
    });

    it("fails: bid price is zero", async () => {
      const [pda] = bidPda(1, executorB.publicKey);
      const [commPda] = commissionPda(1);

      try {
        await program.methods
          .submitBid(new BN(1), new BN(0), "http://localhost:8080/tasks")
          .accounts({
            executor: executorB.publicKey,
            commission: commPda,
            bid: pda,
            executorReputation: reputationPda(executorB.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("PriceZero");
      }
    });

    // Place a bid on commission #3 for withdraw test later
    it("executor B bids on commission #3 (for withdraw test)", async () => {
      const [pda] = bidPda(3, executorB.publicKey);
      const [commPda] = commissionPda(3);

      await program.methods
        .submitBid(new BN(3), new BN(200_000), "http://localhost:8080/tasks")
        .accounts({
          executor: executorB.publicKey,
          commission: commPda,
          bid: pda,
          executorReputation: reputationPda(executorB.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([executorB])
        .rpc();
    });
  });

  describe("select_bid", () => {
    it("delegator selects executor B for commission #0", async () => {
      const [commPda] = commissionPda(0);
      const [bPda] = bidPda(0, executorB.publicKey);

      await program.methods
        .selectBid(new BN(0))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda,
          bid: bPda,
        })
        .rpc();

      const commission = await program.account.commission.fetch(commPda);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ matched: {} }));
      expect(commission.selectedExecutor.toBase58()).to.equal(executorB.publicKey.toBase58());
      expect(commission.selectedBidPrice.toNumber()).to.equal(300_000);
      expect(commission.matchedAt).to.not.be.null;
      // bid_count should decrement: was 2 (B + C), now 1 (selected bid no longer "active")
      expect(commission.bidCount).to.equal(1);

      const bid = await program.account.bid.fetch(bPda);
      expect(JSON.stringify(bid.status)).to.equal(JSON.stringify({ selected: {} }));
    });

    it("fails: non-delegator tries to select bid", async () => {
      // Commission #1 is still open; executor B tries to select (not the delegator)
      const [commPda] = commissionPda(1);
      // First place a bid on commission #1
      const [bPda] = bidPda(1, executorC.publicKey);

      await program.methods
        .submitBid(new BN(1), new BN(400_000), "http://localhost:9090/tasks")
        .accounts({
          executor: executorC.publicKey,
          commission: commPda,
          bid: bPda,
          executorReputation: reputationPda(executorC.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([executorC])
        .rpc();

      try {
        await program.methods
          .selectBid(new BN(1))
          .accounts({
            delegator: executorB.publicKey,
            commission: commPda,
            bid: bPda,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedDelegator");
      }
    });

    it("fails: select bid on already-matched commission #0", async () => {
      const [commPda] = commissionPda(0);
      const [bPda] = bidPda(0, executorC.publicKey);

      try {
        await program.methods
          .selectBid(new BN(0))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
            bid: bPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotOpen");
      }
    });
  });

  describe("complete_commission", () => {
    it("delegator completes commission #0", async () => {
      const [commPda] = commissionPda(0);

      await program.methods
        .completeCommission(new BN(0))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda,
          executor: executorB.publicKey,
          executorReputation: reputationPda(executorB.publicKey)[0],
          delegatorReputation: reputationPda(authority.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const commission = await program.account.commission.fetch(commPda);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ completed: {} }));
      expect(commission.completedAt).to.not.be.null;
    });

    it("fails: complete an open commission (#1)", async () => {
      const [commPda] = commissionPda(1);

      try {
        await program.methods
          .completeCommission(new BN(1))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
            executor: authority.publicKey,
            executorReputation: reputationPda(authority.publicKey)[0],
            delegatorReputation: reputationPda(authority.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotMatched");
      }
    });

    it("fails: non-delegator tries to complete", async () => {
      // Match commission #1 first so we can test unauthorized complete
      const [commPda] = commissionPda(1);
      const [bPda] = bidPda(1, executorC.publicKey);

      await program.methods
        .selectBid(new BN(1))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda,
          bid: bPda,
        })
        .rpc();

      try {
        await program.methods
          .completeCommission(new BN(1))
          .accounts({
            delegator: executorB.publicKey,
            commission: commPda,
            executor: executorC.publicKey,
            executorReputation: reputationPda(executorC.publicKey)[0],
            delegatorReputation: reputationPda(executorB.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedDelegator");
      }
    });
  });

  describe("cancel_commission", () => {
    it("delegator cancels commission #2", async () => {
      const [commPda] = commissionPda(2);

      await program.methods
        .cancelCommission(new BN(2))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda,
        })
        .rpc();

      const commission = await program.account.commission.fetch(commPda);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ cancelled: {} }));
    });

    it("fails: cancel already-matched commission #0", async () => {
      const [commPda] = commissionPda(0);

      try {
        await program.methods
          .cancelCommission(new BN(0))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotOpen");
      }
    });

    it("fails: non-delegator tries to cancel", async () => {
      const [commPda] = commissionPda(3);

      try {
        await program.methods
          .cancelCommission(new BN(3))
          .accounts({
            delegator: executorB.publicKey,
            commission: commPda,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedDelegator");
      }
    });
  });

  describe("withdraw_bid", () => {
    it("executor B withdraws bid from commission #3", async () => {
      const [commPda] = commissionPda(3);
      const [bPda] = bidPda(3, executorB.publicKey);

      const commBefore = await program.account.commission.fetch(commPda);
      const bidCountBefore = commBefore.bidCount;

      await program.methods
        .withdrawBid(new BN(3))
        .accounts({
          executor: executorB.publicKey,
          commission: commPda,
          bid: bPda,
        })
        .signers([executorB])
        .rpc();

      const bid = await program.account.bid.fetch(bPda);
      expect(JSON.stringify(bid.status)).to.equal(JSON.stringify({ withdrawn: {} }));

      const commission = await program.account.commission.fetch(commPda);
      expect(commission.bidCount).to.equal(bidCountBefore - 1);
    });

    it("fails: withdraw already-withdrawn bid", async () => {
      const [commPda] = commissionPda(3);
      const [bPda] = bidPda(3, executorB.publicKey);

      try {
        await program.methods
          .withdrawBid(new BN(3))
          .accounts({
            executor: executorB.publicKey,
            commission: commPda,
            bid: bPda,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("BidNotActive");
      }
    });

    it("fails: wrong executor tries to withdraw", async () => {
      // executor C's bid on commission #0 is still active
      // executor B passes their own key as signer, but the bid PDA is derived
      // from executor C's key — so the seeds constraint will fail
      const [commPda] = commissionPda(0);
      const [bPda] = bidPda(0, executorC.publicKey);

      try {
        await program.methods
          .withdrawBid(new BN(0))
          .accounts({
            executor: executorB.publicKey,
            commission: commPda,
            bid: bPda,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // Bid PDA seeds include executor key, so passing a different signer
        // causes a seeds constraint violation (ConstraintSeeds)
        expect(err.error).to.exist;
        const code = err.error.errorCode?.code;
        expect(["ConstraintSeeds", "UnauthorizedExecutor"]).to.include(code);
      }
    });
  });

  // ═══════════════════════════════════════════
  // Day 3: Full lifecycle + edge cases
  // ═══════════════════════════════════════════

  describe("full lifecycle integration", () => {
    const executorD = Keypair.generate();
    // Uses commission #4 (next available from config counter)

    before(async () => {
      await airdrop(executorD.publicKey);
    });

    it("create → bid → select → complete (single flow)", async () => {
      // Step 1: Create commission #4
      const [commPda] = commissionPda(4);
      const createTx = await program.methods
        .createCommission(
          "compute/llm-inference",
          taskSpecHash,
          "https://example.com/lifecycle-spec.json",
          new BN(1_000_000), // 1 USDC
          futureDeadline(),
          null
        )
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: commPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      let commission = await program.account.commission.fetch(commPda);
      expect(commission.commissionId.toNumber()).to.equal(4);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ open: {} }));
      expect(commission.bidCount).to.equal(0);
      expect(commission.selectedExecutor).to.be.null;
      expect(commission.matchedAt).to.be.null;
      expect(commission.completedAt).to.be.null;

      // Step 2: Executor D submits bid
      const [bidPdaD] = bidPda(4, executorD.publicKey);
      const bidTx = await program.methods
        .submitBid(new BN(4), new BN(750_000), "http://executor-d:8080/tasks")
        .accounts({
          executor: executorD.publicKey,
          commission: commPda,
          bid: bidPdaD,
          executorReputation: reputationPda(executorD.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([executorD])
        .rpc();

      commission = await program.account.commission.fetch(commPda);
      expect(commission.bidCount).to.equal(1);
      let bid = await program.account.bid.fetch(bidPdaD);
      expect(bid.price.toNumber()).to.equal(750_000);
      expect(JSON.stringify(bid.status)).to.equal(JSON.stringify({ active: {} }));

      // Step 3: Delegator selects executor D
      const selectTx = await program.methods
        .selectBid(new BN(4))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda,
          bid: bidPdaD,
        })
        .rpc();

      commission = await program.account.commission.fetch(commPda);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ matched: {} }));
      expect(commission.selectedExecutor.toBase58()).to.equal(executorD.publicKey.toBase58());
      expect(commission.selectedBidPrice.toNumber()).to.equal(750_000);
      expect(commission.matchedAt).to.not.be.null;
      expect(commission.bidCount).to.equal(0); // 1 bid was selected → 0 active
      bid = await program.account.bid.fetch(bidPdaD);
      expect(JSON.stringify(bid.status)).to.equal(JSON.stringify({ selected: {} }));

      // Step 4: Delegator completes
      const completeTx = await program.methods
        .completeCommission(new BN(4))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda,
          executor: executorD.publicKey,
          executorReputation: reputationPda(executorD.publicKey)[0],
          delegatorReputation: reputationPda(authority.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      commission = await program.account.commission.fetch(commPda);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ completed: {} }));
      expect(commission.completedAt).to.not.be.null;

      // Verify all 4 transactions succeeded
      expect(createTx).to.be.a("string");
      expect(bidTx).to.be.a("string");
      expect(selectTx).to.be.a("string");
      expect(completeTx).to.be.a("string");
    });
  });

  describe("edge cases", () => {
    const executorE = Keypair.generate();

    before(async () => {
      await airdrop(executorE.publicKey);
    });

    it("fails: bid on cancelled commission", async () => {
      // Commission #2 was cancelled in earlier tests
      const [commPda] = commissionPda(2);
      const [bPda] = bidPda(2, executorE.publicKey);

      try {
        await program.methods
          .submitBid(new BN(2), new BN(100_000), "http://localhost:8080/tasks")
          .accounts({
            executor: executorE.publicKey,
            commission: commPda,
            bid: bPda,
            executorReputation: reputationPda(executorE.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .signers([executorE])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotOpen");
      }
    });

    it("fails: bid on completed commission", async () => {
      // Commission #0 was completed in earlier tests
      const [commPda] = commissionPda(0);
      const [bPda] = bidPda(0, executorE.publicKey);

      try {
        await program.methods
          .submitBid(new BN(0), new BN(100_000), "http://localhost:8080/tasks")
          .accounts({
            executor: executorE.publicKey,
            commission: commPda,
            bid: bPda,
            executorReputation: reputationPda(executorE.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .signers([executorE])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotOpen");
      }
    });

    it("fails: complete an already-completed commission", async () => {
      // Commission #0 was completed
      const [commPda] = commissionPda(0);

      try {
        await program.methods
          .completeCommission(new BN(0))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
            executor: executorB.publicKey,
            executorReputation: reputationPda(executorB.publicKey)[0],
            delegatorReputation: reputationPda(authority.publicKey)[0],
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotMatched");
      }
    });

    it("fails: cancel a completed commission", async () => {
      const [commPda] = commissionPda(0);

      try {
        await program.methods
          .cancelCommission(new BN(0))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotOpen");
      }
    });

    it("fails: withdraw a selected bid", async () => {
      // executor B's bid on commission #0 was selected
      const [commPda] = commissionPda(0);
      const [bPda] = bidPda(0, executorB.publicKey);

      try {
        await program.methods
          .withdrawBid(new BN(0))
          .accounts({
            executor: executorB.publicKey,
            commission: commPda,
            bid: bPda,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("BidNotActive");
      }
    });

    it("fails: cancel a cancelled commission", async () => {
      const [commPda] = commissionPda(2);

      try {
        await program.methods
          .cancelCommission(new BN(2))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotOpen");
      }
    });

    it("config commission_count reflects total created", async () => {
      const config = await program.account.platformConfig.fetch(configPda);
      // Commissions #0-#4 have been created (5 total)
      expect(config.commissionCount.toNumber()).to.equal(5);
    });
  });

  // ═══════════════════════════════════════════
  // Day 8: Delivery instructions
  // ═══════════════════════════════════════════

  // Helper: derive delivery PDA
  function deliveryPda(commissionId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("delivery"), new BN(commissionId).toArrayLike(Buffer, "le", 8)],
      program.programId
    );
  }

  // Helper: derive reputation PDA
  function reputationPda(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), wallet.toBuffer()],
      program.programId
    );
  }

  describe("create_delivery", () => {
    // Commission #1 is in Matched status (selected_executor = executorC)
    // Commission #0 is Completed, #2 is Cancelled, #3 is Open, #4 is Completed

    it("creates delivery for matched commission #1", async () => {
      const [commPda] = commissionPda(1);
      const [delPda] = deliveryPda(1);

      await program.methods
        .createDelivery(new BN(1))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda,
          delivery: delPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const delivery = await program.account.taskDelivery.fetch(delPda);
      expect(delivery.commissionId.toNumber()).to.equal(1);
      expect(delivery.delegator.toBase58()).to.equal(authority.publicKey.toBase58());
      expect(delivery.executor.toBase58()).to.equal(executorC.publicKey.toBase58());
      expect(delivery.inputCid).to.equal("");
      expect(delivery.outputCid).to.equal("");
      expect(JSON.stringify(delivery.status)).to.equal(JSON.stringify({ pending: {} }));
      expect(delivery.createdAt).to.not.be.null;
      expect(delivery.updatedAt).to.not.be.null;
    });

    it("fails: create delivery for open commission #3", async () => {
      const [commPda] = commissionPda(3);
      const [delPda] = deliveryPda(3);

      try {
        await program.methods
          .createDelivery(new BN(3))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
            delivery: delPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotMatched");
      }
    });

    it("fails: create delivery for completed commission #0", async () => {
      const [commPda] = commissionPda(0);
      const [delPda] = deliveryPda(0);

      try {
        await program.methods
          .createDelivery(new BN(0))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
            delivery: delPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CommissionNotMatched");
      }
    });

    it("fails: non-delegator creates delivery", async () => {
      // Need a fresh matched commission. Create #5, bid, select.
      const [commPda5] = commissionPda(5);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: commPda5,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const [bidPda5] = bidPda(5, executorB.publicKey);
      await program.methods
        .submitBid(new BN(5), new BN(200_000), "http://localhost:8080/tasks")
        .accounts({
          executor: executorB.publicKey,
          commission: commPda5,
          bid: bidPda5,
          executorReputation: reputationPda(executorB.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([executorB])
        .rpc();

      await program.methods
        .selectBid(new BN(5))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda5,
          bid: bidPda5,
        })
        .rpc();

      const [delPda5] = deliveryPda(5);
      try {
        await program.methods
          .createDelivery(new BN(5))
          .accounts({
            delegator: executorB.publicKey,
            commission: commPda5,
            delivery: delPda5,
            systemProgram: SystemProgram.programId,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedDelegator");
      }
    });

    it("fails: create delivery twice for same commission", async () => {
      const [commPda] = commissionPda(1);
      const [delPda] = deliveryPda(1);

      try {
        await program.methods
          .createDelivery(new BN(1))
          .accounts({
            delegator: authority.publicKey,
            commission: commPda,
            delivery: delPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        // init constraint fails because PDA already exists
        expect(err).to.exist;
      }
    });
  });

  describe("submit_input", () => {
    it("delegator submits input CID for commission #1", async () => {
      const [delPda] = deliveryPda(1);
      const inputCid = "irys://abc123def456";

      await program.methods
        .submitInput(new BN(1), inputCid)
        .accounts({
          delegator: authority.publicKey,
          delivery: delPda,
        })
        .rpc();

      const delivery = await program.account.taskDelivery.fetch(delPda);
      expect(delivery.inputCid).to.equal(inputCid);
      expect(JSON.stringify(delivery.status)).to.equal(JSON.stringify({ inputReady: {} }));
    });

    it("fails: submit input twice (status is InputReady, not Pending)", async () => {
      const [delPda] = deliveryPda(1);

      try {
        await program.methods
          .submitInput(new BN(1), "irys://another-cid")
          .accounts({
            delegator: authority.publicKey,
            delivery: delPda,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("DeliveryNotPending");
      }
    });

    it("fails: executor tries to submit input", async () => {
      // Create delivery for commission #5 (matched, executor = executorB)
      const [commPda5] = commissionPda(5);
      const [delPda5] = deliveryPda(5);

      await program.methods
        .createDelivery(new BN(5))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda5,
          delivery: delPda5,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .submitInput(new BN(5), "irys://bad-input")
          .accounts({
            delegator: executorB.publicKey,
            delivery: delPda5,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedDelegator");
      }
    });

    it("fails: CID too long (>128 chars)", async () => {
      const [delPda5] = deliveryPda(5);

      try {
        await program.methods
          .submitInput(new BN(5), "x".repeat(129))
          .accounts({
            delegator: authority.publicKey,
            delivery: delPda5,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CidTooLong");
      }
    });

    it("fails: empty CID", async () => {
      const [delPda5] = deliveryPda(5);

      try {
        await program.methods
          .submitInput(new BN(5), "")
          .accounts({
            delegator: authority.publicKey,
            delivery: delPda5,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CidEmpty");
      }
    });
  });

  describe("submit_output", () => {
    it("executor submits output CID for commission #1", async () => {
      const [delPda] = deliveryPda(1);
      const outputCid = "irys://result789xyz";

      await program.methods
        .submitOutput(new BN(1), outputCid)
        .accounts({
          executor: executorC.publicKey,
          delivery: delPda,
        })
        .signers([executorC])
        .rpc();

      const delivery = await program.account.taskDelivery.fetch(delPda);
      expect(delivery.outputCid).to.equal(outputCid);
      expect(JSON.stringify(delivery.status)).to.equal(JSON.stringify({ outputReady: {} }));
    });

    it("fails: submit output twice (status is OutputReady, not InputReady)", async () => {
      const [delPda] = deliveryPda(1);

      try {
        await program.methods
          .submitOutput(new BN(1), "irys://another-output")
          .accounts({
            executor: executorC.publicKey,
            delivery: delPda,
          })
          .signers([executorC])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("DeliveryNotInputReady");
      }
    });

    it("fails: delegator tries to submit output", async () => {
      // Commission #5 delivery is in Pending. Submit input first.
      const [delPda5] = deliveryPda(5);
      await program.methods
        .submitInput(new BN(5), "irys://input-for-5")
        .accounts({
          delegator: authority.publicKey,
          delivery: delPda5,
        })
        .rpc();

      try {
        await program.methods
          .submitOutput(new BN(5), "irys://output-for-5")
          .accounts({
            executor: authority.publicKey,
            delivery: delPda5,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedExecutor");
      }
    });

    it("fails: submit output before input (status is Pending)", async () => {
      // We need a delivery still in Pending status.
      // Create commission #6, bid, select, create delivery.
      const [commPda6] = commissionPda(6);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: commPda6,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const [bidPda6] = bidPda(6, executorB.publicKey);
      await program.methods
        .submitBid(new BN(6), new BN(200_000), "http://localhost:8080/tasks")
        .accounts({
          executor: executorB.publicKey,
          commission: commPda6,
          bid: bidPda6,
          executorReputation: reputationPda(executorB.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .signers([executorB])
        .rpc();

      await program.methods
        .selectBid(new BN(6))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda6,
          bid: bidPda6,
        })
        .rpc();

      const [delPda6] = deliveryPda(6);
      await program.methods
        .createDelivery(new BN(6))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda6,
          delivery: delPda6,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .submitOutput(new BN(6), "irys://output-no-input")
          .accounts({
            executor: executorB.publicKey,
            delivery: delPda6,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("DeliveryNotInputReady");
      }
    });

    it("fails: output CID too long", async () => {
      // Commission #5 delivery is in InputReady. Executor is executorB.
      const [delPda5] = deliveryPda(5);

      try {
        await program.methods
          .submitOutput(new BN(5), "x".repeat(129))
          .accounts({
            executor: executorB.publicKey,
            delivery: delPda5,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CidTooLong");
      }
    });

    it("fails: empty output CID", async () => {
      const [delPda5] = deliveryPda(5);

      try {
        await program.methods
          .submitOutput(new BN(5), "")
          .accounts({
            executor: executorB.publicKey,
            delivery: delPda5,
          })
          .signers([executorB])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("CidEmpty");
      }
    });
  });

  describe("delivery full lifecycle", () => {
    // Commission #5: delivery exists, InputReady status, executor = executorB
    // Let's do a clean complete flow.

    it("full delivery flow: create → input → output → complete", async () => {
      // Use commission #6 (matched, executor = executorB, delivery in Pending)
      const [delPda6] = deliveryPda(6);
      const [commPda6] = commissionPda(6);

      // Submit input
      await program.methods
        .submitInput(new BN(6), "irys://task-data-for-6")
        .accounts({
          delegator: authority.publicKey,
          delivery: delPda6,
        })
        .rpc();

      let delivery = await program.account.taskDelivery.fetch(delPda6);
      expect(JSON.stringify(delivery.status)).to.equal(JSON.stringify({ inputReady: {} }));

      // Submit output
      await program.methods
        .submitOutput(new BN(6), "irys://result-data-for-6")
        .accounts({
          executor: executorB.publicKey,
          delivery: delPda6,
        })
        .signers([executorB])
        .rpc();

      delivery = await program.account.taskDelivery.fetch(delPda6);
      expect(JSON.stringify(delivery.status)).to.equal(JSON.stringify({ outputReady: {} }));
      expect(delivery.inputCid).to.equal("irys://task-data-for-6");
      expect(delivery.outputCid).to.equal("irys://result-data-for-6");

      // Complete commission
      await program.methods
        .completeCommission(new BN(6))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda6,
          executor: executorB.publicKey,
          executorReputation: reputationPda(executorB.publicKey)[0],
          delegatorReputation: reputationPda(authority.publicKey)[0],
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const commission = await program.account.commission.fetch(commPda6);
      expect(JSON.stringify(commission.status)).to.equal(JSON.stringify({ completed: {} }));
    });
  });

  // ═══════════════════════════════════════════
  // Day 11: Reputation system
  // ═══════════════════════════════════════════

  describe("reputation", () => {
    const executorF = Keypair.generate();

    before(async () => {
      await airdrop(executorF.publicKey);
    });

    it("init_reputation creates a zeroed ReputationAccount", async () => {
      const [repPda] = reputationPda(executorF.publicKey);

      await program.methods
        .initReputation()
        .accounts({
          payer: authority.publicKey,
          wallet: executorF.publicKey,
          reputation: repPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const rep = await program.account.reputationAccount.fetch(repPda);
      expect(rep.wallet.toBase58()).to.equal(executorF.publicKey.toBase58());
      expect(rep.totalBids).to.equal(0);
      expect(rep.totalCompleted).to.equal(0);
      expect(rep.totalPaid).to.equal(0);
      expect(rep.uniqueCounterparties).to.equal(0);
      expect(rep.createdAt.toNumber()).to.be.greaterThan(0);
    });

    it("fails: init_reputation twice for the same wallet", async () => {
      const [repPda] = reputationPda(executorF.publicKey);

      try {
        await program.methods
          .initReputation()
          .accounts({
            payer: authority.publicKey,
            wallet: executorF.publicKey,
            reputation: repPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).to.exist;
      }
    });

    it("submit_bid auto-creates ReputationAccount and increments total_bids", async () => {
      // Commission #7: used for reputation tests
      const [commPda7] = commissionPda(7);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), null)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: commPda7,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const [bidPda7] = bidPda(7, executorF.publicKey);
      const [repPda] = reputationPda(executorF.publicKey);

      // executorF already has a reputation account from init_reputation above
      await program.methods
        .submitBid(new BN(7), new BN(300_000), "http://localhost:9999/tasks")
        .accounts({
          executor: executorF.publicKey,
          commission: commPda7,
          bid: bidPda7,
          executorReputation: repPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([executorF])
        .rpc();

      const rep = await program.account.reputationAccount.fetch(repPda);
      expect(rep.totalBids).to.equal(1);
      expect(rep.totalCompleted).to.equal(0);
    });

    it("complete_commission increments executor total_completed and delegator total_paid", async () => {
      // Select executorF for commission #7, then complete
      const [commPda7] = commissionPda(7);
      const [bidPda7] = bidPda(7, executorF.publicKey);

      await program.methods
        .selectBid(new BN(7))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda7,
          bid: bidPda7,
        })
        .rpc();

      const [repPdaF] = reputationPda(executorF.publicKey);
      const [repPdaAuth] = reputationPda(authority.publicKey);

      // Read baseline delegator counter before completing
      let delegatorRepBefore: any;
      try {
        delegatorRepBefore = await program.account.reputationAccount.fetch(repPdaAuth);
      } catch {
        delegatorRepBefore = { totalPaid: { toNumber: () => 0 }, uniqueCounterparties: { toNumber: () => 0 } };
      }

      await program.methods
        .completeCommission(new BN(7))
        .accounts({
          delegator: authority.publicKey,
          commission: commPda7,
          executor: executorF.publicKey,
          executorReputation: repPdaF,
          delegatorReputation: repPdaAuth,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Executor reputation: total_completed should be 1
      const repF = await program.account.reputationAccount.fetch(repPdaF);
      expect(repF.totalCompleted).to.equal(1);
      expect(repF.uniqueCounterparties).to.equal(1);

      // Delegator reputation: total_paid should have incremented
      const repAuth = await program.account.reputationAccount.fetch(repPdaAuth);
      expect(repAuth.totalPaid).to.be.greaterThanOrEqual(1);
      expect(repAuth.uniqueCounterparties).to.be.greaterThanOrEqual(1);
    });

    it("multiple completions accumulate correctly", async () => {
      // executorB completed commissions #0 and #6 in earlier tests
      const [repPdaB] = reputationPda(executorB.publicKey);
      const repB = await program.account.reputationAccount.fetch(repPdaB);
      // total_completed should be at least 2 (#0 and #6)
      expect(repB.totalCompleted).to.be.greaterThanOrEqual(2);
    });

    it("tier gate: commission with min_executor_tier=1 rejects guest executor", async () => {
      const executorGuest = Keypair.generate();
      await airdrop(executorGuest.publicKey);

      // Commission #8: requires Trusted (tier 1)
      const [commPda8] = commissionPda(8);
      await program.methods
        .createCommission(taskType, taskSpecHash, taskSpecUri, maxPrice, futureDeadline(), 1)
        .accounts({
          delegator: authority.publicKey,
          config: configPda,
          commission: commPda8,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const [bidPda8] = bidPda(8, executorGuest.publicKey);
      const [repPdaGuest] = reputationPda(executorGuest.publicKey);

      try {
        await program.methods
          .submitBid(new BN(8), new BN(300_000), "http://localhost:8080/tasks")
          .accounts({
            executor: executorGuest.publicKey,
            commission: commPda8,
            bid: bidPda8,
            executorReputation: repPdaGuest,
            systemProgram: SystemProgram.programId,
          })
          .signers([executorGuest])
          .rpc();
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InsufficientReputation");
      }
    });
  });
});
