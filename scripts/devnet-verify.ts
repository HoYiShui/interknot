/**
 * Devnet verification script
 * Runs the full lifecycle: initialize → create_commission → submit_bid → select_bid → complete_commission
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { InterKnot } from "../target/types/inter_knot";
import { PublicKey, Keypair, SystemProgram, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh");
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

function loadKeypair(filePath: string): Keypair {
  const resolved = filePath.replace("~", os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function commissionPda(id: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commission"), new BN(id).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

function bidPda(commissionId: number, executor: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), new BN(commissionId).toArrayLike(Buffer, "le", 8), executor.toBuffer()],
    PROGRAM_ID
  );
}

function reputationPda(wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), wallet.toBuffer()],
    PROGRAM_ID
  );
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Inter-Knot Devnet Verification");
  console.log("═══════════════════════════════════════════\n");

  // Setup
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const authority = loadKeypair("~/.config/solana/id.json");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program<InterKnot>(
    JSON.parse(fs.readFileSync("target/idl/inter_knot.json", "utf-8")),
    provider,
  );

  const executor = Keypair.generate();
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("inter_knot_config")],
    PROGRAM_ID
  );

  console.log(`Authority:  ${authority.publicKey.toBase58()}`);
  console.log(`Executor:   ${executor.publicKey.toBase58()}`);
  console.log(`Program:    ${PROGRAM_ID.toBase58()}`);
  console.log(`Config PDA: ${configPda.toBase58()}\n`);

  // Airdrop SOL to executor
  console.log("[1/6] Airdropping SOL to executor...");
  try {
    const sig = await connection.requestAirdrop(executor.publicKey, 0.1 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log("  ✓ Executor funded\n");
  } catch (e) {
    // Transfer from authority if airdrop fails
    console.log("  Airdrop failed, transferring from authority...");
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: executor.publicKey,
        lamports: 0.1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(tx);
    console.log("  ✓ Executor funded via transfer\n");
  }

  // Step 1: Initialize
  console.log("[2/6] Initializing platform...");
  try {
    const tx = await program.methods
      .initialize(USDC_MINT)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  ✓ Initialize tx: ${tx}\n`);
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("  ✓ Already initialized (PDA exists)\n");
    } else {
      throw e;
    }
  }

  // Fetch config and verify invariants
  const config = await program.account.platformConfig.fetch(configPda);
  const nextId = config.commissionCount.toNumber();
  console.log(`  Commission counter: ${nextId}`);

  // Verify config matches expected values
  if (config.authority.toBase58() !== authority.publicKey.toBase58()) {
    throw new Error(
      `Config authority mismatch: expected ${authority.publicKey.toBase58()}, got ${config.authority.toBase58()}`
    );
  }
  if (config.usdcMint.toBase58() !== USDC_MINT.toBase58()) {
    throw new Error(
      `Config USDC mint mismatch: expected ${USDC_MINT.toBase58()}, got ${config.usdcMint.toBase58()}`
    );
  }
  console.log("  ✓ Config authority and USDC mint verified");

  // Step 2: Create Commission
  console.log(`\n[3/6] Creating commission #${nextId}...`);
  const taskSpec = JSON.stringify({
    type: "compute/llm-inference",
    version: "0.1.0",
    spec: { model: "llama-3-8b", maxTokens: 1024 },
  });
  const taskSpecHash = Array.from(crypto.createHash("sha256").update(taskSpec).digest());
  const deadline = new BN(Math.floor(Date.now() / 1000) + 600); // 10 min
  const [commPda] = commissionPda(nextId);

  const [delegatorRepPda] = reputationPda(authority.publicKey);
  const createTx = await program.methods
    .createCommission(
      "compute/llm-inference",
      taskSpecHash,
      "https://example.com/devnet-test-spec.json",
      new BN(500_000), // 0.50 USDC
      deadline,
      null  // no min_executor_tier
    )
    .accounts({
      delegator: authority.publicKey,
      config: configPda,
      commission: commPda,
      delegatorReputation: delegatorRepPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ✓ CreateCommission tx: ${createTx}`);

  let commission = await program.account.commission.fetch(commPda);
  console.log(`  Status: ${JSON.stringify(commission.status)}`);

  // Step 3: Submit Bid
  console.log(`\n[4/6] Executor submitting bid...`);
  const [bPda] = bidPda(nextId, executor.publicKey);

  const [executorRepPda] = reputationPda(executor.publicKey);
  const bidTx = await program.methods
    .submitBid(new BN(nextId), new BN(350_000), "http://executor-test:8080/tasks")
    .accounts({
      executor: executor.publicKey,
      commission: commPda,
      bid: bPda,
      executorReputation: executorRepPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([executor])
    .rpc();
  console.log(`  ✓ SubmitBid tx: ${bidTx}`);

  const bid = await program.account.bid.fetch(bPda);
  console.log(`  Bid price: ${bid.price.toNumber()} (${bid.price.toNumber() / 1_000_000} USDC)`);

  // Step 4: Select Bid
  console.log(`\n[5/6] Delegator selecting bid...`);
  const selectTx = await program.methods
    .selectBid(new BN(nextId))
    .accounts({
      delegator: authority.publicKey,
      commission: commPda,
      bid: bPda,
    })
    .rpc();
  console.log(`  ✓ SelectBid tx: ${selectTx}`);

  commission = await program.account.commission.fetch(commPda);
  console.log(`  Status: ${JSON.stringify(commission.status)}`);
  console.log(`  Selected executor: ${commission.selectedExecutor?.toBase58()}`);

  // Step 5: Complete Commission
  console.log(`\n[6/6] Delegator completing commission...`);
  const completeTx = await program.methods
    .completeCommission(new BN(nextId))
    .accounts({
      delegator: authority.publicKey,
      commission: commPda,
      executor: executor.publicKey,
      executorReputation: executorRepPda,
      delegatorReputation: delegatorRepPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`  ✓ CompleteCommission tx: ${completeTx}`);

  commission = await program.account.commission.fetch(commPda);
  console.log(`  Status: ${JSON.stringify(commission.status)}`);

  // Summary
  console.log("\n═══════════════════════════════════════════");
  console.log("  ✓ ALL DEVNET VERIFICATIONS PASSED");
  console.log("═══════════════════════════════════════════");
  console.log(`\n  Program:    ${PROGRAM_ID.toBase58()}`);
  console.log(`  Commission: #${nextId} (${commPda.toBase58()})`);
  console.log(`  Txs: 4 on-chain transactions completed`);
  console.log(`\n  Explorer: https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error("\n✗ VERIFICATION FAILED:", err);
  process.exit(1);
});
