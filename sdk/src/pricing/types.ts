export interface PricingContext {
  currentSupplyDemandRatio?: number;
  localHardware?: {
    gpuModel: string;
    vramGb: number;
    gpuPowerWatt: number;
    estimatedTPS: number; // tokens per second for the requested model
  };
  electricityCostPerKwh?: number;
}

export interface PriceEstimate {
  baseCost: number;       // Estimated base cost in USDC
  suggestedPrice: number; // Suggested bid price (cost + profit margin)
  confidence: number;     // 0-1, how confident the estimate is
}

export interface PricingFunction<TSpec> {
  estimate(spec: TSpec, context?: PricingContext): PriceEstimate;
}
