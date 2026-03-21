// Main client
export { InterKnot, InterKnotConfig, PROGRAM_ID, USDC_DECIMALS } from "./client/program";
export { usdcToLamports, lamportsToUsdc, parseDeadline } from "./client/program";

// Sub-clients
export { CommissionClient } from "./client/commission";
export { BidClient } from "./client/bid";
export { MatchingClient } from "./client/matching";
export { QueryClient } from "./client/query";

// Server (executor side)
export { createTaskServer, startTaskServer, TaskServerConfig } from "./server/task-server";
export {
  TaskHandler,
  TaskInput,
  TaskOutput,
  MockTaskHandler,
  OllamaTaskHandler,
} from "./server/handlers";

// Delivery — x402 (HTTP path)
export { DeliveryClient, DeliveryClientConfig, DeliveryResult, createPaidFetch } from "./delivery/x402-client";

// Delivery — on-chain (Irys path)
export { OnChainDeliveryClient, TaskDelivery, DeliveryStatus } from "./delivery/onchain-client";
export { IrysDeliveryClient, IrysDeliveryConfig } from "./delivery/irys-client";

// Crypto
export { deriveSharedSecret, encrypt, decrypt } from "./crypto/ecdh";

// Pricing
export { estimateComputeCost, computeLlmPricing, ComputeLlmSpec } from "./pricing/compute";
export { PricingContext, PriceEstimate, PricingFunction } from "./pricing/types";

// Types
export {
  Commission,
  CommissionStatus,
  CreateCommissionParams,
  parseCommissionStatus,
} from "./types/commission";
export { Bid, BidStatus, parseBidStatus } from "./types/bid";
export { TaskSpec, ComputeLlmInferenceSpec } from "./types/task-spec";

