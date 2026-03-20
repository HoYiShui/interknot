import { Command } from "commander";
import { loadConfig, saveConfig } from "../utils/config.js";
import { printSuccess } from "../utils/display.js";

export function configCommand(): Command {
  const cmd = new Command("config").description("Manage CLI configuration");

  cmd
    .command("show")
    .description("Show current configuration")
    .action(() => {
      const cfg = loadConfig();
      console.log(JSON.stringify(cfg, null, 2));
    });

  cmd
    .command("set")
    .description("Update configuration values")
    .option("--rpc <url>", "Solana RPC URL")
    .option("--keypair <path>", "Path to keypair JSON file")
    .option("--network <devnet|mainnet>", "Network (devnet or mainnet)")
    .option("--program-id <pubkey>", "Program ID override")
    .action((opts) => {
      const patch: Record<string, string> = {};
      if (opts.rpc) patch.rpc = opts.rpc;
      if (opts.keypair) patch.keypair = opts.keypair;
      if (opts.network) patch.network = opts.network;
      if (opts.programId) patch.programId = opts.programId;
      const next = saveConfig(patch);
      printSuccess("Configuration updated");
      console.log(JSON.stringify(next, null, 2));
    });

  return cmd;
}
