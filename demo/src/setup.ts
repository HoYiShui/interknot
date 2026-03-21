/**
 * Demo Setup Script
 *
 * Generates 3 demo keypairs (Agent A, B, C), airdrops devnet SOL,
 * and initializes the Inter-Knot program if not already initialized.
 *
 * Flags:
 *   --use-existing-keypair   Use ~/.config/solana/id.json as Agent A
 *                            (useful if you already have SOL/USDC there)
 *
 * Run: pnpm --dir demo demo:setup [--use-existing-keypair]
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { InterKnot } from "@inter-knot/sdk";
import {
  RPC,
  PROGRAM_ID,
  DEVNET_USDC_MINT,
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

const USE_EXISTING = process.argv.includes("--use-existing-keypair");
const TOTAL_STEPS = 5;

async function main() {
  banner("Inter-Knot Demo Setup");

  const connection = new Connection(RPC, "confirmed");

  // Step 1: Generate or load wallets
  step(1, TOTAL_STEPS, "Setting up demo wallets...");
  let wallets: { agentA: Keypair; agentB: Keypair; agentC: Keypair };

  if (USE_EXISTING) {
    // Use the user's own Solana keypair as Agent A
    const keyPath = join(homedir(), ".config", "solana", "id.json");
    if (!existsSync(keyPath)) {
      throw new Error(`Keypair not found at ${keyPath}. Run 'solana-keygen new' first.`);
    }
    const raw = JSON.parse(readFileSync(keyPath, "utf-8")) as number[];
    const existingAgentA = Keypair.fromSecretKey(Uint8Array.from(raw));

    if (existsSync(WALLETS_FILE)) {
      const loaded = loadWallets();
      wallets = { ...loaded, agentA: existingAgentA };
    } else {
      wallets = {
        agentA: existingAgentA,
        agentB: Keypair.generate(),
        agentC: Keypair.generate(),
      };
    }
    // Always save so agent-a.ts picks up the right key
    saveWallets(wallets);
    ok(`Agent A = your existing keypair (${keyPath})`);
  } else if (existsSync(WALLETS_FILE)) {
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

  // Step 2: Airdrop SOL (non-fatal on failure)
  step(2, TOTAL_STEPS, "Checking/airdropping devnet SOL...");
  for (const [name, kp] of [
    ["Agent A", wallets.agentA],
    ["Agent B", wallets.agentB],
    ["Agent C", wallets.agentC],
  ] as const) {
    await airdropIfNeeded(connection, kp.publicKey, 0.5 * LAMPORTS_PER_SOL);
    const bal = await connection.getBalance(kp.publicKey);
    ok(`${name}: ${(bal / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
    await sleep(500);
  }

  // Step 3: Initialize program if needed
  step(3, TOTAL_STEPS, "Checking program initialization...");
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
    const txSig = await (client.program.methods as any)
      .initialize()
      .accounts({
        authority: wallets.agentA.publicKey,
        config: client.configPda,
        usdcMint: DEVNET_USDC_MINT,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    ok(`Initialized — tx: ${txSig}`);
  }

  // Step 4: Check Agent A's devnet USDC balance
  step(4, TOTAL_STEPS, "Checking Agent A devnet USDC balance...");
  let usdcBalanceUi = 0;
  try {
    const ata = await getAssociatedTokenAddress(DEVNET_USDC_MINT, wallets.agentA.publicKey);
    const tokenAccount = await getAccount(connection, ata);
    usdcBalanceUi = Number(tokenAccount.amount) / 1_000_000;
    ok(`Agent A USDC: ${usdcBalanceUi.toFixed(6)} USDC`);
  } catch {
    console.log("  ⚠  Agent A has no devnet USDC yet (token account not found).");
  }

  if (usdcBalanceUi < 0.10) {
    console.log("");
    console.log("  ┌─────────────────────────────────────────────────────────┐");
    console.log("  │  ACTION REQUIRED: Agent A needs devnet USDC             │");
    console.log("  │                                                          │");
    console.log(`  │  Agent A: ${wallets.agentA.publicKey.toBase58()}  │`);
    console.log("  │                                                          │");
    console.log("  │  Option 1 (easiest if you have Phantom):                 │");
    console.log("  │    https://spl-token-faucet.com/?token-name=USDC-Dev     │");
    console.log("  │                                                          │");
    console.log("  │  Option 2 (use your own wallet as Agent A):              │");
    console.log("  │    pnpm --dir demo demo:setup --use-existing-keypair      │");
    console.log("  │    (requires SOL + USDC in ~/.config/solana/id.json)      │");
    console.log("  │                                                          │");
    console.log("  │  Demo needs ~0.10 devnet USDC in Agent A's wallet.       │");
    console.log("  └─────────────────────────────────────────────────────────┘");
    console.log("");
  }

  // Step 5: Print summary
  step(5, TOTAL_STEPS, "Setup complete!");
  console.log("");
  console.log("  Agent A (delegator):");
  console.log(`    Pubkey:  ${wallets.agentA.publicKey.toBase58()}`);
  console.log(`    SOL:     ${((await connection.getBalance(wallets.agentA.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log(`    USDC:    ${usdcBalanceUi.toFixed(6)} USDC${usdcBalanceUi < 0.10 ? " ← top up before running demo" : " ✓"}`);
  console.log("");
  console.log("  Agent B (executor):");
  console.log(`    Pubkey:  ${wallets.agentB.publicKey.toBase58()}`);
  console.log(`    SOL:     ${((await connection.getBalance(wallets.agentB.publicKey)) / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  console.log("");
  console.log("  Next steps:");
  console.log("    Terminal 1: pnpm --dir demo agent-b");
  console.log("    Terminal 2: pnpm --dir demo agent-a");
  console.log("    Or one-command: ./demo/mock-demo.sh");
  console.log("");
}

main().catch((err) => {
  console.error("✗ Setup failed:", err.message ?? err);
  process.exit(1);
});
