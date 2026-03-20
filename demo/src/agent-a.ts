/**
 * Agent A — Delegator
 *
 * Runs the full Inter-Knot demo flow:
 * 1. Create a commission (compute/llm-inference)
 * 2. Wait for bids to appear (polls on-chain)
 * 3. Select the lowest-price bid
 * 4. Deliver the task via x402 payment
 * 5. Mark the commission as completed
 *
 * Requires Agent B to be running first.
 * Run: pnpm --dir demo agent-a
 */
import { Connection } from "@solana/web3.js";
import { InterKnot, DeliveryClient } from "@inter-knot/sdk";
import {
  RPC,
  PROGRAM_ID,
  TASK_TYPE,
  TASK_SPEC,
  TASK_PROMPT,
  MAX_PRICE_USDC,
  TASK_DEADLINE,
  loadWallets,
  sleep,
  banner,
  step,
  ok,
} from "./config.js";

const X402_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_BIDS_MS = 60_000;

async function main() {
  banner("Agent A — Delegator");

  const { agentA: wallet } = loadWallets();
  const connection = new Connection(RPC, "confirmed");
  const client = new InterKnot({ connection, wallet, programId: PROGRAM_ID });

  console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`  RPC:    ${RPC}\n`);

  // ─── Step 1: Create commission ──────────────────────────────────────────────
  step(1, 5, "Creating commission...");
  const taskSpecUri = `data:application/json;base64,${Buffer.from(
    JSON.stringify(TASK_SPEC),
  ).toString("base64")}`;

  const { commissionId, txSignature: createTx } = await client.commission.create({
    taskType: TASK_TYPE,
    taskSpec: TASK_SPEC,
    taskSpecUri,
    maxPrice: MAX_PRICE_USDC,
    deadline: TASK_DEADLINE,
  });

  ok(`Commission #${commissionId} created`);
  console.log(`  Tx: ${createTx}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${createTx}?cluster=devnet\n`);

  // ─── Step 2: Wait for bids ──────────────────────────────────────────────────
  step(2, 5, "Waiting for bids from executors...");
  const deadline = Date.now() + MAX_WAIT_BIDS_MS;
  let bids: Awaited<ReturnType<typeof client.query.getBidsSortedByPrice>> = [];

  while (Date.now() < deadline) {
    bids = await client.query.getBidsSortedByPrice(commissionId);
    if (bids.length > 0) break;
    process.stdout.write(".");
    await sleep(POLL_INTERVAL_MS);
  }
  console.log("");

  if (bids.length === 0) {
    console.error("✗ No bids received within timeout. Is Agent B running?");
    process.exit(1);
  }

  console.log(`  ${bids.length} bid(s) received:`);
  for (const b of bids) {
    console.log(
      `    ${b.executor.toBase58().slice(0, 8)}... @ $${(b.price.toNumber() / 1_000_000).toFixed(6)} USDC → ${b.serviceEndpoint}`,
    );
  }

  // ─── Step 3: Select lowest bid ──────────────────────────────────────────────
  step(3, 5, "Selecting lowest-price bid...");
  const winner = bids[0]; // already sorted ascending by price
  const { txSignature: selectTx } = await client.matching.selectBid(
    commissionId,
    winner.executor,
  );

  ok(`Selected executor: ${winner.executor.toBase58()}`);
  console.log(`  Price: $${(winner.price.toNumber() / 1_000_000).toFixed(6)} USDC`);
  console.log(`  Tx: ${selectTx}\n`);

  // ─── Step 4: Deliver task via x402 ─────────────────────────────────────────
  step(4, 5, `Delivering task via x402 to ${winner.serviceEndpoint}...`);
  console.log(`  Prompt: "${TASK_PROMPT}"\n`);

  const deliveryClient = new DeliveryClient({ wallet, network: X402_NETWORK });
  const { result, paymentTxHash } = await deliveryClient.requestWithPayment(
    winner.serviceEndpoint,
    { prompt: TASK_PROMPT, ...TASK_SPEC },
  );

  ok("Task delivered and paid");
  if (paymentTxHash) {
    console.log(`  Settlement tx: ${paymentTxHash}`);
  }
  console.log(`\n  ─── Task Result ───`);
  console.log(`  Model:   ${result.model}`);
  console.log(`  Tokens:  ${result.tokensUsed}`);
  console.log(`  Latency: ${result.latencyMs}ms`);
  console.log(`  Output:\n`);
  console.log(`  "${result.output}"\n`);

  // ─── Step 5: Complete commission ────────────────────────────────────────────
  step(5, 5, "Marking commission as completed...");
  const { txSignature: completeTx } = await client.commission.complete(commissionId);

  ok("Commission completed");
  console.log(`  Tx: ${completeTx}`);
  console.log(`  Explorer: https://explorer.solana.com/tx/${completeTx}?cluster=devnet`);

  console.log("\n" + "═".repeat(50));
  console.log("  ✓ DEMO COMPLETE");
  console.log("  5 on-chain txs + 1 x402 payment");
  console.log("═".repeat(50) + "\n");
}

main().catch((err) => {
  console.error("✗ Agent A failed:", err.message ?? err);
  process.exit(1);
});
