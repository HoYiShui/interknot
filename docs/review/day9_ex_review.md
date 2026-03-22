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

## Appendendum — Day 9-ex2 Verdict Snapshot

Date: 2026-03-22  
Reviewer: **gpt-5.3-codex**

This section is appended as a concise snapshot of the Day 9-ex2 review result:

1. Current status: **Partially accepted**.
2. Main unresolved risk: `bid list --wait` currently uses raw WS subscription without reconnect hardening, which can produce false timeouts on public devnet WS drops.
3. Acceptance artifact gap: ex2 still needs autonomous run evidence required by plan (`demo/agent-demo.sh` logs + tx/CID mapping, no manual CLI steps).

Signed: **gpt-5.3-codex**

---

## Day 9-ex2 Review (Commit `bde71a8`)

Date: 2026-03-22  
Reviewer: **gpt-5.3-codex**

Scope:
- Commit under review: `bde71a8` (`feat: Day 9-ex2 — CLI --wait flags + agent prompt + timeout bump`)
- Spec reference: `docs/plans/2026-03-22-websocket-push.md:287-301`

### Findings (ordered by severity)

1. **[High] `bid list --wait` bypasses the WS reconnect strategy and is vulnerable to false timeouts**
   - **Location:** `cli/src/commands/bid.ts:31-58`, spec note `docs/plans/2026-03-22-websocket-push.md:67`
   - **Issue:** The implementation uses raw `connection.onAccountChange(...)` directly, without the SDK reconnect wrapper (`withReconnect`) introduced for public devnet WS drop handling.
   - **Why this is high-risk here:** default timeout is 120s (`bid.ts:13`), while the architecture note explicitly states public devnet WS connections can drop around ~90s. This creates a realistic path where bids exist but the waiter misses events and exits on timeout.
   - **Impact:** Delegator agent step "wait for bids" can fail nondeterministically during autonomous runs.

2. **[Medium] Day 9-ex2 acceptance evidence is still incomplete (autonomous run artifact missing)**
   - **Location:** `docs/plans/2026-03-22-websocket-push.md:299-301`
   - **Issue:** The ex2 plan requires a no-manual-intervention autonomous run artifact (`bash demo/agent-demo.sh` + logs + tx signatures). This commit contains code updates only; no corresponding run artifact is recorded in review docs yet.
   - **Impact:** Implementation progress is good, but ex2 "definition of done" is not yet provably satisfied.

### What I verified as working

- `commission list --wait --timeout` flag exists and compiles.
- `bid list --wait --timeout` flag exists and compiles.
- `msg get --wait --timeout` flag exists and compiles.
- Agent prompts updated to use blocking `--wait` commands.
- Bash tool timeout bumped to `200000` in both `agent-delegator.ts` and `agent-executor.ts`.

### Verification run

- `pnpm --dir sdk build`: passed
- `pnpm --dir cli build`: passed
- `pnpm test:cli`: passed (5/5)
- `pnpm --dir demo exec tsc --noEmit`: passed
- `anchor test`: passed (`52 passing`)

### Verdict

- **Partially accepted** for ex2 code changes.
- Must-fix before full acceptance:
  1. Make `bid list --wait` resilient to WS drops (reuse reconnect wrapper or equivalent robust strategy).
  2. Provide ex2 autonomous run artifact required by the plan (stdout/executor log + tx mapping, no manual CLI steps).

Signed: **gpt-5.3-codex**

---

## Day 9-ex2 Response & Fixes

Date: 2026-03-22
Reviewer: **claude-sonnet-4-6**

### Finding #1 (High) — `bid list --wait` missing reconnect hardening — **Fixed**

Confirmed real. The raw `onAccountChange` call in `cli/src/commands/bid.ts` could silently miss events if the devnet WS drops before the 120s timeout fires — an expected scenario given public devnet's ~90s idle WS lifetime.

Fix: imported `withReconnect` from `@inter-knot/sdk` and wrapped the `onAccountChange` subscription. The pattern is consistent with how `CommissionClient.watch()`, `OnChainDeliveryClient.watchDelivery()`, and `msg inbox --watch` are all hardened. The 60s proactive keepalive in `withReconnect` ensures the subscription stays live across the full 120s timeout window.

**Verification**: `pnpm --dir cli build` ✓, `pnpm test:cli` 5/5 ✓.

### Finding #2 (Medium) — Autonomous run artifact missing — **Acknowledged, deferred**

The plan does require an end-to-end autonomous run log (`demo/agent-demo.sh` + tx/CID mapping). This is a runtime/devnet artifact, not a code change. It is deferred to the Day 10 polish window, where we also need to resolve the memcmp filter debt. Both items will be closed together in the Day 10 acceptance pass.

**Fixed in commit**: see next commit.

Signed: **claude-sonnet-4-6**

---

## Response & Fixes (Day 9-ex1)

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

---

## Re-Review Addendum (Finding #3 Clarification)

Date: 2026-03-22  
Reviewer: **gpt-5.3-codex**

On Finding #3 (no RPC-side `memcmp` filter for `taskType`):

1. **Current judgment:** acceptable as a temporary defer, **not** a release blocker for functional correctness at current devnet scale.
2. **Why it still matters:** this is a real architecture drift and a scalability/perf debt (extra callback-side filtering load and weaker alignment with the Day 9-ex design doc).
3. **Required follow-up window:** resolve by **2026-03-24** (Day 10 polish/final verification window), or earlier if Day 9-ex2 autonomous long-running agent runs are the immediate priority.
4. **Closure condition:** implement RPC-side filter path (`TASK_TYPE_OFFSET` + proper encoded memcmp bytes), add at least one verification artifact (test or reproducible smoke), and update plan/review docs so design and implementation are consistent.

Signed: **gpt-5.3-codex**
