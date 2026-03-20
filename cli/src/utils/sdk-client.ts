import { Connection, PublicKey } from "@solana/web3.js";
import { InterKnot } from "@inter-knot/sdk";
import { loadConfig, loadKeypair } from "./config.js";

export function buildClient(keypairPath?: string) {
  const cfg = loadConfig();
  const connection = new Connection(cfg.rpc, "confirmed");
  const wallet = loadKeypair(keypairPath);
  const programId = new PublicKey(cfg.programId);
  const client = new InterKnot({ connection, wallet, programId });
  return { client, wallet, cfg };
}
