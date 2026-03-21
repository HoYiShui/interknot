/**
 * Agent C — Optional Competing Executor
 *
 * Same as Agent B but bids slightly higher, demonstrating price competition.
 * Agent A will prefer B's lower bid.
 *
 * Run: pnpm --dir demo agent-c
 */
import { Connection } from "@solana/web3.js";
import { InterKnot, startTaskServer, estimateComputeCost } from "@inter-knot/sdk";
import {
  RPC,
  PROGRAM_ID,
  TASK_TYPE,
  loadWallets,
  sleep,
  banner,
  ok,
} from "./config.js";

const EXECUTOR_PORT_C = 8081;
const EXECUTOR_ENDPOINT_C = `http://localhost:${EXECUTOR_PORT_C}/tasks`;
const BID_PRICE_USDC = 0.05; // intentionally higher than Agent B

async function main() {
  banner("Agent C — Competing Executor (Mock mode)");

  const { agentC: wallet } = loadWallets();
  const connection = new Connection(RPC, "confirmed");

  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  Bid:    $${BID_PRICE_USDC} USDC (higher than Agent B)\n`);

  // Start task server on alternate port
  console.log(`[1] Starting task server on port ${EXECUTOR_PORT_C}...`);
  await startTaskServer({ wallet, port: EXECUTOR_PORT_C, price: String(BID_PRICE_USDC) });
  ok(`Task server running at ${EXECUTOR_ENDPOINT_C}`);

  // Watch and bid
  console.log("\n[2] Watching for open commissions...\n");
  const client = new InterKnot({ connection, wallet, programId: PROGRAM_ID });
  const seen = new Set<number>();

  const { stop } = client.commission.watch({
    taskType: TASK_TYPE,
    pollIntervalMs: 3000,
    onNew: async (commission: any) => {
      if (seen.has(commission.commissionId)) return;
      seen.add(commission.commissionId);

      console.log(`  → Commission #${commission.commissionId} — bidding $${BID_PRICE_USDC} USDC`);
      try {
        const { txSignature } = await client.bid.submit(commission.commissionId, {
          price: BID_PRICE_USDC,
          serviceEndpoint: EXECUTOR_ENDPOINT_C,
        });
        ok(`Bid submitted — tx: ${txSignature.slice(0, 16)}...`);
      } catch (e: any) {
        console.log(`    ✗ Bid failed: ${e.message}`);
      }
    },
  });

  console.log("  Waiting for commissions... (Ctrl+C to stop)\n");

  process.on("SIGINT", () => {
    console.log("\nStopping Agent C...");
    stop();
    process.exit(0);
  });

  while (true) {
    await sleep(10_000);
  }
}

main().catch((err) => {
  console.error("✗ Agent C failed:", err.message ?? err);
  process.exit(1);
});
