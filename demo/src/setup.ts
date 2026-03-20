/**
 * Demo Setup Script
 *
 * Generates 3 demo keypairs (Agent A, B, C), airdrops devnet SOL,
 * and initializes the Inter-Knot program if not already initialized.
 *
 * Run: pnpm --dir demo setup
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { InterKnot } from "@inter-knot/sdk";
import {
  RPC,
  PROGRAM_ID,
  WALLETS_FILE,
  saveWallets,
  loadWallets,
  airdropIfNeeded,
  sleep,
  banner,
  step,
  ok,
} from "./config.js";
import { existsSync } from "node:fs";

async function main() {
  banner("Inter-Knot Demo Setup");

  const connection = new Connection(RPC, "confirmed");

  // Step 1: Generate or load wallets
  step(1, 4, "Setting up demo wallets...");
  let wallets: { agentA: Keypair; agentB: Keypair; agentC: Keypair };

  if (existsSync(WALLETS_FILE)) {
    wallets = loadWallets();
    ok("Loaded existing wallets from .demo-wallets.json");
  } else {
    wallets = {
      agentA: Keypair.generate(),
      agentB: Keypair.generate(),
      agentC: Keypair.generate(),
    };
    saveWallets(wallets);
    ok("Generated new demo wallets → saved to .demo-wallets.json");
  }

  console.log(`  Agent A (delegator): ${wallets.agentA.publicKey.toBase58()}`);
  console.log(`  Agent B (executor):  ${wallets.agentB.publicKey.toBase58()}`);
  console.log(`  Agent C (executor):  ${wallets.agentC.publicKey.toBase58()}`);

  // Step 2: Airdrop SOL
  step(2, 4, "Airdropping devnet SOL (rate-limited, may take a moment)...");
  for (const [name, kp] of [
    ["Agent A", wallets.agentA],
    ["Agent B", wallets.agentB],
    ["Agent C", wallets.agentC],
  ] as const) {
    await airdropIfNeeded(connection, kp.publicKey, 0.5 * LAMPORTS_PER_SOL);
    const bal = await connection.getBalance(kp.publicKey);
    ok(`${name}: ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
    await sleep(500); // stay within rate limits
  }

  // Step 3: Check platform config (initialize if needed)
  step(3, 4, "Checking program initialization...");
  const client = new InterKnot({
    connection,
    wallet: wallets.agentA,
    programId: PROGRAM_ID,
  });

  let initialized = false;
  try {
    await client.accounts.platformConfig.fetch(client.configPda);
    initialized = true;
    ok("Program already initialized");
  } catch {
    // Not yet initialized
  }

  if (!initialized) {
    console.log("  Initializing Inter-Knot program on devnet...");
    const usdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    const txSig = await (client.program.methods as any)
      .initialize()
      .accounts({
        authority: wallets.agentA.publicKey,
        config: client.configPda,
        usdcMint,
        systemProgram: (await import("@solana/web3.js")).SystemProgram.programId,
      })
      .rpc();
    ok(`Initialized — tx: ${txSig}`);
  }

  // Step 4: Print summary
  step(4, 4, "Setup complete!");
  console.log("");
  console.log("  Agent A (delegator):");
  console.log(`    Pubkey:  ${wallets.agentA.publicKey.toBase58()}`);
  console.log(`    Balance: ${((await connection.getBalance(wallets.agentA.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log("");
  console.log("  Agent B (executor):");
  console.log(`    Pubkey:  ${wallets.agentB.publicKey.toBase58()}`);
  console.log(`    Balance: ${((await connection.getBalance(wallets.agentB.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log("");
  console.log("  Next steps:");
  console.log("    Terminal 1: pnpm --dir demo agent-b");
  console.log("    Terminal 2: pnpm --dir demo agent-a");
  console.log("");
}

main().catch((err) => {
  console.error("✗ Setup failed:", err.message ?? err);
  process.exit(1);
});
