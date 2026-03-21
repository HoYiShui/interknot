# Inter-Knot Phase 2 — Decentralized Delivery + Agent Integration

> This document covers the remaining development plan for the Inter-Knot hackathon.
> It builds on top of the Day 1-7 work defined in `2026-03-17-technical-architecture.md`.
> That document remains the source of truth for the core protocol (Solana program, SDK, CLI, x402).
> This document adds: decentralized P2P delivery, E2E encryption, real AI agent integration, and polish.

---

## Table of Contents

1. [What Changed](#1-what-changed)
2. [Decentralized Delivery Layer](#2-decentralized-delivery-layer)
3. [E2E Encryption](#3-e2e-encryption)
4. [Agent Integration](#4-agent-integration)
5. [Updated System Architecture](#5-updated-system-architecture)
6. [On-Chain Changes](#6-on-chain-changes)
7. [SDK Changes](#7-sdk-changes)
8. [CLI Changes](#8-cli-changes)
9. [Development Plan](#9-development-plan)
10. [Hackathon Deliverables (Updated)](#10-hackathon-deliverables-updated)

---

## 1. What Changed

### Day 1-7 Summary (Complete)

| Day | Deliverable | Status |
|-----|-------------|--------|
| 1 | Anchor scaffolding + core state + `initialize` + `create_commission` | Done |
| 2 | All 7 on-chain instructions + 27 tests | Done |
| 3 | Full lifecycle tests (35 passing) + devnet deploy | Done |
| 4 | TypeScript SDK (Commission/Bid/Matching/Query clients) | Done |
| 5 | x402 integration (TaskServer + DeliveryClient) | Done |
| 6 | CLI (7 commands) + pricing function | Done |
| 7 | Demo scripts + devnet verification (2-agent + 3-agent competition) | Done |

### What Day 1-7 exposed

1. **P2P delivery relies on HTTP endpoints** — executor puts `http://localhost:8080/tasks` in bid. No NAT traversal, no privacy, no decentralization.
2. **No real AI agent** — demo scripts are hardcoded flows, not autonomous AI agents using the protocol.
3. **x402 works but has external dependency** — relies on `x402.org/facilitator` (only supports devnet). Adding a fully on-chain delivery path provides independence.

### Phase 2 Goals

1. **Decentralized delivery via Irys** — replace HTTP endpoints with content-addressed storage.
2. **E2E encryption** — task data encrypted using Solana keypair ECDH. Only delegator and matched executor can read.
3. **Real AI agent demo** — two pi-agent instances autonomously using Inter-Knot CLI to trade tasks.
4. **Website + submission** — landing page + hackathon materials.

---

## 2. Decentralized Delivery Layer

### Problem

Current flow requires executor to run a public HTTP server. This has three problems:
- **NAT** — agents behind firewalls can't receive connections
- **Privacy** — executor's IP address is exposed in the on-chain bid
- **Centralization** — x402 facilitator at `x402.org` is a single point of failure

### Solution: Irys + On-Chain Routing

Replace direct HTTP with a store-and-forward model using Irys (decentralized storage) and Solana accounts (routing).

```
Agent A (Delegator)              Solana                    Irys
    │                              │                        │
    │── encrypt(task_input) ───────────────────────────────► │ → CID_input
    │── submit_input(#4, CID) ───► TaskDelivery PDA         │
    │                              │  input_cid: "irys://…" │
    │                              │  status: InputReady     │
    │                              │                         │
Agent B (Executor)                 │                         │
    │◄── watch TaskDelivery PDA ──┘                         │
    │── fetch + decrypt(CID_input) ─────────────────────────►│
    │── execute task (Ollama/mock)                           │
    │── encrypt(result) ───────────────────────────────────► │ → CID_output
    │── submit_output(#4, CID) ──► TaskDelivery PDA         │
    │                              │  output_cid: "irys://…"│
    │                              │  status: OutputReady    │
    │                              │                         │
Agent A                            │                         │
    │◄── watch TaskDelivery PDA ──┘                         │
    │── fetch + decrypt(CID_output) ────────────────────────►│
    │── complete_commission(#4) ──► Commission               │
    │                              │  status: Completed      │
```

### Why Irys

| Feature | Irys | IPFS | Arweave |
|---------|------|------|---------|
| Free tier | < 100 KiB free | Requires pinning service | Paid |
| Permanence | Permanent (backed by Arweave) | Needs pinning | Permanent |
| Solana integration | Native (SOL/token payment) | None | None |
| Upload speed | Fast (bundled) | Variable | Slow |
| npm package | `@irys/sdk` | `ipfs-http-client` | `arweave` |

### x402 Coexistence

x402 remains as an **alternative delivery path** for executors who prefer HTTP:

```
Bid.delivery_method:
  - "irys"  → use on-chain TaskDelivery + Irys (decentralized)
  - "http"  → use service_endpoint URL + x402 (legacy/compatible)
```

The delegator checks `delivery_method` and routes accordingly. Both paths end with `complete_commission` on-chain.

---

## 3. E2E Encryption

### Key Exchange (Zero Extra Communication)

Both agents' Ed25519 public keys are already on-chain:
- Delegator's pubkey: in the `Commission` account (`delegator` field)
- Executor's pubkey: in the `Bid` account (`executor` field)

```
Ed25519 (Solana signing key)
    │
    ▼ convert (montgomery form)
X25519 (Diffie-Hellman key)
    │
    ▼ ECDH(my_private, their_public)
SharedSecret (32 bytes)
    │
    ▼ HKDF derive
AES-256-GCM key
```

### Implementation

```typescript
import { edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from "@noble/curves/ed25519";
import { x25519 } from "@noble/curves/ed25519";

// Agent A derives shared secret
const sharedSecret = x25519.getSharedSecret(
  edwardsToMontgomeryPriv(agentA.secretKey.slice(0, 32)),
  edwardsToMontgomeryPub(agentB.publicKey.toBytes())
);

// Agent B derives the SAME shared secret
const sharedSecret = x25519.getSharedSecret(
  edwardsToMontgomeryPriv(agentB.secretKey.slice(0, 32)),
  edwardsToMontgomeryPub(agentA.publicKey.toBytes())
);

// Both use sharedSecret for AES-256-GCM
```

### Dependencies

- `@noble/curves` — already in Solana ecosystem, zero new deps
- `@noble/ciphers` — AES-256-GCM (or use Node.js `crypto` module)

### What Gets Encrypted

| Data | Encrypted? | Reason |
|------|-----------|--------|
| Task input (prompt, params) | Yes | Private to delegator + executor |
| Task output (result) | Yes | Private to delegator + executor |
| Commission metadata (task_type, max_price) | No | Public on-chain (needed for bidding) |
| Bid metadata (price, delivery_method) | No | Public on-chain (needed for selection) |
| CIDs on-chain | No | Opaque identifiers, data is encrypted |

---

## 4. Agent Integration

### Framework: pi-agent-core

Use `@mariozechner/pi-agent-core` as the agent runtime. Two agent instances, each with:
- A system prompt defining its role and available CLI commands
- A bash tool for executing `inter-knot` CLI commands
- Wallet identity (Solana keypair)

### Agent A (Delegator) System Prompt

```
You are an Inter-Knot delegator agent. Your job is to publish computation
tasks, find the best executor, and retrieve results.

Available commands:
  inter-knot commission create --task-type <type> --max-price <usdc> --deadline <duration>
  inter-knot bid list <commission-id>
  inter-knot match select <commission-id> <executor-pubkey>
  inter-knot msg send <pubkey> --commission <id> --file <path>
  inter-knot msg get --commission <id>
  inter-knot commission complete <commission-id>

Your workflow:
1. Create a commission for the task you need done
2. Wait for bids to appear (poll with `bid list`)
3. Select the lowest-priced bid
4. Send task input via `msg send`
5. Wait for result via `msg get`
6. Mark commission as completed
```

### Agent B (Executor) System Prompt

```
You are an Inter-Knot executor agent. Your job is to watch for tasks you
can perform, bid competitively, execute tasks, and deliver results.

Available commands:
  inter-knot commission list --task-type <type>
  inter-knot bid submit <commission-id> --price <usdc> --delivery-method irys
  inter-knot msg inbox --watch
  inter-knot msg send <pubkey> --commission <id> --file <path>

Your workflow:
1. Watch for open commissions matching your capabilities
2. Estimate your cost and submit a competitive bid
3. Wait to be selected (watch your inbox)
4. When you receive task input, execute it (use ollama or your tools)
5. Send the result back via `msg send`
```

### Agent Architecture

```
┌──────────────────────────┐     ┌──────────────────────────┐
│     Agent A (pi-agent)   │     │     Agent B (pi-agent)   │
│                          │     │                          │
│  System Prompt:          │     │  System Prompt:          │
│    "You are a delegator" │     │    "You are an executor" │
│                          │     │                          │
│  Tools:                  │     │  Tools:                  │
│    bash(inter-knot CLI)  │     │    bash(inter-knot CLI)  │
│                          │     │    bash(ollama)          │
│  Model:                  │     │                          │
│    claude-sonnet-4.6     │     │  Model:                  │
│                          │     │    claude-sonnet-4.6     │
└─────────┬────────────────┘     └─────────┬────────────────┘
          │                                │
          │ inter-knot CLI                 │ inter-knot CLI
          ▼                                ▼
    ┌─────────────────────────────────────────────┐
    │              Solana Devnet                    │
    │  Commission → Bid → Match → Deliver → Done   │
    └─────────────────────────────────────────────┘
```

### Demo Flow

1. Start Agent B (executor) — it watches for commissions autonomously
2. Prompt Agent A: "I need to translate this text to Japanese: 'Hello world'"
3. Agent A autonomously:
   - Creates a commission (`compute/llm-inference`)
   - Waits for bids
   - Selects the lowest bid
   - Sends encrypted task via Irys
   - Retrieves encrypted result
   - Marks complete
4. Agent B autonomously:
   - Detects commission, submits bid
   - Receives task, runs Ollama
   - Uploads encrypted result to Irys
5. Both agents operate without human intervention after initial prompt

---

## 5. Updated System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Inter-Knot Protocol (v2)                    │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                  Matching Layer (Solana)                  │ │
│  │  Commission → Bid → Match    (7 existing instructions)   │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                          │                                    │
│  ┌──────────────────────▼──────────────────────────────────┐ │
│  │              Delivery Layer (Solana + Irys)               │ │
│  │                                                           │ │
│  │  Path A (Decentralized):                                  │ │
│  │    submit_input(CID) → submit_output(CID) → complete     │ │
│  │    Data: Irys (encrypted, permanent)                      │ │
│  │    Routing: Solana PDA (TaskDelivery account)             │ │
│  │                                                           │ │
│  │  Path B (HTTP/x402, legacy):                              │ │
│  │    POST /tasks → 402 → pay → result → complete            │ │
│  │    Data: HTTP (direct)                                    │ │
│  │    Payment: x402 facilitator                              │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                          │                                    │
│  ┌──────────────────────▼──────────────────────────────────┐ │
│  │                Agent Layer (pi-agent-core)                │ │
│  │                                                           │ │
│  │  Delegator Agent ◄──── CLI ────► Executor Agent           │ │
│  │  (creates tasks)    (inter-knot)  (executes tasks)        │ │
│  └───────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. On-Chain Changes

### New Account: TaskDelivery

```rust
#[account]
pub struct TaskDelivery {
    pub commission_id: u64,
    pub delegator: Pubkey,
    pub executor: Pubkey,
    pub input_cid: String,      // max 128 bytes, Irys transaction ID
    pub output_cid: String,     // max 128 bytes, Irys transaction ID
    pub status: DeliveryStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum DeliveryStatus {
    Pending,       // Created, awaiting input
    InputReady,    // Delegator submitted input CID
    OutputReady,   // Executor submitted output CID
}
```

**PDA seeds:** `["delivery", commission_id.to_le_bytes()]`

**Space:** 8 (discriminator) + 8 + 32 + 32 + (4+128) + (4+128) + 1 + 8 + 8 = ~361 bytes

### New Instructions

#### `create_delivery`

Called by delegator after `select_bid`. Creates the TaskDelivery PDA.

```rust
pub fn handle_create_delivery(ctx: Context<CreateDelivery>, commission_id: u64) -> Result<()>
```

- Validates: commission exists, status is Matched, caller is delegator
- Creates TaskDelivery PDA with status Pending

#### `submit_input`

Called by delegator. Stores the encrypted task input CID.

```rust
pub fn handle_submit_input(ctx: Context<SubmitInput>, commission_id: u64, input_cid: String) -> Result<()>
```

- Validates: delivery exists, status is Pending, caller is delegator, CID length <= 128
- Updates: `input_cid`, status → InputReady, `updated_at`

#### `submit_output`

Called by executor. Stores the encrypted task output CID.

```rust
pub fn handle_submit_output(ctx: Context<SubmitOutput>, commission_id: u64, output_cid: String) -> Result<()>
```

- Validates: delivery exists, status is InputReady, caller is executor, CID length <= 128
- Updates: `output_cid`, status → OutputReady, `updated_at`

### Existing Instruction Changes

None. `complete_commission` remains unchanged — delegator calls it after fetching and verifying the output.

---

## 7. SDK Changes

### New: IrysDeliveryClient

```typescript
// sdk/src/delivery/irys-client.ts

export class IrysDeliveryClient {
  constructor(config: { wallet: Keypair; network?: "devnet" | "mainnet" })

  /** Encrypt and upload data to Irys, return CID */
  async upload(data: Buffer, recipientPubkey: PublicKey): Promise<string>

  /** Download and decrypt data from Irys */
  async download(cid: string, senderPubkey: PublicKey): Promise<Buffer>
}
```

### New: CryptoUtils

```typescript
// sdk/src/crypto/ecdh.ts

export function deriveSharedSecret(myKeypair: Keypair, theirPubkey: PublicKey): Uint8Array
export function encrypt(plaintext: Buffer, sharedSecret: Uint8Array): Buffer  // AES-256-GCM
export function decrypt(ciphertext: Buffer, sharedSecret: Uint8Array): Buffer
```

### New: DeliveryClient (on-chain routing)

```typescript
// sdk/src/delivery/onchain-client.ts

export class OnChainDeliveryClient {
  constructor(config: { connection: Connection; wallet: Keypair; programId: PublicKey })

  async createDelivery(commissionId: number): Promise<{ txSignature: string }>
  async submitInput(commissionId: number, inputCid: string): Promise<{ txSignature: string }>
  async submitOutput(commissionId: number, outputCid: string): Promise<{ txSignature: string }>
  async getDelivery(commissionId: number): Promise<TaskDelivery | null>
  async watchDelivery(commissionId: number, opts: { onUpdate: (delivery: TaskDelivery) => void }): Promise<{ stop: () => void }>
}
```

### Existing: x402 DeliveryClient

Unchanged. Remains as `sdk/src/delivery/x402-client.ts` for HTTP-based delivery.

---

## 8. CLI Changes

### New Command Group: `msg`

```bash
# Send encrypted data to a matched executor/delegator via Irys
inter-knot msg send <recipient-pubkey> --commission <id> --file <path>
  1. Read file
  2. Derive shared secret (ECDH with recipient's pubkey from on-chain)
  3. Encrypt with AES-256-GCM
  4. Upload to Irys → get CID
  5. Call submit_input or submit_output on-chain (based on caller role)

# Check for incoming messages on a commission
inter-knot msg get --commission <id>
  1. Read TaskDelivery PDA
  2. If CID available, fetch from Irys
  3. Derive shared secret, decrypt
  4. Output to stdout or --output <path>

# Watch inbox for any new deliveries (for executor agent loop)
inter-knot msg inbox [--watch] [--task-type <type>]
  1. Poll TaskDelivery accounts where caller is executor
  2. If --watch, keep polling (3s interval)
  3. Print new deliveries as they arrive
```

### Updated Command: `bid submit`

```bash
# Add --delivery-method flag (default: irys)
inter-knot bid submit <commission-id> --price <usdc> [--delivery-method irys|http] [--endpoint <url>]
```

---

## 9. Development Plan

### Day 8 (2026-03-22): Decentralized Delivery

**Morning: On-chain (3-4h)**
- [ ] Add `TaskDelivery` account to `state/`
- [ ] Add `DeliveryStatus` enum
- [ ] Implement `create_delivery` instruction
- [ ] Implement `submit_input` instruction
- [ ] Implement `submit_output` instruction
- [ ] Tests for all three instructions + edge cases

**Afternoon: SDK + Crypto (3-4h)**
- [ ] Implement `sdk/src/crypto/ecdh.ts` (ECDH + AES-256-GCM)
- [ ] Unit tests for encrypt/decrypt round-trip
- [ ] Implement `sdk/src/delivery/irys-client.ts` (upload/download + encryption)
- [ ] Implement `sdk/src/delivery/onchain-client.ts` (PDA interactions)
- [ ] Integration test: upload encrypted → submit CID on-chain → fetch → decrypt

**Code review checkpoint → codex**

### Day 9 (2026-03-23): CLI + Agent Integration

**Morning: CLI (2-3h)**
- [ ] Add `msg send` / `msg get` / `msg inbox` CLI commands
- [ ] Add `--delivery-method` flag to `bid submit`
- [ ] CLI smoke test for new commands
- [ ] Update demo scripts to use Irys delivery path

**Afternoon: Agent Integration (3-4h)**
- [ ] Install `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`
- [ ] Create `demo/src/agent-delegator.ts` with pi-agent + system prompt + bash tool
- [ ] Create `demo/src/agent-executor.ts` with pi-agent + system prompt + bash tool
- [ ] Create `demo/agent-demo.sh` orchestration script
- [ ] Test: two agents complete a full commission cycle autonomously

**Code review checkpoint → codex**

### Day 10 (2026-03-24): Polish + Website

**Morning: Website (2-3h)**
- [ ] Simple static landing page (protocol overview, architecture diagram, demo video/gif)
- [ ] Deploy to Vercel/Netlify or GitHub Pages

**Afternoon: Polish (2-3h)**
- [ ] README.md with installation, quick start, architecture overview
- [ ] Clean up unused code, fix any remaining warnings
- [ ] Record demo video (terminal recording of agent-demo.sh)
- [ ] Final `anchor test` + `pnpm test:cli` verification

**Code review checkpoint → codex**

### Day 11-13 (buffer): Submission

- [ ] Hackathon submission materials
- [ ] X/Twitter article
- [ ] Any last-minute fixes from code review

---

## 10. Hackathon Deliverables (Updated)

### P0 (Must Have)

- [x] On-chain program with 7 instructions, deployed to devnet
- [x] TypeScript SDK with full client API
- [x] x402 payment integration (verified on devnet)
- [x] 2-agent + 3-agent competition demo (verified on devnet)
- [ ] Decentralized delivery via Irys + on-chain routing
- [ ] E2E encryption with Solana keypair ECDH
- [ ] Two real AI agents completing a task autonomously

### P1 (Should Have)

- [ ] Landing page / website
- [ ] README with architecture overview
- [ ] Demo video

### P2 (Nice to Have)

- [ ] Ollama real inference in agent demo
- [ ] On-chain escrow (lock USDC on commission, release on complete)
- [ ] Reputation system (track completion rate per agent)

### Key Metrics for Judges

1. **Fully on-chain matching** — 7 instructions, 35+ tests, devnet-verified
2. **Two delivery paths** — x402 (HTTP) + Irys (decentralized), both encrypted
3. **Real agent autonomy** — AI agents use CLI to trade tasks without human intervention
4. **Solana-native crypto** — ECDH from on-chain Ed25519 keys, no extra identity layer

---

## Appendix: Dependencies

### New npm packages

| Package | Purpose | Size |
|---------|---------|------|
| `@irys/sdk` | Decentralized storage upload/download | ~2 MB |
| `@noble/curves` | Ed25519 → X25519 conversion, ECDH | ~50 KB (may already be in tree) |
| `@noble/ciphers` | AES-256-GCM encryption | ~30 KB |
| `@mariozechner/pi-agent-core` | Agent runtime | ~100 KB |
| `@mariozechner/pi-ai` | Multi-provider LLM API | ~200 KB |

### Constants

```
Irys Devnet Gateway:  https://devnet.irys.xyz
Irys Upload Node:     https://devnet.irys.xyz (free for < 100 KiB)
ECDH Curve:           X25519 (converted from Ed25519)
Encryption:           AES-256-GCM
CID Max Length:       128 bytes (on-chain field)
```
