# Day 8 Code Review

Date: 2026-03-21
Scope: Decentralized delivery layer (on-chain TaskDelivery + SDK crypto + Irys client)

## What was delivered

### On-chain program (3 new instructions)

| Instruction | File | Purpose |
|-------------|------|---------|
| `create_delivery` | `instructions/create_delivery.rs` | Delegator creates TaskDelivery PDA after matching |
| `submit_input` | `instructions/submit_input.rs` | Delegator stores encrypted input CID (Irys tx ID) |
| `submit_output` | `instructions/submit_output.rs` | Executor stores encrypted output CID |

New state: `state/delivery.rs` — `TaskDelivery` account (commission_id, delegator, executor, input_cid, output_cid, status, timestamps, bump) + `DeliveryStatus` enum (Pending → InputReady → OutputReady).

PDA seeds: `["delivery", commission_id.to_le_bytes()]`

New error variants: `DeliveryAlreadyExists`, `DeliveryNotPending`, `DeliveryNotInputReady`, `CidTooLong`

### Tests (15 new, 50 total)

| Suite | Tests | Coverage |
|-------|-------|----------|
| `create_delivery` | 5 | Happy path, wrong status (Open/Completed), unauthorized delegator, duplicate delivery |
| `submit_input` | 4 | Happy path, double submit, wrong caller, CID too long |
| `submit_output` | 5 | Happy path, double submit, wrong caller, submit before input, CID too long |
| `delivery full lifecycle` | 1 | create → input → output → complete (end-to-end) |

### SDK — Crypto module

| File | Exports | Deps |
|------|---------|------|
| `sdk/src/crypto/ecdh.ts` | `deriveSharedSecret()`, `encrypt()`, `decrypt()` | `@noble/curves`, `@noble/ciphers`, `@noble/hashes` |

- ECDH: Ed25519 → X25519 via `ed25519.utils.toMontgomerySecret()` / `toMontgomery()`, then `x25519.getSharedSecret()`
- Key derivation: HKDF-SHA256 with info string `"inter-knot-v1"`
- Encryption: AES-256-GCM with random 12-byte nonce
- Wire format: `nonce (12) || ciphertext || tag (16)`

Unit test: `sdk/test/crypto.test.ts` — shared secret symmetry, round-trip, wrong-key rejection, 10KB data

### SDK — Delivery clients

| File | Class | Purpose |
|------|-------|---------|
| `sdk/src/delivery/onchain-client.ts` | `OnChainDeliveryClient` | PDA interactions (createDelivery, submitInput, submitOutput, getDelivery, watchDelivery) |
| `sdk/src/delivery/irys-client.ts` | `IrysDeliveryClient` | Encrypt + upload to Irys / download + decrypt from Irys |

### Other changes

- SDK switched to ESM (`"type": "module"` in package.json, `moduleResolution: "bundler"`)
- IDL updated with 3 new instructions
- `InterKnot` class: added `deliveryPda()` method, `taskDelivery` account accessor
- Pre-existing type errors fixed in CLI (`bid.ts`, `commission.ts`) and demo (`agent-b.ts`, `agent-c.ts`)

## Verification

```
anchor test: 50 passing (19s)
npx tsx sdk/test/crypto.test.ts:
  OK: shared secrets match
  OK: encrypt/decrypt round-trip works
  OK: ciphertext length correct (50 bytes)
  OK: wrong key correctly rejected
  OK: large data (10KB) round-trip works
pnpm --dir sdk build: passed
pnpm --dir cli build: passed
pnpm --dir demo exec tsc --noEmit: passed
```

## Items for codex review

1. **On-chain delivery instructions** — Are the access controls correct? Is the state transition logic sound (Pending → InputReady → OutputReady)?
2. **ECDH from Solana keys** — Is the Ed25519 → X25519 conversion correct? Is the HKDF derivation safe?
3. **IrysDeliveryClient** — Uses dynamic import + `(Builder as any)(Solana)` cast. Is the Irys SDK integration reliable? Has the upload/download flow been tested against a live Irys devnet node?
4. **ESM migration** — SDK changed to `"type": "module"` with `moduleResolution: "bundler"`. Any CJS compatibility concerns for downstream consumers?
5. **CID length limit** — On-chain `#[max_len(128)]` for CIDs. Is 128 bytes sufficient for Irys transaction IDs?

## Open items from prior reviews

| Prior finding | Status |
|--------------|--------|
| Day 5 — mock payment-validation gap | **CLOSED** (per codex Day 7 addendum) |
| Day 6 — CLI e2e gap | Still open (demo uses SDK, not CLI) |
| Day 7 — real-mode (Ollama) verification | Deferred (not core protocol) |
| Day 7 — competition demo | **CLOSED** (three-agent competition verified on devnet, see Day 7 addendum) |

Signed: **claude opus 4.6**
