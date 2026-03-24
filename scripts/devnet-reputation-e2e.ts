/**
 * Devnet Reputation E2E Test
 * Validates all four reputation scenarios from the Day12 review requirements.
 *
 * Scenarios:
 *   S1 — min_executor_tier gate: Guest executor rejected on Trusted-gated commission
 *   S2 — 5 completions promote agentB from Guest → Trusted
 *   S3 — Matched cancel increments abandonment counters for both parties
 *   S4 — 3-agent competitive flow with reputation-aware bid listing
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { InterKnot } from "../target/types/inter_knot.js";
import {
  PublicKey, Keypair, SystemProgram, Connection, LAMPORTS_PER_SOL, Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount, createTransferInstruction,
} from "@solana/spl-token";
import BN from "bn.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// ─── Config ──────────────────────────────────────────────────────────────────

const DEVNET_RPC   = "https://api.devnet.solana.com";
const PROGRAM_ID   = new PublicKey("G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh");
const USDC_MINT    = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const EXPLORER     = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// ─── Keypair helpers ─────────────────────────────────────────────────────────

function loadDemoWallet(name: string): Keypair {
  const raw = JSON.parse(fs.readFileSync("demo/.demo-wallets.json", "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw[name]));
}

// ─── PDA helpers ─────────────────────────────────────────────────────────────

function commissionPda(id: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commission"), new BN(id).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

function bidPda(commissionId: number, executor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bid"), new BN(commissionId).toArrayLike(Buffer, "le", 8), executor.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function reputationPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), wallet.toBuffer()],
    PROGRAM_ID,
  )[0];
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function logTx(label: string, sig: string) {
  console.log(`  ✓ ${label}`);
  console.log(`    sig:      ${sig}`);
  console.log(`    explorer: ${EXPLORER(sig)}`);
}

function tier(n: number): string {
  return ["Guest", "Trusted", "Verified", "Elite"][n] ?? `Unknown(${n})`;
}

async function logReputation(label: string, program: any, wallet: PublicKey) {
  const pda = reputationPda(wallet);
  let rep: any = null;
  try { rep = await program.account.reputationAccount.fetch(pda); } catch {}

  if (!rep) {
    console.log(`  ${label} (${wallet.toBase58().slice(0, 8)}...): no account (Guest, score=0)`);
    return;
  }
  const completed   = rep.totalCompleted;
  const bids        = rep.totalBids;
  const abandoned   = rep.totalAbandoned;
  const commissioned = rep.totalCommissioned;
  const paid        = rep.totalPaid;
  const dAbandoned  = rep.totalDelegatorAbandoned;
  const unique      = rep.uniqueCounterparties;

  // Compute tier manually (mirrors on-chain logic)
  let t = 0;
  if (completed >= 50 && unique >= 10) t = 3;
  else if (completed >= 20 && unique >= 5) t = 2;
  else if (completed >= 5) t = 1;

  console.log(`  ${label} (${wallet.toBase58().slice(0, 8)}...):`);
  console.log(`    tier=${tier(t)}  completed=${completed}  bids=${bids}  abandoned=${abandoned}`);
  console.log(`    commissioned=${commissioned}  paid=${paid}  delegatorAbandoned=${dAbandoned}  unique=${unique}`);
}

// ─── USDC transfer helper ─────────────────────────────────────────────────────

async function payUsdc(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  amount: BN,
): Promise<string> {
  const fromAta = await getAssociatedTokenAddress(USDC_MINT, from.publicKey);
  const toAtaAccount = await getOrCreateAssociatedTokenAccount(
    connection, from, USDC_MINT, to,
  );
  const ix = createTransferInstruction(
    fromAta, toAtaAccount.address, from.publicKey, BigInt(amount.toString()),
  );
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [from]);
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

// ─── Airdrop with retry ───────────────────────────────────────────────────────

async function airdropSol(connection: Connection, wallet: PublicKey, lamports: number) {
  try {
    const sig = await connection.requestAirdrop(wallet, lamports);
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`  ✓ Airdropped ${lamports / LAMPORTS_PER_SOL} SOL to ${wallet.toBase58().slice(0, 8)}...`);
  } catch {
    console.log(`  ! Airdrop failed (rate limited), continuing...`);
  }
}

// ─── Commission task spec helper ─────────────────────────────────────────────

function makeTaskSpec(label: string) {
  const spec = JSON.stringify({ type: "compute/llm-inference", label, ts: Date.now() });
  const hash = Array.from(crypto.createHash("sha256").update(spec).digest());
  const uri  = `data:application/json;base64,${Buffer.from(spec).toString("base64")}`.slice(0, 128);
  return { hash, uri };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  separator("Inter-Knot Devnet Reputation E2E Test");
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Program: ${PROGRAM_ID.toBase58()}`);

  // Setup
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const agentA = loadDemoWallet("agentA");
  const agentB = loadDemoWallet("agentB");
  const agentC = loadDemoWallet("agentC");

  // Use agentA as provider (has most SOL for rent/fees)
  const walletA = new anchor.Wallet(agentA);
  const provider = new anchor.AnchorProvider(connection, walletA, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const program = new Program<InterKnot>(
    JSON.parse(fs.readFileSync("target/idl/inter_knot.json", "utf-8")),
    provider,
  ) as any;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("inter_knot_config")], PROGRAM_ID,
  );

  separator("Wallet Map");
  console.log(`  agentA (delegator):  ${agentA.publicKey.toBase58()}`);
  console.log(`  agentB (executor 1): ${agentB.publicKey.toBase58()}`);
  console.log(`  agentC (executor 2): ${agentC.publicKey.toBase58()}`);

  // Get starting commission count
  const configBefore = await program.account.platformConfig.fetch(configPda);
  let nextId: number = configBefore.commissionCount.toNumber();
  console.log(`\n  Starting commission ID: #${nextId}`);

  // ─── Initial reputation snapshot ──────────────────────────────────────────
  separator("Initial Reputation State");
  await logReputation("agentA", program, agentA.publicKey);
  await logReputation("agentB", program, agentB.publicKey);
  await logReputation("agentC", program, agentC.publicKey);

  const results: { scenario: string; expected: string; observed: string; pass: boolean }[] = [];

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 1: min_executor_tier gate — Guest rejected
  // ══════════════════════════════════════════════════════════════════════════
  separator("Scenario 1: Tier Gate — Guest Executor Rejected");

  const s1Id = nextId++;
  const { hash: s1Hash, uri: s1Uri } = makeTaskSpec("s1-tier-gate");
  const deadline = new BN(Math.floor(Date.now() / 1000) + 600);
  const price100k = new BN(100_000); // 0.10 USDC

  // Create commission with min_executor_tier=1 (Trusted)
  const s1Tx = await program.methods
    .createCommission("compute/llm-inference", s1Hash, s1Uri, price100k, deadline, 1)
    .accounts({
      delegator: agentA.publicKey,
      config: configPda,
      commission: commissionPda(s1Id),
      delegatorReputation: reputationPda(agentA.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  logTx(`Create commission #${s1Id} (min_tier=Trusted)`, s1Tx);

  // Generate fresh guest wallet and fund from agentA
  const guestWallet = Keypair.generate();
  console.log(`  Funding guest ${guestWallet.publicKey.toBase58().slice(0, 8)}... from agentA`);
  {
    const fundTx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: agentA.publicKey,
      toPubkey: guestWallet.publicKey,
      lamports: BigInt(Math.floor(0.03 * LAMPORTS_PER_SOL)),
    }));
    const fundSig = await provider.connection.sendTransaction(fundTx, [agentA]);
    await provider.connection.confirmTransaction(fundSig, "confirmed");
    console.log(`  ✓ Funded guest with 0.03 SOL`);
  }

  // Guest attempts to bid — expect rejection
  let s1Pass = false;
  let s1Observed = "unexpected success";
  try {
    await program.methods
      .submitBid(new BN(s1Id), price100k, "http://guest:8080/tasks")
      .accounts({
        executor: guestWallet.publicKey,
        commission: commissionPda(s1Id),
        bid: bidPda(s1Id, guestWallet.publicKey),
        executorReputation: reputationPda(guestWallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([guestWallet])
      .rpc();
  } catch (err: any) {
    // Try AnchorError first, then fall back to log scanning
    const code = err?.error?.errorCode?.code
      ?? (err?.logs ?? []).find((l: string) => l.includes("InsufficientReputation"))
        ?.match(/InsufficientReputation/)?.[0]
      ?? err?.message?.match(/InsufficientReputation/)?.[0]
      ?? String(err).slice(0, 80);
    s1Observed = `rejected: ${code}`;
    s1Pass = String(code).includes("InsufficientReputation");
    console.log(`  ✓ Guest bid rejected: ${code}`);
    console.log(`    guest: ${guestWallet.publicKey.toBase58()}`);
  }
  results.push({
    scenario: "S1: Tier gate rejection",
    expected: "InsufficientReputation error",
    observed: s1Observed,
    pass: s1Pass,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 2: 5 completions → agentB Guest → Trusted
  // ══════════════════════════════════════════════════════════════════════════
  separator("Scenario 2: 5 Completions — agentB Guest → Trusted");

  console.log("\n  Reputation BEFORE:");
  await logReputation("agentB", program, agentB.publicKey);

  const s2Price = new BN(50_000); // 0.05 USDC each
  const s2Txs: string[] = [];

  for (let i = 0; i < 5; i++) {
    const cId = nextId++;
    const { hash, uri } = makeTaskSpec(`s2-cycle-${i}`);
    const dl = new BN(Math.floor(Date.now() / 1000) + 600);
    const cPda = commissionPda(cId);
    const bPda = bidPda(cId, agentB.publicKey);

    // Create
    const createTx = await program.methods
      .createCommission("compute/llm-inference", hash, uri, s2Price, dl, null)
      .accounts({
        delegator: agentA.publicKey, config: configPda,
        commission: cPda,
        delegatorReputation: reputationPda(agentA.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Bid (agentB)
    const bidTx = await program.methods
      .submitBid(new BN(cId), s2Price, "http://agentb:8080/tasks")
      .accounts({
        executor: agentB.publicKey, commission: cPda, bid: bPda,
        executorReputation: reputationPda(agentB.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([agentB])
      .rpc();

    // Select
    const selectTx = await program.methods
      .selectBid(new BN(cId))
      .accounts({ delegator: agentA.publicKey, commission: cPda, bid: bPda })
      .rpc();

    // Pay USDC
    const paySig = await payUsdc(connection, agentA, agentB.publicKey, s2Price);

    // Complete
    const completeTx = await program.methods
      .completeCommission(new BN(cId))
      .accounts({
        delegator: agentA.publicKey, commission: cPda,
        executor: agentB.publicKey,
        executorReputation: reputationPda(agentB.publicKey),
        delegatorReputation: reputationPda(agentA.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    s2Txs.push(completeTx);
    console.log(`  ✓ Cycle ${i + 1}/5 — commission #${cId} completed`);
    console.log(`    create=${createTx.slice(0, 16)}...  bid=${bidTx.slice(0, 16)}...  select=${selectTx.slice(0, 16)}...  pay=${paySig.slice(0, 16)}...  complete=${completeTx.slice(0, 16)}...`);
  }

  console.log("\n  Reputation AFTER:");
  await logReputation("agentB", program, agentB.publicKey);

  const repB = await program.account.reputationAccount.fetch(reputationPda(agentB.publicKey));
  const completedB = repB.totalCompleted;
  let tierB = 0;
  if (completedB >= 50 && repB.uniqueCounterparties >= 10) tierB = 3;
  else if (completedB >= 20 && repB.uniqueCounterparties >= 5) tierB = 2;
  else if (completedB >= 5) tierB = 1;

  const s2Pass = tierB >= 1;
  results.push({
    scenario: "S2: Guest → Trusted after 5 completions",
    expected: "agentB tier = Trusted (totalCompleted >= 5)",
    observed: `totalCompleted=${completedB}, tier=${tier(tierB)}`,
    pass: s2Pass,
  });
  console.log(`\n  Complete txs (explorer):`);
  s2Txs.forEach((sig, i) => console.log(`    cycle ${i + 1}: ${EXPLORER(sig)}`));

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 3: Matched cancel — abandonment counters
  // ══════════════════════════════════════════════════════════════════════════
  separator("Scenario 3: Matched Cancel — Abandonment Counters");

  const s3Id = nextId++;
  const { hash: s3Hash, uri: s3Uri } = makeTaskSpec("s3-matched-cancel");
  const s3Dl = new BN(Math.floor(Date.now() / 1000) + 600);
  const s3Price = new BN(50_000);
  const s3CPda = commissionPda(s3Id);
  const s3BPda = bidPda(s3Id, agentB.publicKey);

  console.log("\n  Reputation BEFORE:");
  await logReputation("agentA", program, agentA.publicKey);
  await logReputation("agentB", program, agentB.publicKey);

  const s3Create = await program.methods
    .createCommission("compute/llm-inference", s3Hash, s3Uri, s3Price, s3Dl, null)
    .accounts({
      delegator: agentA.publicKey, config: configPda,
      commission: s3CPda,
      delegatorReputation: reputationPda(agentA.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  logTx(`Create commission #${s3Id}`, s3Create);

  const s3Bid = await program.methods
    .submitBid(new BN(s3Id), s3Price, "http://agentb:8080/tasks")
    .accounts({
      executor: agentB.publicKey, commission: s3CPda, bid: s3BPda,
      executorReputation: reputationPda(agentB.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([agentB])
    .rpc();
  logTx("agentB submits bid", s3Bid);

  const s3Select = await program.methods
    .selectBid(new BN(s3Id))
    .accounts({ delegator: agentA.publicKey, commission: s3CPda, bid: s3BPda })
    .rpc();
  logTx("agentA selects agentB", s3Select);

  // Read before-cancel state
  const repABefore = await program.account.reputationAccount.fetch(reputationPda(agentA.publicKey));
  const repBBefore = await program.account.reputationAccount.fetch(reputationPda(agentB.publicKey));
  const aAbandonedBefore = repABefore.totalDelegatorAbandoned;
  const bAbandonedBefore = repBBefore.totalAbandoned;

  const s3Cancel = await program.methods
    .cancelCommission(new BN(s3Id))
    .accounts({
      delegator: agentA.publicKey, commission: s3CPda,
      executor: agentB.publicKey,
      executorReputation: reputationPda(agentB.publicKey),
      delegatorReputation: reputationPda(agentA.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  logTx("agentA cancels matched commission", s3Cancel);

  const repAAfter = await program.account.reputationAccount.fetch(reputationPda(agentA.publicKey));
  const repBAfter = await program.account.reputationAccount.fetch(reputationPda(agentB.publicKey));

  console.log("\n  Reputation AFTER:");
  await logReputation("agentA", program, agentA.publicKey);
  await logReputation("agentB", program, agentB.publicKey);

  const s3aPass = repAAfter.totalDelegatorAbandoned === aAbandonedBefore + 1;
  const s3bPass = repBAfter.totalAbandoned === bAbandonedBefore + 1;
  results.push({
    scenario: "S3: Matched cancel — agentA delegatorAbandoned",
    expected: `totalDelegatorAbandoned = ${aAbandonedBefore + 1}`,
    observed: `totalDelegatorAbandoned = ${repAAfter.totalDelegatorAbandoned}`,
    pass: s3aPass,
  });
  results.push({
    scenario: "S3: Matched cancel — agentB abandoned",
    expected: `totalAbandoned = ${bAbandonedBefore + 1}`,
    observed: `totalAbandoned = ${repBAfter.totalAbandoned}`,
    pass: s3bPass,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Scenario 4: 3-agent competitive flow with reputation-aware bid listing
  // ══════════════════════════════════════════════════════════════════════════
  separator("Scenario 4: 3-Agent Competitive Flow + Reputation Bid View");

  const s4Id = nextId++;
  const { hash: s4Hash, uri: s4Uri } = makeTaskSpec("s4-competitive");
  const s4Dl = new BN(Math.floor(Date.now() / 1000) + 600);
  const s4MaxPrice = new BN(200_000); // 0.20 USDC
  const s4PriceB = new BN(120_000);  // agentB: 0.12 USDC
  const s4PriceC = new BN(150_000);  // agentC: 0.15 USDC
  const s4CPda = commissionPda(s4Id);
  const s4BPda = bidPda(s4Id, agentB.publicKey);
  const s4CPda2 = bidPda(s4Id, agentC.publicKey);

  // Create commission
  const s4Create = await program.methods
    .createCommission("compute/llm-inference", s4Hash, s4Uri, s4MaxPrice, s4Dl, null)
    .accounts({
      delegator: agentA.publicKey, config: configPda,
      commission: s4CPda,
      delegatorReputation: reputationPda(agentA.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  logTx(`Create commission #${s4Id} (maxPrice=0.20 USDC)`, s4Create);

  // agentB bids
  const s4BidB = await program.methods
    .submitBid(new BN(s4Id), s4PriceB, "http://agentb:8080/tasks")
    .accounts({
      executor: agentB.publicKey, commission: s4CPda, bid: s4BPda,
      executorReputation: reputationPda(agentB.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([agentB])
    .rpc();
  logTx("agentB bids 0.12 USDC", s4BidB);

  // agentC bids
  const s4BidC = await program.methods
    .submitBid(new BN(s4Id), s4PriceC, "http://agentc:8080/tasks")
    .accounts({
      executor: agentC.publicKey, commission: s4CPda, bid: s4CPda2,
      executorReputation: reputationPda(agentC.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .signers([agentC])
    .rpc();
  logTx("agentC bids 0.15 USDC", s4BidC);

  // Reputation-aware bid listing (inline, mirrors CLI --with-reputation)
  console.log("\n  ── bid list --with-reputation output ──");
  const bids = await program.account.bid.all();
  const commBids = bids
    .filter((b: any) => b.account.commissionId.toNumber() === s4Id)
    .sort((a: any, b: any) => a.account.price.cmp(b.account.price));

  for (const [i, b] of commBids.entries()) {
    const exec = b.account.executor as PublicKey;
    const price = b.account.price.toNumber() / 1_000_000;
    let repStr = "Guest (score=0/1000)";
    try {
      const rep = await program.account.reputationAccount.fetch(reputationPda(exec));
      const completed = rep.totalCompleted;
      const tbids = rep.totalBids;
      const abandoned = rep.totalAbandoned;
      const unique = rep.uniqueCounterparties;
      let t = 0;
      if (completed >= 50 && unique >= 10) t = 3;
      else if (completed >= 20 && unique >= 5) t = 2;
      else if (completed >= 5) t = 1;
      const score = tbids === 0 ? 0 : Math.round(
        Math.min(completed / tbids, 1.0) * 700
        + Math.min(unique / 10, 1.0) * 100
        + Math.min(completed / 50, 1.0) * 100
        + (abandoned === 0 ? 100 : 0),
      );
      repStr = `${tier(t)} (executor score=${score}/1000)`;
    } catch {}
    console.log(`  [${i}] ${exec.toBase58().slice(0, 8)}...  price=${price.toFixed(6)} USDC  reputation=${repStr}`);
  }
  console.log("  ────────────────────────────────────────");

  // Select agentB (lowest price)
  const s4Select = await program.methods
    .selectBid(new BN(s4Id))
    .accounts({ delegator: agentA.publicKey, commission: s4CPda, bid: s4BPda })
    .rpc();
  logTx("agentA selects agentB (lowest price)", s4Select);

  // Pay
  const s4Pay = await payUsdc(connection, agentA, agentB.publicKey, s4PriceB);
  logTx("agentA pays agentB 0.12 USDC", s4Pay);

  // Complete
  const s4Complete = await program.methods
    .completeCommission(new BN(s4Id))
    .accounts({
      delegator: agentA.publicKey, commission: s4CPda,
      executor: agentB.publicKey,
      executorReputation: reputationPda(agentB.publicKey),
      delegatorReputation: reputationPda(agentA.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  logTx("agentA completes commission", s4Complete);

  console.log("\n  Final reputation AFTER scenario 4:");
  await logReputation("agentA", program, agentA.publicKey);
  await logReputation("agentB", program, agentB.publicKey);
  await logReputation("agentC", program, agentC.publicKey);

  results.push({
    scenario: "S4: 3-agent competitive flow completes",
    expected: "Full create→bid(×2)→select→pay→complete succeeds",
    observed: `commission #${s4Id} completed, tx=${s4Complete.slice(0, 16)}...`,
    pass: true,
  });

  // ─── Summary table ────────────────────────────────────────────────────────
  separator("Summary");
  console.log(`\n  ${"Scenario".padEnd(50)} ${"Expected".padEnd(40)} ${"Pass"}`);
  console.log(`  ${"─".repeat(50)} ${"─".repeat(40)} ${"─".repeat(4)}`);
  for (const r of results) {
    const p = r.pass ? "✅" : "❌";
    console.log(`  ${r.scenario.padEnd(50)} ${r.expected.padEnd(40)} ${p}`);
    if (!r.pass) console.log(`    observed: ${r.observed}`);
  }

  const allPass = results.every(r => r.pass);
  console.log(`\n  Overall: ${allPass ? "✅ ALL PASS" : "❌ SOME FAILED"}`);
  separator("End of Devnet E2E Reputation Test");
}

main().catch((err) => {
  console.error("\n✗ E2E test failed:", err);
  process.exit(1);
});
