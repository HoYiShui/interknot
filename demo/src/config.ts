import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEMO_DIR = join(__dirname, "..");
export const WALLETS_FILE = join(DEMO_DIR, ".demo-wallets.json");

export const RPC = "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey("G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh");
export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export const EXECUTOR_PORT = 8080;
export const EXECUTOR_ENDPOINT = `http://localhost:${EXECUTOR_PORT}/tasks`;

export const TASK_TYPE = "compute/llm-inference";
export const TASK_SPEC = { model: "llama-3-8b", maxTokens: 512 };
export const MAX_PRICE_USDC = 0.10;  // delegator will pay up to 0.10 USDC
export const BID_PRICE_USDC = 0.03;  // executor bids 0.03 USDC
export const TASK_DEADLINE = "5m";
export const TASK_PROMPT = "Explain what a blockchain is in two sentences.";

export interface DemoWallets {
  agentA: number[]; // delegator
  agentB: number[]; // executor
  agentC: number[]; // optional second executor
}

export function loadWallets(): { agentA: Keypair; agentB: Keypair; agentC: Keypair } {
  if (!existsSync(WALLETS_FILE)) {
    throw new Error(`Wallets file not found. Run 'pnpm --dir demo setup' first.`);
  }
  const data: DemoWallets = JSON.parse(readFileSync(WALLETS_FILE, "utf-8"));
  return {
    agentA: Keypair.fromSecretKey(Uint8Array.from(data.agentA)),
    agentB: Keypair.fromSecretKey(Uint8Array.from(data.agentB)),
    agentC: Keypair.fromSecretKey(Uint8Array.from(data.agentC)),
  };
}

export function saveWallets(wallets: { agentA: Keypair; agentB: Keypair; agentC: Keypair }): void {
  const data: DemoWallets = {
    agentA: Array.from(wallets.agentA.secretKey),
    agentB: Array.from(wallets.agentB.secretKey),
    agentC: Array.from(wallets.agentC.secretKey),
  };
  writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function airdropIfNeeded(
  connection: Connection,
  pubkey: PublicKey,
  minLamports: number = 0.5 * LAMPORTS_PER_SOL,
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance < minLamports) {
    console.log(`  Airdropping 2 SOL to ${pubkey.toBase58().slice(0, 8)}...`);
    const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    await sleep(1000);
  }
}

export function banner(title: string): void {
  const line = "═".repeat(50);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

export function step(n: number, total: number, msg: string): void {
  console.log(`[${n}/${total}] ${msg}`);
}

export function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}
