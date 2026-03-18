// Main client
export { InterKnot, InterKnotConfig, PROGRAM_ID, USDC_DECIMALS } from "./client/program";
export { usdcToLamports, lamportsToUsdc, parseDeadline } from "./client/program";

// Sub-clients
export { CommissionClient } from "./client/commission";
export { BidClient } from "./client/bid";
export { MatchingClient } from "./client/matching";
export { QueryClient } from "./client/query";

// Types
export {
  Commission,
  CommissionStatus,
  CreateCommissionParams,
  parseCommissionStatus,
} from "./types/commission";
export { Bid, BidStatus, parseBidStatus } from "./types/bid";
export { TaskSpec, ComputeLlmInferenceSpec } from "./types/task-spec";
