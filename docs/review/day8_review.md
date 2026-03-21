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

---

## Addendum on Review Evaluation

Date: 2026-03-21

I reviewed the Day 8 implementation against the updated Phase 2 architecture document and reran the local verification.

## Findings (ordered by severity)

1. **[High] `IrysDeliveryClient` does not currently initialize successfully on devnet**
   - **Location:** `sdk/src/delivery/irys-client.ts`, `docs/plans/2026-03-21-phase2-architecture.md:477-479`, local installed Irys SDK at `node_modules/.pnpm/@irys+upload@0.0.15.../node_modules/@irys/upload/src/base.ts`
   - **Issue:** The current implementation switches the uploader to `devnet`, but it does not configure a dev/testnet Solana RPC. The installed Irys SDK explicitly rejects `devnet.irys.xyz` without `providerUrl`.
   - **Evidence:** I reproduced this locally by constructing `new IrysDeliveryClient({ wallet: Keypair.generate(), network: "devnet" })` and calling its lazy initializer. It failed with:
     - `Using devnet.irys.xyz requires a dev/testnet RPC to be configured!`
   - **Impact:** The Day 8 Irys delivery client is not merely untested; the current devnet code path is not runnable as written.

2. **[High] `IrysDeliveryClient` passes the wallet in a format that does not match the installed Solana uploader's expectation**
   - **Location:** `sdk/src/delivery/irys-client.ts:32-33`, local installed uploader at `node_modules/.pnpm/@irys+upload-solana@0.1.8.../node_modules/@irys/upload-solana/src/token.ts:52-57`
   - **Issue:** The code passes `Buffer.from(this.wallet.secretKey).toString("base64")` into `.withWallet(...)`. The installed Solana uploader treats string wallets as **base58**, not base64, and decodes them with `bs58.decode(...)`.
   - **Evidence:** I verified the installed source and reproduced the decoding mismatch locally. `bs58.decode(base64Secret)` fails with `Non-base58 character`.
   - **Impact:** Even if the missing RPC were fixed, the current wallet handoff is still likely to fail during real Irys use.

3. **[Medium] The Day 8 integration test required by the new architecture document is still missing**
   - **Location:** `docs/plans/2026-03-21-phase2-architecture.md:474-480`
   - **Issue:** The plan explicitly calls for:
     - `upload encrypted -> submit CID on-chain -> fetch -> decrypt`
   - **Current state:** The repository has:
     - good Anchor tests for the on-chain `TaskDelivery` state machine
     - a standalone crypto round-trip test in `sdk/test/crypto.test.ts`
   - **But:** I did not find any repo-backed test that actually exercises `IrysDeliveryClient.upload()` / `download()` together with on-chain CID submission/retrieval.
   - **Impact:** This gap is exactly why the two Irys runtime bugs above were able to land unnoticed.

4. **[Medium] The delivery state machine accepts empty CIDs and can advance to ready states without usable content**
   - **Location:** `programs/inter-knot/src/instructions/submit_input.rs:28-39`, `programs/inter-knot/src/instructions/submit_output.rs:28-39`, `tests/inter-knot.ts:897-898`
   - **Issue:** The program validates CID length `<= 128`, but does not require non-empty values. An empty string therefore satisfies the current checks.
   - **Impact:** A caller can move `Pending -> InputReady` or `InputReady -> OutputReady` while storing no meaningful Irys identifier at all, which weakens the semantics of the new on-chain delivery path.

## Updated Verdict

- **On-chain TaskDelivery implementation:** mostly sound
- **Crypto helper implementation:** locally convincing
- **Irys delivery path:** **not accepted yet**
- **Day 8 overall against the Phase 2 architecture document:** **partially complete, but not yet satisfactory**

The blocking issue is the same in all three views:
- the architecture document requires a working Irys delivery path,
- the code currently has real runtime issues in that path,
- and the repository does not yet contain the integration test that was supposed to catch them.

## Re-Verification

- `pnpm --dir sdk build`: passed
- `pnpm exec tsx sdk/test/crypto.test.ts`: passed
- `anchor test`: passed (`50 passing`)
- `pnpm --dir cli build`: passed
- `pnpm --dir demo exec tsc --noEmit`: passed
- Local Irys initialization repro:
  - failed with `Using devnet.irys.xyz requires a dev/testnet RPC to be configured!`
- Local wallet-format repro:
  - `bs58.decode(base64Secret)` failed with `Non-base58 character`

Signed: **gpt-5.3-codex**
