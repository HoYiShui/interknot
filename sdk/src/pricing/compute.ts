import { PricingContext, PriceEstimate, PricingFunction } from "./types.js";

export interface ComputeLlmSpec {
  model: string;
  maxTokens?: number;
}

const KNOWN_MODELS: Record<string, { paramsBillion: number; minVramGb: number; defaultTPS: number }> = {
  "llama-3-8b":           { paramsBillion: 8,  minVramGb: 8,  defaultTPS: 50 },
  "llama-3-8b-instruct":  { paramsBillion: 8,  minVramGb: 8,  defaultTPS: 50 },
  "llama-3-70b":          { paramsBillion: 70, minVramGb: 40, defaultTPS: 12 },
  "llama-3-70b-instruct": { paramsBillion: 70, minVramGb: 40, defaultTPS: 12 },
  "mistral-7b":           { paramsBillion: 7,  minVramGb: 6,  defaultTPS: 55 },
};

/**
 * Reference pricing implementation for compute/llm-inference tasks.
 * Estimates cost based on electricity consumption + fixed overhead.
 * Uses model-specific default TPS when no hardware context is provided.
 */
export function estimateComputeCost(
  spec: ComputeLlmSpec,
  ctx?: PricingContext,
): PriceEstimate {
  const maxTokens = spec.maxTokens ?? 2048;
  const knownModel = KNOWN_MODELS[spec.model];
  // Use caller-provided TPS, then model-specific default, then generic fallback
  const tps = ctx?.localHardware?.estimatedTPS ?? knownModel?.defaultTPS ?? 30;
  const estimatedSeconds = maxTokens / tps;
  const gpuPowerKw = (ctx?.localHardware?.gpuPowerWatt ?? 300) / 1000;
  const electricityRate = ctx?.electricityCostPerKwh ?? 0.12;
  const electricityCost = gpuPowerKw * (estimatedSeconds / 3600) * electricityRate;
  const baseCost = electricityCost + 0.001; // fixed overhead
  const profitMargin = 1.3; // 30% default margin
  return {
    baseCost,
    suggestedPrice: parseFloat((baseCost * profitMargin).toFixed(6)),
    confidence: ctx?.localHardware ? 0.8 : (knownModel ? 0.5 : 0.3),
  };
}

/** Convenience wrapper implementing the PricingFunction interface. */
export const computeLlmPricing: PricingFunction<ComputeLlmSpec> = {
  estimate: estimateComputeCost,
};
