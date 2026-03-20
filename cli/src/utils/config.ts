import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";

export interface CliConfig {
  rpc: string;
  keypair: string;
  network: "devnet" | "mainnet";
  programId: string;
}

const CONFIG_DIR = join(homedir(), ".inter-knot");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS: CliConfig = {
  rpc: "https://api.devnet.solana.com",
  keypair: join(homedir(), ".config", "solana", "id.json"),
  network: "devnet",
  programId: "G33455TTFsdoxKHTLHE5MqFjUY8gCPBgZGxJKbAuuYSh",
};

export function loadConfig(): CliConfig {
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(patch: Partial<CliConfig>): CliConfig {
  const current = loadConfig();
  const next = { ...current, ...patch };
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function loadKeypair(keypairPath?: string): Keypair {
  const cfg = loadConfig();
  const resolvedPath = (keypairPath ?? cfg.keypair).replace("~", homedir());
  const raw = JSON.parse(readFileSync(resolvedPath, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Map CLI network name to CAIP-2 x402 network string. */
export function networkToX402(network: CliConfig["network"]): `${string}:${string}` {
  if (network === "mainnet") {
    return "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  }
  return "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // devnet
}
