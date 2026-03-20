import { Command } from "commander";
import { startTaskServer, OllamaTaskHandler, estimateComputeCost } from "@inter-knot/sdk";
import { loadKeypair, loadConfig, networkToX402 } from "../utils/config.js";
import { printError } from "../utils/display.js";

export function serveCommand(): Command {
  const cmd = new Command("serve")
    .description("Start the x402 task server (executor side)")
    .option("--port <n>", "Port to listen on", "8080")
    .option("--model <model>", "Model to serve (for auto pricing)", "llama-3-8b")
    .option(
      "--price <usdc|auto>",
      "Task price in USDC, or 'auto' to use pricing function",
      "auto",
    )
    .option("--max-tokens <n>", "Max tokens for auto pricing", "2048")
    .option("--ollama", "Use real Ollama handler instead of mock handler")
    .option("--ollama-url <url>", "Ollama base URL", "http://localhost:11434")
    .option("--facilitator <url>", "x402 facilitator URL")
    .option("--keypair <path>", "Keypair file path")
    .action(async (opts) => {
      try {
        const wallet = loadKeypair(opts.keypair);
        const cfg = loadConfig();
        const port = parseInt(opts.port);
        const network = networkToX402(cfg.network);

        let price: string;
        if (opts.price === "auto") {
          const estimate = estimateComputeCost({
            model: opts.model,
            maxTokens: parseInt(opts.maxTokens),
          });
          price = estimate.suggestedPrice.toFixed(6);
          console.log(`Auto-priced at $${price} USDC (model: ${opts.model})`);
        } else {
          price = opts.price;
        }

        const serverOpts: Parameters<typeof startTaskServer>[0] = {
          wallet,
          port,
          price,
          network,
        };

        if (opts.facilitator) {
          serverOpts.facilitatorUrl = opts.facilitator;
        }

        if (opts.ollama) {
          serverOpts.handler = new OllamaTaskHandler(opts.ollamaUrl);
        }

        const { close } = await startTaskServer(serverOpts);

        process.on("SIGINT", () => {
          console.log("\nShutting down server...");
          close();
          process.exit(0);
        });
      } catch (e: any) {
        printError(e.message);
        process.exit(1);
      }
    });

  return cmd;
}
