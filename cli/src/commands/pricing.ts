import { Command } from "commander";
import { estimateComputeCost } from "@inter-knot/sdk";

export function pricingCommand(): Command {
  const cmd = new Command("pricing").description("Pricing utilities");

  cmd
    .command("estimate")
    .description("Estimate task pricing using the reference compute pricing function")
    .requiredOption("--model <model>", "Model name (e.g. llama-3-8b, llama-3-70b)")
    .option("--max-tokens <n>", "Maximum tokens to generate", "2048")
    .option("--tps <n>", "Estimated tokens per second for your hardware", "30")
    .option("--gpu-power <watts>", "GPU power consumption in watts", "300")
    .option("--electricity <rate>", "Electricity cost per kWh (USD)", "0.12")
    .action((opts) => {
      const maxTokens = parseInt(opts.maxTokens);
      const tps = parseInt(opts.tps);
      const gpuPowerWatt = parseInt(opts.gpuPower);
      const electricityCostPerKwh = parseFloat(opts.electricity);

      const estimate = estimateComputeCost(
        { model: opts.model, maxTokens },
        {
          localHardware: {
            gpuModel: "custom",
            vramGb: 0,
            gpuPowerWatt,
            estimatedTPS: tps,
          },
          electricityCostPerKwh,
        },
      );

      console.log(`\nPricing Estimate for ${opts.model} (${maxTokens} tokens)`);
      console.log("─────────────────────────────────────────");
      console.log(`  Base Cost:       $${estimate.baseCost.toFixed(6)} USDC`);
      console.log(`  Suggested Price: $${estimate.suggestedPrice.toFixed(6)} USDC`);
      console.log(`  Confidence:      ${(estimate.confidence * 100).toFixed(0)}%`);
      console.log("");
    });

  return cmd;
}
