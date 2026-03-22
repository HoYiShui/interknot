// Main client
export { InterKnot, InterKnotConfig, PROGRAM_ID, USDC_DECIMALS } from "./client/program.js";
export { usdcToLamports, lamportsToUsdc, parseDeadline } from "./client/program.js";

// Sub-clients
export { CommissionClient } from "./client/commission.js";
export { BidClient } from "./client/bid.js";
export { MatchingClient } from "./client/matching.js";
export { QueryClient } from "./client/query.js";

// Server (executor side)
export { createTaskServer, startTaskServer, TaskServerConfig } from "./server/task-server.js";
export {
  TaskHandler,
  TaskInput,
  TaskOutput,
  MockTaskHandler,
  OllamaTaskHandler,
} from "./server/handlers.js";

// Delivery — x402 (HTTP path)
export { DeliveryClient, DeliveryClientConfig, DeliveryResult, createPaidFetch } from "./delivery/x402-client.js";

// Delivery — on-chain (Irys path)
export { OnChainDeliveryClient, TaskDelivery, DeliveryStatus } from "./delivery/onchain-client.js";
export { IrysDeliveryClient, IrysDeliveryConfig } from "./delivery/irys-client.js";

// Crypto
export { deriveSharedSecret, encrypt, decrypt } from "./crypto/ecdh.js";

// Pricing
export { estimateComputeCost, computeLlmPricing, ComputeLlmSpec } from "./pricing/compute.js";
export { PricingContext, PriceEstimate, PricingFunction } from "./pricing/types.js";

// Types
export {
  Commission,
  CommissionStatus,
  CreateCommissionParams,
  parseCommissionStatus,
} from "./types/commission.js";
export { Bid, BidStatus, parseBidStatus } from "./types/bid.js";
export { TaskSpec, ComputeLlmInferenceSpec } from "./types/task-spec.js";


