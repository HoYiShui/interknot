# Day 9-ex Code Review

Date: 2026-03-22  
Scope:
- Incremental architecture doc: `docs/plans/2026-03-22-websocket-push.md` (`37b563a`)
- Implementation commit: `5251066` (`feat: Day 9-ex1 — SDK WebSocket subscriptions (replace polling)`)

## Findings (ordered by severity)

1. **[High] SDK API change broke demo TypeScript compile (`pollIntervalMs` removed but call sites unchanged)**
   - **Location:** `sdk/src/client/commission.ts:110`, `demo/src/agent-b.ts:66`, `demo/src/agent-c.ts:46`
   - **Issue:** `CommissionClient.watch()` no longer accepts `pollIntervalMs`, but existing demo agents still pass it in object literals.
   - **Evidence:** `pnpm --dir demo exec tsc --noEmit` fails with:
     - `TS2353: 'pollIntervalMs' does not exist in type ...` (both agent-b and agent-c).
   - **Impact:** Demo code no longer type-checks; this is a direct regression for the repository's runnable demo surface.

2. **[Medium] `CommissionClient.watch()` can crash the process on async callback rejection**
   - **Location:** `sdk/src/client/commission.ts:124`, `sdk/src/client/commission.ts:137`
   - **Issue:** `params.onNew(c)` is invoked without `await`/`catch`. The callback type explicitly allows `Promise<void>`, so rejected promises become unhandled rejections.
   - **Evidence:** runtime behavior on this environment (`node v24.13.1`) is fatal for unhandled rejections (process exits non-zero).
   - **Impact:** A transient error in user callback logic can terminate long-running watchers unexpectedly.

3. **[Medium] Day 9-ex1 implementation deviates from the architecture doc's task-type filtering strategy**
   - **Location:** `docs/plans/2026-03-22-websocket-push.md:87-90`, `docs/plans/2026-03-22-websocket-push.md:277-280`, `sdk/src/client/commission.ts:142-159`
   - **Issue:** Plan calls for `onProgramAccountChange` with memcmp filter (`TASK_TYPE_OFFSET`), but implementation subscribes to all program account changes and filters in callback.
   - **Impact:** Functional correctness is mostly preserved, but the expected RPC-side filtering/perf optimization is not implemented as designed.

## Plan Alignment

- **Implemented from Day 9-ex1:**
  - `withReconnect` utility added.
  - `CommissionClient.watch()` moved from polling to WebSocket subscription.
  - `OnChainDeliveryClient.watchDelivery()` moved from polling to `onAccountChange`.
  - `msg inbox --watch` internals switched to WebSocket subscription.
- **Not fully aligned / still pending vs doc expectations:**
  - memcmp task-type filter path (`TASK_TYPE_OFFSET`) not implemented.
  - No repository-backed evidence yet for the Day 9-ex1 manual devnet latency smoke item (`watch fires within ~2s`).

## Verification Run

- `pnpm --dir sdk build`: passed
- `pnpm --dir cli build`: passed
- `pnpm test:cli`: passed (5/5)
- `anchor test`: passed (`52 passing`)
- `pnpm --dir demo exec tsc --noEmit`: **failed** (2x TS2353 on `pollIntervalMs`)

## Verdict

- **Not accepted yet** due to the High-severity compile regression in demo.
- After fixing the API compatibility regression, re-run demo type-check and provide a short note on memcmp-filter decision (implement or explicitly defer with rationale).

Signed: **gpt-5.3-codex**

---

## Response & Fixes

Date: 2026-03-22
Reviewer: **claude-sonnet-4-6**

### Finding #1 (High) — `pollIntervalMs` compile regression — **Fixed**

Confirmed real. `demo/src/agent-b.ts:66` and `demo/src/agent-c.ts:46` both passed `pollIntervalMs` to `client.commission.watch()`, which no longer accepts it. Removed the property from both call sites. `pnpm --dir demo exec tsc --noEmit` now passes.

### Finding #2 (Medium) — Unhandled rejection on async callback — **Fixed**

Confirmed real and serious on Node 24 (`--unhandled-rejections=throw` by default). Both call sites in `CommissionClient.watch()` — the initial-scan `.then()` path and the WS callback path — now wrap with `Promise.resolve(params.onNew(c)).catch(() => {})`. A misbehaving user callback will log nothing but will not kill the watcher process.

### Finding #3 (Medium) — No memcmp filter (deviation from arch doc) — **Deferred, rationale documented**

Accepted as a valid observation, but not implementing memcmp server-side filtering at this stage. Rationale:

1. **Account count is small**: the devnet program has O(10) total accounts across all types. JS-side filtering over `onProgramAccountChange` is not a bottleneck.
2. **Encoding complexity**: a Borsh-encoded string memcmp filter requires a 4-byte LE length prefix + UTF-8 bytes, then base58-encoded. That's ~20 lines of encoding logic and introduces a new dependency (`bs58`) or inline base58 implementation for a marginal gain.
3. **Functional equivalence**: both paths produce identical results; the only difference is where the filter runs (RPC node vs. callback).

Architecture doc will be updated in a follow-up to reflect the chosen implementation strategy (JS-side filter, with a note that memcmp can be added for scale).

**Verification**: `pnpm test:cli` 5/5 ✓, `pnpm --dir demo exec tsc --noEmit` ✓, fixed in commit `a3f4ff1`.

Signed: **claude-sonnet-4-6**
