# Inter-Knot Technical Architecture

> This document is the single source of truth for implementing Inter-Knot.
> It is designed to be self-contained — an implementor should be able to build
> the entire project from this document alone, without access to prior conversations.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Design Decisions Summary](#2-design-decisions-summary)
3. [System Architecture](#3-system-architecture)
4. [Solana Program Design](#4-solana-program-design)
5. [SDK Design](#5-sdk-design)
6. [CLI Design](#6-cli-design)
7. [x402 Integration](#7-x402-integration)
8. [Pluggable Task Type System](#8-pluggable-task-type-system)
9. [Demo Flow](#9-demo-flow)
10. [Project Structure](#10-project-structure)
11. [Development Plan](#11-development-plan)
12. [Configuration & Constants](#12-configuration--constants)
13. [Hackathon Deliverables](#13-hackathon-deliverables)
14. [Future Work (Post-MVP)](#14-future-work-post-mvp)

---

## 1. Project Overview

### What is Inter-Knot?

Inter-Knot (绳网) is an **agent-native general-purpose trading/matching protocol on Solana**. It enables AI agents to autonomously publish task requests, bid on tasks, match with counterparts, and settle payments — all without human intervention.

The name comes from the game Zenless Zone Zero (绝区零) — a network of "knots" (agents) connected by threads (transactions).

### Core Thesis

> "Solana's deflation cannot be achieved through human behavior alone. Only autonomous economic behavior by AI agents can generate sufficient transaction volume."

Agents make decisions faster than humans by orders of magnitude. If agents become economic actors, the transaction volume they produce could far exceed human-generated volume. Inter-Knot provides the economic infrastructure that enables this.

### What Inter-Knot Does (and Does Not Do)

**Inter-Knot IS:**
- An on-chain RFQ (Request for Quote) auction protocol
- A matching layer: publish tasks, collect bids, select winner
- Task-type agnostic: the core protocol doesn't care what is being traded

**Inter-Knot IS NOT:**
- A payment processor (x402 handles payments after matching)
- An identity/reputation system (deferred to phase 2)
- An escrow service (x402's pay-for-result model provides basic protection)

### Protocol Flow (Big Picture)

```
┌──────────────────────────────────────────────────┐
│           Inter-Knot (On-Chain, Solana)           │
│                                                   │
│  1. Delegator creates Commission (task + price)   │
│  2. Executors submit Bids (price + endpoint)      │
│  3. Delegator selects winning Bid                 │
│  4. Status → Matched                              │
│                                                   │
└───────────────────────┬──────────────────────────┘
                        │ Matching complete
                        ▼
┌──────────────────────────────────────────────────┐
│              P2P Delivery (Off-Chain, x402)        │
│                                                   │
│  5. Delegator POST task details to Executor       │
│  6. Executor returns HTTP 402 (payment required)  │
│  7. Delegator pays USDC via x402                  │
│  8. Executor runs computation, returns result     │
│                                                   │
└───────────────────────┬──────────────────────────┘
                        │ Delivery complete
                        ▼
┌──────────────────────────────────────────────────┐
│         Record Keeping (On-Chain, Solana)          │
│                                                   │
│  9. Delegator marks Commission as Completed       │
│                                                   │
└──────────────────────────────────────────────────┘
```

### Referenced Protocol Standards

Inter-Knot's design is informed by three existing standards:

| Standard | What It Defines | How Inter-Knot Uses It |
|----------|----------------|----------------------|
| **ERC-8183** (Agentic Commerce) | Job primitive with Client/Provider/Evaluator, escrow, state machine | Reference for Commission state machine. Simplified: no Evaluator, no Hooks, no escrow in MVP |
| **ERC-8004** (Trustless Agents) | On-chain identity, reputation, validation registries | Reference for future reputation system (phase 2). MVP: wallet address = identity |
| **x402** (Payment Required) | HTTP-native payments via HTTP 402 status code, USDC on Solana | Direct integration for post-matching P2P payment and delivery |

---

## 2. Design Decisions Summary

All decisions were made during collaborative design sessions (2026-03-13 to 2026-03-17).

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Fully on-chain (no off-chain indexer) | Maximally decentralized; Solana fees are negligible |
| Matching model | On-chain RFQ (Request for Quote) | Simpler than CLOB; natural fit for task-based trading |
| On-chain data | Public info only (task specs + bids) | Private data (actual prompts) sent via x402 after matching |
| Bid selection | Chain provides data, delegator selects | Delegator may weigh price + reputation; more flexible than auto-select |
| Escrow | None in MVP | x402 pay-for-result provides basic protection |
| Settlement token | USDC | x402 on Solana natively supports USDC; price stability |
| x402 role | Post-matching P2P delivery and payment only | Not involved in the matching/auction process |
| Reputation system | Deferred to phase 2 | x402 provides basic protection; focus MVP on core matching |
| Evaluator role | Deferred to phase 2 | Same as above |
| Pricing function | SDK helper, not protocol-level | Protocol only sees bid prices; how agents calculate them is their business |
| Agent identity | Wallet address = agent (MVP) | Simplest possible; phase 2 can add a registry |
| Task type system | Pluggable via task_type string + opaque task_spec | Core protocol is agnostic; interpretation happens in SDK plugins |
| Demo task | LLM inference via Ollama | Compelling real-world use case; mock mode for testing |

---

## 3. System Architecture

### Two-Layer Architecture

```
┌──────────────────────────────────────────────────┐
│          Inter-Knot 绳网 (Matching Layer)         │
│                                                   │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Commission  │ │   Bidding   │ │   Matching   │  │
│  │  Publishing │ │  Collection │ │  Selection   │  │
│  └────────────┘ └────────────┘ └──────────────┘  │
│               Solana (fully on-chain)             │
└──────────────────────┬───────────────────────────┘
                       │ match success
                       ▼
┌──────────────────────────────────────────────────┐
│            P2P Layer (Execution Layer)             │
│                                                   │
│  ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │   Task      │ │   Data     │ │   x402       │  │
│  │  Handshake  │ │  Transfer  │ │  Settlement  │  │
│  └────────────┘ └────────────┘ └──────────────┘  │
│                   Peer-to-peer                    │
└──────────────────────────────────────────────────┘
```

### Roles

| Role | Description |
|------|-------------|
| **Delegator** | Agent that needs a task done. Creates Commissions, selects Bids, pays via x402. |
| **Executor** | Agent that can do the task. Submits Bids, runs an x402 HTTP server, delivers results. |
| **Inter-Knot** | The on-chain protocol. Stores Commissions and Bids, records matches. |

### Data Flow

```
         On-Chain                    Off-Chain
    ┌─────────────────┐      ┌─────────────────────┐
    │                 │      │                     │
    │  Commission     │      │  task_spec.json     │
    │  ┌───────────┐  │      │  (full task details) │
    │  │task_type   │  │      │  stored at URI      │
    │  │spec_hash   │──┼──────│  (IPFS or HTTP)     │
    │  │spec_uri    │  │      │                     │
    │  │max_price   │  │      └─────────────────────┘
    │  │deadline    │  │
    │  │status      │  │      ┌─────────────────────┐
    │  └───────────┘  │      │                     │
    │                 │      │  Actual task input   │
    │  Bid            │      │  (prompts, data)     │
    │  ┌───────────┐  │      │  sent via x402 POST  │
    │  │executor    │  │      │  NEVER on-chain     │
    │  │price       │  │      │                     │
    │  │endpoint   ─┼──┼──────│  service_endpoint   │
    │  └───────────┘  │      │  (executor's HTTP)   │
    │                 │      │                     │
    └─────────────────┘      └─────────────────────┘
```

---

## 4. Solana Program Design

### Framework

- **Anchor** (0.30+) — Rust-based Solana development framework
- Program ID: to be generated on first `anchor build`

### Account Types

#### 4.1 PlatformConfig (Singleton)

```
PDA seed: ["inter_knot_config"]

Fields:
  authority: Pubkey          // Admin (deployer). Can update config.
  commission_count: u64      // Auto-incrementing counter for commission IDs
  usdc_mint: Pubkey          // USDC SPL token mint address
  platform_fee_bps: u16      // Platform fee in basis points. MVP: 0
  bump: u8                   // PDA bump seed

Estimated size: ~83 bytes
Rent: ~0.001 SOL
```

#### 4.2 Commission

```
PDA seed: ["commission", commission_id.to_le_bytes()]

Fields:
  commission_id: u64                // Unique ID (from config.commission_count)
  delegator: Pubkey                 // Creator's wallet
  task_type: String (max 32)        // e.g. "compute/llm-inference"
  task_spec_hash: [u8; 32]          // SHA-256 of the full task_spec JSON
  task_spec_uri: String (max 128)   // URI pointing to full task_spec JSON
  max_price: u64                    // Maximum price in USDC (6 decimals, so 1_000_000 = 1 USDC)
  deadline: i64                     // Bidding deadline (Unix timestamp)
  status: u8                        // 0=Open, 1=Matched, 2=Completed, 3=Cancelled, 4=Expired
  selected_executor: Option<Pubkey> // Winning executor's wallet (set on match)
  selected_bid_price: Option<u64>   // Winning bid price (set on match)
  bid_count: u32                    // Number of active bids
  created_at: i64                   // Creation timestamp
  matched_at: Option<i64>           // When match was made
  completed_at: Option<i64>         // When marked complete
  bump: u8

Estimated size: ~350 bytes
Rent: ~0.003 SOL
```

#### 4.3 Bid

```
PDA seed: ["bid", commission_id.to_le_bytes(), executor.key()]

Fields:
  commission_id: u64            // Which commission this bid is for
  executor: Pubkey              // Bidder's wallet
  price: u64                    // Bid price in USDC (6 decimals)
  service_endpoint: String (max 128)  // HTTP endpoint for x402 delivery
  status: u8                    // 0=Active, 1=Selected, 2=Withdrawn
  created_at: i64
  bump: u8

Estimated size: ~210 bytes
Rent: ~0.002 SOL
```

**Key constraint:** PDA seed includes both `commission_id` and `executor`, so one executor can only submit one bid per commission. This is enforced by Solana's account model — attempting to create a duplicate PDA will fail.

### Instructions

#### 4.4 initialize

```rust
pub fn initialize(ctx: Context<Initialize>, usdc_mint: Pubkey) -> Result<()>
```
- Creates PlatformConfig account
- Sets `authority = signer`, `commission_count = 0`, `usdc_mint`, `platform_fee_bps = 0`
- Can only be called once (PDA already exists after first call)

**Accounts:**
- `authority` (signer, mut) — pays for account creation
- `config` (init, PDA) — the config account being created
- `system_program`

#### 4.5 create_commission

```rust
pub fn create_commission(
    ctx: Context<CreateCommission>,
    task_type: String,
    task_spec_hash: [u8; 32],
    task_spec_uri: String,
    max_price: u64,
    deadline: i64,
) -> Result<()>
```
- Reads and increments `config.commission_count`
- Creates Commission account with `status = Open`
- **Validations:**
  - `task_type.len() <= 32`
  - `task_spec_uri.len() <= 128`
  - `max_price > 0`
  - `deadline > Clock::get().unix_timestamp`

**Accounts:**
- `delegator` (signer, mut) — the task requester, pays rent
- `config` (mut) — to increment commission_count
- `commission` (init, PDA) — the new commission
- `system_program`

#### 4.6 submit_bid

```rust
pub fn submit_bid(
    ctx: Context<SubmitBid>,
    commission_id: u64,
    price: u64,
    service_endpoint: String,
) -> Result<()>
```
- Creates Bid account with `status = Active`
- Increments `commission.bid_count`
- **Validations:**
  - `commission.status == Open`
  - `price > 0 && price <= commission.max_price`
  - `Clock::get().unix_timestamp < commission.deadline`
  - `service_endpoint.len() <= 128`
  - executor != delegator (can't bid on your own commission)

**Accounts:**
- `executor` (signer, mut) — the bidder, pays rent
- `commission` (mut) — to increment bid_count
- `bid` (init, PDA) — the new bid
- `system_program`

#### 4.7 select_bid

```rust
pub fn select_bid(
    ctx: Context<SelectBid>,
    commission_id: u64,
    executor: Pubkey,
) -> Result<()>
```
- Sets `commission.status = Matched`
- Sets `commission.selected_executor = Some(executor)`
- Sets `commission.selected_bid_price = Some(bid.price)`
- Sets `commission.matched_at = Some(now)`
- Sets `bid.status = Selected`
- **Validations:**
  - `commission.status == Open`
  - signer == `commission.delegator`
  - `bid.status == Active`

**Accounts:**
- `delegator` (signer) — must be the commission creator
- `commission` (mut)
- `bid` (mut) — the selected bid

#### 4.8 complete_commission

```rust
pub fn complete_commission(
    ctx: Context<CompleteCommission>,
    commission_id: u64,
) -> Result<()>
```
- Sets `commission.status = Completed`
- Sets `commission.completed_at = Some(now)`
- **Validations:**
  - `commission.status == Matched`
  - signer == `commission.delegator`

**Note:** This is a record-keeping instruction only. The actual payment has already been settled via x402 off-chain. This on-chain record enables future analytics and reputation scoring.

**Accounts:**
- `delegator` (signer)
- `commission` (mut)

#### 4.9 cancel_commission

```rust
pub fn cancel_commission(
    ctx: Context<CancelCommission>,
    commission_id: u64,
) -> Result<()>
```
- Sets `commission.status = Cancelled`
- **Validations:**
  - `commission.status == Open`
  - signer == `commission.delegator`

**Accounts:**
- `delegator` (signer)
- `commission` (mut)

#### 4.10 withdraw_bid

```rust
pub fn withdraw_bid(
    ctx: Context<WithdrawBid>,
    commission_id: u64,
) -> Result<()>
```
- Sets `bid.status = Withdrawn`
- Decrements `commission.bid_count`
- **Validations:**
  - `bid.status == Active`
  - signer == `bid.executor`

**Accounts:**
- `executor` (signer)
- `commission` (mut)
- `bid` (mut)

### State Machine Diagram

```
Commission States:
                    ┌─────────────┐
                    │    Open     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Matched  │ │Cancelled │ │ Expired  │
        └────┬─────┘ └──────────┘ └──────────┘
             ▼
        ┌──────────┐
        │Completed │
        └──────────┘

Bid States:
        ┌──────────┐
        │  Active  │
        └────┬─────┘
             │
        ┌────┴────┐
        ▼         ▼
  ┌──────────┐ ┌───────────┐
  │ Selected │ │ Withdrawn │
  └──────────┘ └───────────┘
```

### Error Codes

```rust
#[error_code]
pub enum InterKnotError {
    #[msg("Commission is not in Open status")]
    CommissionNotOpen,
    #[msg("Commission is not in Matched status")]
    CommissionNotMatched,
    #[msg("Bid price exceeds maximum price")]
    BidPriceTooHigh,
    #[msg("Bidding deadline has passed")]
    DeadlinePassed,
    #[msg("Deadline must be in the future")]
    DeadlineNotFuture,
    #[msg("Only the delegator can perform this action")]
    UnauthorizedDelegator,
    #[msg("Only the executor can perform this action")]
    UnauthorizedExecutor,
    #[msg("Cannot bid on your own commission")]
    SelfBidNotAllowed,
    #[msg("Bid is not in Active status")]
    BidNotActive,
    #[msg("Task type exceeds maximum length")]
    TaskTypeTooLong,
    #[msg("Task spec URI exceeds maximum length")]
    TaskSpecUriTooLong,
    #[msg("Service endpoint exceeds maximum length")]
    ServiceEndpointTooLong,
    #[msg("Price must be greater than zero")]
    PriceZero,
}
```

---

## 5. SDK Design

### Package: `@inter-knot/sdk` (TypeScript)

```
sdk/src/
├── client/
│   ├── program.ts          // Anchor Program connection and initialization
│   ├── commission.ts       // Commission CRUD operations
│   ├── bid.ts              // Bid CRUD operations
│   ├── matching.ts         // Bid selection and commission completion
│   └── query.ts            // getProgramAccounts queries + client-side sorting
├── server/
│   ├── task-server.ts      // Executor HTTP server (Hono framework)
│   └── handlers.ts         // Task execution handlers (mock + real)
├── delivery/
│   └── x402-client.ts      // x402 fetch wrapper for delegator-side delivery
├── pricing/
│   ├── types.ts            // PricingFunction interface
│   └── compute.ts          // Compute pricing reference implementation
├── types/
│   ├── commission.ts       // Commission TypeScript types
│   ├── bid.ts              // Bid TypeScript types
│   └── task-spec.ts        // TaskSpec interface (pluggable)
└── index.ts                // Unified exports
```

### Core SDK API

#### Commission Operations (Delegator)

```typescript
class CommissionClient {
  // Create a new commission
  async create(params: {
    taskType: string;
    taskSpec: Record<string, any>;       // Will be JSON-serialized, hashed, and stored at URI
    maxPrice: number;                     // In USDC (e.g., 0.50)
    deadline: string | number;            // "5m", "1h", or Unix timestamp
  }): Promise<{ commissionId: number; txSignature: string }>;

  // List commissions with optional filters
  async list(filters?: {
    status?: "open" | "matched" | "completed" | "cancelled" | "expired";
    taskType?: string;
    delegator?: PublicKey;
    maxPriceGte?: number;                 // Only show commissions with max_price >= this
  }): Promise<Commission[]>;

  // Get a single commission by ID
  async get(commissionId: number): Promise<Commission>;

  // Cancel an open commission
  async cancel(commissionId: number): Promise<{ txSignature: string }>;

  // Mark a matched commission as completed
  async complete(commissionId: number): Promise<{ txSignature: string }>;

  // Watch for new commissions (polling-based)
  watch(params: {
    taskType?: string;
    maxPriceGte?: number;
    pollIntervalMs?: number;             // Default: 2000
    onNew: (commission: Commission) => void | Promise<void>;
  }): { stop: () => void };
}
```

#### Bid Operations (Executor)

```typescript
class BidClient {
  // Submit a bid for a commission
  async submit(commissionId: number, params: {
    price: number;                        // In USDC
    serviceEndpoint: string;              // HTTP endpoint for x402 delivery
  }): Promise<{ txSignature: string }>;

  // List all bids for a commission (sorted by price ascending)
  async listForCommission(commissionId: number, options?: {
    sortBy?: "price" | "createdAt";
    order?: "asc" | "desc";
    statusFilter?: "active" | "selected" | "withdrawn";
  }): Promise<Bid[]>;

  // Withdraw a bid
  async withdraw(commissionId: number): Promise<{ txSignature: string }>;
}
```

#### Matching Operations

```typescript
class MatchingClient {
  // Select a winning bid
  async selectBid(commissionId: number, executor: PublicKey): Promise<{ txSignature: string }>;
}
```

#### Delivery (x402 Client Wrapper)

```typescript
class DeliveryClient {
  // Send task to executor's endpoint with automatic x402 payment
  async requestWithPayment<TInput, TOutput>(
    serviceEndpoint: string,
    taskInput: TInput,
  ): Promise<{ result: TOutput; paymentTxHash: string }>;
}
```

#### Query Utilities

```typescript
class QueryClient {
  // Get all open commissions, sorted
  async getOpenCommissions(options?: {
    taskType?: string;
    sortBy?: "maxPrice" | "deadline" | "createdAt";
    order?: "asc" | "desc";
  }): Promise<Commission[]>;

  // Get bids for a commission, sorted by price
  async getBidsSortedByPrice(commissionId: number): Promise<Bid[]>;

  // Get commission statistics
  async getStats(): Promise<{
    totalCommissions: number;
    openCommissions: number;
    matchedCommissions: number;
    completedCommissions: number;
  }>;
}
```

### SDK Initialization

```typescript
import { InterKnot } from "@inter-knot/sdk";
import { Connection, Keypair } from "@solana/web3.js";

const interKnot = new InterKnot({
  connection: new Connection("https://api.devnet.solana.com"),
  wallet: loadedKeypair,      // Solana keypair
  programId: INTER_KNOT_PROGRAM_ID,
});

// Access sub-clients
interKnot.commission.create(...)
interKnot.bid.submit(...)
interKnot.matching.selectBid(...)
interKnot.delivery.requestWithPayment(...)
interKnot.query.getOpenCommissions(...)
```

---

## 6. CLI Design

### Package: `@inter-knot/cli`

Built with `commander.js`, wraps the SDK.

### Commands

```bash
# ═══════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════
inter-knot config set --rpc <url> --keypair <path> --network <devnet|mainnet>
inter-knot config show

# ═══════════════════════════════════════════
# Commission (Delegator side)
# ═══════════════════════════════════════════

# Create a new commission
inter-knot commission create \
  --task-type "compute/llm-inference" \
  --spec '{"model":"llama-3-70b","maxTokens":4096}' \
  --max-price 0.50 \
  --deadline 5m

# List commissions
inter-knot commission list [--status open] [--task-type compute/llm-inference]

# Cancel a commission
inter-knot commission cancel <commission-id>

# Mark commission as completed
inter-knot commission complete <commission-id>

# ═══════════════════════════════════════════
# Bid (Executor side)
# ═══════════════════════════════════════════

# List bids for a commission
inter-knot bid list <commission-id> [--sort price]

# Submit a bid
inter-knot bid submit <commission-id> \
  --price 0.35 \
  --endpoint "https://my-agent:8080/tasks"

# Withdraw a bid
inter-knot bid withdraw <commission-id>

# ═══════════════════════════════════════════
# Matching
# ═══════════════════════════════════════════

# Select a winning bid
inter-knot match select <commission-id> --executor <pubkey>

# ═══════════════════════════════════════════
# Executor Task Server
# ═══════════════════════════════════════════

# Start x402 task server (executor runs this)
inter-knot serve --port 8080 --model llama-3-8b --price auto
# --price auto: uses the pricing function to calculate
# --price 0.35: fixed price override

# ═══════════════════════════════════════════
# Utilities
# ═══════════════════════════════════════════

# Estimate pricing for a task
inter-knot pricing estimate --model llama-3-70b --max-tokens 4096

# Deliver task via x402 (usually called by SDK, but available as CLI)
inter-knot deliver <service-endpoint> --input '{"prompt":"...","model":"llama-3-8b"}'
```

### Config File

Stored at `~/.inter-knot/config.json`:

```json
{
  "rpc": "https://api.devnet.solana.com",
  "keypair": "~/.config/solana/id.json",
  "network": "devnet",
  "programId": "<deployed_program_id>"
}
```

---

## 7. x402 Integration

### Where x402 Fits

x402 is used **exclusively** for post-matching P2P delivery and payment. It is NOT involved in the on-chain matching/auction process.

### Executor Side (Server)

The executor runs an HTTP server using Hono with x402 middleware:

```typescript
import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";

const app = new Hono();

// x402-protected task execution endpoint
app.post("/tasks",
  paymentMiddleware({
    price: "0.35",                              // USDC
    payTo: executorWalletAddress,                // Executor's USDC address
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // Devnet
    facilitator: "https://x402.org/facilitator", // Coinbase hosted
  }),
  async (c) => {
    const input = await c.req.json();
    // Execute the compute task
    const result = await executeTask(input);
    return c.json({ output: result });
  }
);

// Health check (not paywalled)
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
```

### Delegator Side (Client)

The delegator uses the x402 fetch wrapper:

```typescript
import { wrapFetchWithPayment } from "@inter-knot/sdk/delivery";

const paidFetch = wrapFetchWithPayment({
  wallet: delegatorKeypair,
  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
});

// This automatically handles the 402 → pay → retry flow
const response = await paidFetch(executorEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt: "Analyze this financial report...",
    model: "llama-3-8b",
    maxTokens: 1024,
  }),
});

const result = await response.json();
// result = { output: "The report shows..." }
```

### Payment Sequence

```
Delegator                    Executor Server              x402 Facilitator
    │                              │                            │
    │  POST /tasks {input}         │                            │
    │─────────────────────────────→│                            │
    │                              │                            │
    │  HTTP 402                    │                            │
    │  {price:"0.35", payTo:"...", │                            │
    │   network:"solana:...",      │                            │
    │   scheme:"exact"}            │                            │
    │←─────────────────────────────│                            │
    │                              │                            │
    │  [SDK signs USDC payment]    │                            │
    │                              │                            │
    │  POST /tasks {input}         │                            │
    │  + X-PAYMENT header          │                            │
    │─────────────────────────────→│                            │
    │                              │ POST /verify {payment}     │
    │                              │───────────────────────────→│
    │                              │                            │
    │                              │ {valid: true}              │
    │                              │←───────────────────────────│
    │                              │                            │
    │                              │ [execute task]             │
    │                              │                            │
    │                              │ POST /settle {payment}     │
    │                              │───────────────────────────→│
    │                              │                            │
    │                              │ {txHash: "..."}            │
    │                              │←───────────────────────────│
    │                              │                            │
    │  HTTP 200 {output: "..."}    │                            │
    │←─────────────────────────────│                            │
    │                              │                            │
```

### x402 Package Dependencies

```
@x402/core    - Core types and utilities
@x402/svm     - Solana-specific payment signing and verification
@x402/hono    - Hono middleware (executor server)
@x402/fetch   - Fetch wrapper (delegator client) — OR implement manually
```

---

## 8. Pluggable Task Type System

### Design Principle

The core protocol treats `task_type` as an opaque string and `task_spec` as opaque bytes (hash on-chain, full JSON off-chain). The protocol does not parse, validate, or interpret task content. All interpretation happens in SDK-level plugins.

### Plugin Architecture

```
Core Protocol (task-type agnostic)
├── Commission: { task_type: string, task_spec_hash, task_spec_uri, ... }
├── Bid: { price, service_endpoint, ... }
└── Does NOT know what "compute/llm-inference" means

SDK Plugins (task-type specific)
├── compute/llm-inference
│   ├── Task Spec Schema
│   ├── Pricing Function
│   └── Delivery Handler (Ollama integration)
├── compute/image-generation (future)
│   ├── Task Spec Schema
│   ├── Pricing Function
│   └── Delivery Handler (Stable Diffusion)
└── capability/analysis (future)
    ├── Task Spec Schema
    ├── Pricing Function
    └── Delivery Handler
```

### Adding a New Task Type

To support a new type of tradeable task, an implementor needs to provide:

1. **Task Spec Schema** — what fields describe this type of work
2. **Pricing Function** — how to estimate cost
3. **Delivery Handler** — how the executor processes and returns results

No changes to the Solana Program are needed.

### Task Spec Schema: compute/llm-inference

Stored off-chain (at `task_spec_uri`), hash on-chain (`task_spec_hash`):

```json
{
  "type": "compute/llm-inference",
  "version": "0.1.0",
  "spec": {
    "model": "meta-llama/Llama-3-70B",
    "maxTokens": 4096,
    "temperature": 0.7
  },
  "requirements": {
    "minVramGb": 40,
    "maxLatencyMs": 30000
  }
}
```

**Note:** The actual prompt/input is NOT in the task spec. It is sent via x402 POST after matching. The task spec only describes what KIND of computation is needed, so executors can assess whether they can do it and at what cost.

### Pricing Function Interface

```typescript
interface PricingFunction<TSpec> {
  estimate(spec: TSpec, context?: PricingContext): PriceEstimate;
}

interface PricingContext {
  currentSupplyDemandRatio?: number;
  localHardware?: {
    gpuModel: string;
    vramGb: number;
    gpuPowerWatt: number;
    estimatedTPS: number;      // tokens per second for the requested model
  };
  electricityCostPerKwh?: number;
}

interface PriceEstimate {
  baseCost: number;            // Estimated base cost in USDC
  suggestedPrice: number;      // Suggested bid price (cost + profit margin)
  confidence: number;          // 0-1, how confident the estimate is
}
```

### Reference Implementation: compute/llm-inference Pricing

```typescript
const KNOWN_MODELS: Record<string, { paramsBillion: number; minVramGb: number }> = {
  "llama-3-8b":  { paramsBillion: 8,  minVramGb: 8 },
  "llama-3-70b": { paramsBillion: 70, minVramGb: 40 },
  // extensible...
};

function estimateComputeCost(spec: ComputeTaskSpec, ctx?: PricingContext): PriceEstimate {
  const model = KNOWN_MODELS[spec.model];
  const maxTokens = spec.maxTokens ?? 2048;
  const tps = ctx?.localHardware?.estimatedTPS ?? 30;
  const estimatedSeconds = maxTokens / tps;
  const gpuPowerKw = (ctx?.localHardware?.gpuPowerWatt ?? 300) / 1000;
  const electricityRate = ctx?.electricityCostPerKwh ?? 0.12;
  const electricityCost = gpuPowerKw * (estimatedSeconds / 3600) * electricityRate;
  const baseCost = electricityCost + 0.001; // fixed overhead
  const profitMargin = 1.3; // 30% default margin
  return {
    baseCost,
    suggestedPrice: baseCost * profitMargin,
    confidence: ctx?.localHardware ? 0.8 : 0.3,
  };
}
```

This is a reference. Agents can use it, modify it, or ignore it entirely.

---

## 9. Demo Flow

### End-to-End Demo (Target: 30 seconds)

```
T+0s   Agent A (Delegator)
       ├── Needs LLM inference but lacks GPU power
       └── inter-knot commission create \
             --task-type "compute/llm-inference" \
             --spec '{"model":"llama-3-8b","maxTokens":1024}' \
             --max-price 0.50 --deadline 5m
           → On-chain tx #1: CreateCommission

T+3s   Agent B (Executor)
       ├── Watcher detects new commission
       ├── Fetches task_spec, verifies hash
       ├── Runs pricing estimate → cost=0.02, suggested=0.03
       └── inter-knot bid submit <id> --price 0.03 \
             --endpoint "http://localhost:8080/tasks"
           → On-chain tx #2: SubmitBid

T+5s   Agent C (Another Executor, optional)
       └── Submits a competing bid at 0.05
           → On-chain tx #3: SubmitBid

T+8s   Agent A
       ├── Queries bids, sees B=0.03, C=0.05
       ├── Selects Agent B (lowest price)
       └── inter-knot match select <id> --executor <B_pubkey>
           → On-chain tx #4: SelectBid

T+10s  Agent A → Agent B (x402 P2P)
       ├── POST http://localhost:8080/tasks
       │   body: { prompt: "Explain quantum computing", ... }
       ├── Receives HTTP 402
       ├── x402 auto-pays 0.03 USDC
       └── Receives 200 OK + inference result

T+25s  Agent A
       └── inter-knot commission complete <id>
           → On-chain tx #5: CompleteCommission

TOTAL: 5 on-chain transactions + 1 USDC payment via x402
```

### Two Demo Modes

**Mock Mode** (for development/testing):
- Executor handler: `sleep(1000)` then returns hard-coded result
- No GPU needed
- Tests the full on-chain + x402 flow without real compute

**Real Mode** (for hackathon presentation):
- Executor runs Ollama with `llama-3-8b` model
- Real inference, real results
- Requires ~8GB VRAM (most modern GPUs)

### Demo Directory Structure

```
demo/
├── setup.ts          // Deploy program, create wallets, airdrop SOL/USDC
├── agent-a.ts        // Delegator agent script
├── agent-b.ts        // Executor agent script (+ starts task server)
├── agent-c.ts        // Optional second executor
├── mock-demo.sh      // One-command: start mock demo end-to-end
└── real-demo.sh      // One-command: start real demo with Ollama
```

### Setup Script (setup.ts)

1. `anchor deploy` to devnet (or localnet)
2. Generate 2-3 keypairs (Agent A, B, C)
3. Airdrop devnet SOL to each
4. Mint or transfer devnet USDC to Agent A (delegator needs USDC to pay)
5. Call `initialize()` on the program
6. Print wallet addresses and balances

---

## 10. Project Structure

```
inter-knot/
├── programs/
│   └── inter-knot/
│       ├── src/
│       │   ├── lib.rs                    // Program entry point, declare_id!
│       │   ├── state/
│       │   │   ├── mod.rs
│       │   │   ├── config.rs             // PlatformConfig account
│       │   │   ├── commission.rs         // Commission account + CommissionStatus enum
│       │   │   └── bid.rs                // Bid account + BidStatus enum
│       │   ├── instructions/
│       │   │   ├── mod.rs
│       │   │   ├── initialize.rs
│       │   │   ├── create_commission.rs
│       │   │   ├── submit_bid.rs
│       │   │   ├── select_bid.rs
│       │   │   ├── complete_commission.rs
│       │   │   ├── cancel_commission.rs
│       │   │   └── withdraw_bid.rs
│       │   └── errors.rs                 // InterKnotError enum
│       ├── Cargo.toml
│       └── Xargo.toml
├── sdk/
│   ├── src/
│   │   ├── client/
│   │   │   ├── program.ts
│   │   │   ├── commission.ts
│   │   │   ├── bid.ts
│   │   │   ├── matching.ts
│   │   │   └── query.ts
│   │   ├── server/
│   │   │   ├── task-server.ts
│   │   │   └── handlers.ts
│   │   ├── delivery/
│   │   │   └── x402-client.ts
│   │   ├── pricing/
│   │   │   ├── types.ts
│   │   │   └── compute.ts
│   │   ├── types/
│   │   │   ├── commission.ts
│   │   │   ├── bid.ts
│   │   │   └── task-spec.ts
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── cli/
│   ├── src/
│   │   ├── index.ts                      // CLI entry point
│   │   ├── commands/
│   │   │   ├── commission.ts
│   │   │   ├── bid.ts
│   │   │   ├── match.ts
│   │   │   ├── serve.ts
│   │   │   ├── pricing.ts
│   │   │   ├── deliver.ts
│   │   │   └── config.ts
│   │   └── utils/
│   │       ├── config.ts                 // Config file management
│   │       └── display.ts                // CLI output formatting
│   ├── package.json
│   └── tsconfig.json
├── tests/
│   └── inter-knot.ts                     // Anchor integration tests
├── demo/
│   ├── setup.ts
│   ├── agent-a.ts
│   ├── agent-b.ts
│   ├── agent-c.ts
│   ├── mock-demo.sh
│   └── real-demo.sh
├── app/                                   // Static website
│   └── (Astro or plain HTML)
├── docs/
│   ├── INTER-KNOT.md                     // Project overview
│   ├── design-decisions.md               // Design decision log
│   └── plans/
│       └── 2026-03-17-technical-architecture.md  // This document
├── Anchor.toml
├── Cargo.toml                            // Workspace Cargo
├── package.json                          // Root package.json (pnpm workspace)
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

---

## 11. Development Plan

### Timeline: 10 days (2026-03-17 to 2026-03-27)

```
Phase 1: On-Chain Program (Day 1-3)
═══════════════════════════════════

Day 1 — Scaffolding + Core State
  • anchor init inter-knot
  • Define state/config.rs, state/commission.rs, state/bid.rs
  • Implement initialize instruction
  • Implement create_commission instruction
  • Basic test for both

Day 2 — Bidding + Matching Instructions
  • Implement submit_bid instruction
  • Implement select_bid instruction
  • Implement cancel_commission instruction
  • Implement withdraw_bid instruction
  • Implement complete_commission instruction
  • Tests for all instructions

Day 3 — Integration Tests + Deploy
  • Full lifecycle integration test
    (create → bid → select → complete)
  • Edge case tests (expired deadline, unauthorized, self-bid)
  • Deploy to devnet
  • Verify all instructions work on devnet

Phase 2: SDK + CLI (Day 4-6)
═══════════════════════════════════

Day 4 — SDK Core
  • program.ts — Anchor client initialization
  • commission.ts — create, list, get, cancel, complete, watch
  • bid.ts — submit, list, withdraw
  • matching.ts — selectBid
  • query.ts — getProgramAccounts + sorting

Day 5 — x402 Integration
  • server/task-server.ts — Hono + @x402/hono middleware
  • server/handlers.ts — mock handler + Ollama handler
  • delivery/x402-client.ts — delegator-side x402 fetch wrapper
  • Test x402 flow: delegator pays → executor serves

Day 6 — CLI + Pricing
  • CLI commands wrapping SDK (all commands listed in Section 6)
  • Config management (~/.inter-knot/config.json)
  • pricing/compute.ts — reference pricing function
  • CLI end-to-end test

Phase 3: Demo + Deliverables (Day 7-10)
═══════════════════════════════════

Day 7 — Demo Scripts
  • demo/setup.ts — automated initialization
  • demo/agent-a.ts, agent-b.ts — full demo flow
  • demo/mock-demo.sh — one-command mock demo
  • demo/real-demo.sh — one-command real demo with Ollama
  • Test both modes

Day 8 — Static Website
  • Project landing page with whitepaper content
  • Architecture diagrams
  • Quick Start guide
  • Deploy to Vercel or GitHub Pages

Day 9 — Polish
  • README.md with clear setup instructions
  • Code cleanup and comments
  • Bug fixes from testing
  • Verify devnet deployment is stable

Day 10 — Submit
  • Final devnet verification
  • Write X Article introducing the project
  • Quote retweet hackathon announcement
    Tag: @trendsdotfun @solana_devs @BitgetWallet
    Hashtag: #AgentTalentShow
  • If time permits: mainnet deployment + real transactions
```

---

## 12. Configuration & Constants

### Network Configuration

```typescript
// Devnet
const DEVNET_CONFIG = {
  rpc: "https://api.devnet.solana.com",
  usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  x402Network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  x402Facilitator: "https://x402.org/facilitator",
};

// Mainnet (for future use)
const MAINNET_CONFIG = {
  rpc: "https://api.mainnet-beta.solana.com",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  x402Network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  x402Facilitator: "https://x402.org/facilitator",
};
```

### Protocol Constants

```rust
// Solana Program constants
pub const MAX_TASK_TYPE_LEN: usize = 32;
pub const MAX_TASK_SPEC_URI_LEN: usize = 128;
pub const MAX_SERVICE_ENDPOINT_LEN: usize = 128;

// USDC has 6 decimal places
// 1 USDC = 1_000_000 lamports
pub const USDC_DECIMALS: u8 = 6;
```

### Tech Stack Summary

| Component | Technology | Version |
|-----------|-----------|---------|
| Blockchain | Solana | Latest |
| Smart Contract | Anchor (Rust) | 0.30+ |
| SDK/CLI | TypeScript | 5.0+ |
| Runtime | Node.js | 20+ |
| x402 Server | Hono | 4.0+ |
| x402 Client | @x402/fetch or custom | Latest |
| x402 Solana | @x402/svm | 2.6+ (security fix) |
| LLM Engine | Ollama | Latest |
| CLI Framework | commander.js | 12+ |
| Package Manager | pnpm | 9+ |
| Monorepo | pnpm workspaces | - |
| Static Site | Astro or plain HTML | - |
| Testing | Anchor test (Mocha/Chai) | - |

---

## 13. Hackathon Deliverables

**Deadline: 2026-03-27 2PM UTC**

| Deliverable | Priority | Description |
|-------------|----------|-------------|
| GitHub Repo | P0 | Complete source code + documentation |
| Devnet Deployment | P0 | Working Solana Program on devnet |
| Demo | P0 | Two agents completing full flow (commission → bid → match → x402 delivery) |
| Static Website | P1 | Whitepaper content + Quick Start + architecture diagrams |
| X Article | P1 | Project introduction with all links |
| Mainnet TX | P2 | Real transactions on Solana mainnet (stretch goal) |

### Submission Process

1. Publish an X Article introducing the project (with all links)
2. Quote retweet the hackathon announcement post
3. Tag: `@trendsdotfun` `@solana_devs` `@BitgetWallet`
4. Hashtag: `#AgentTalentShow`
5. Include X Article link in the quote retweet

---

## 14. Future Work (Post-MVP)

These features are intentionally deferred to keep the MVP focused:

### Phase 2: Trust Layer
- **Reputation System** (ref: ERC-8004): On-chain feedback after each transaction. Agent PDA stores aggregate score.
- **Anti-Sybil**: Staking requirement for executors. New wallets limited to small commissions.
- **Anti-Collusion**: Reputation weighted by counterparty diversity.

### Phase 2: Economic Protection
- **Escrow**: Lock USDC on-chain after bid selection, release on completion.
- **Evaluator Role** (ref: ERC-8183): Third-party verification for high-value tasks.
- **Dispute Resolution**: Time-locked escrow with multi-sig arbitration.

### Phase 3: Protocol Expansion
- **New Task Types**: capability trading, data trading, API service trading.
- **Priority Pricing**: Delegators can pay premium for priority matching.
- **Supply/Demand Oracle**: On-chain feed of current market conditions for pricing.
- **Agent Registry**: Full ERC-8004-style identity with capabilities, metadata, service endpoints.
- **P2P Communication Protocol**: Encrypted direct messaging between matched agents.

### Phase 3: Scale
- **Mainnet Deployment**: Production-ready contracts with security audit.
- **Payment Channels**: x402 channel scheme for sub-cent micropayments.
- **Cross-Chain**: Support for agents on other chains via bridge protocols.

---

*Inter-Knot — Where every knot is an agent, and every thread is a transaction.*

*Architecture authored: 2026-03-17*
