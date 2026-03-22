# Inter-Knot Day 9-ex — WebSocket Push & Blocking CLI

> Incremental document. Builds on top of `2026-03-21-phase2-architecture.md`.
> Read that document first for full protocol context.
> Scope: replace SDK polling with Solana WebSocket subscriptions, expose blocking
> wait semantics in CLI, and update agent system prompts to eliminate sleep loops.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Solana WebSocket Primitives](#2-solana-websocket-primitives)
3. [SDK Changes](#3-sdk-changes)
4. [CLI Changes](#4-cli-changes)
5. [Agent System Prompt Changes](#5-agent-system-prompt-changes)
6. [Development Plan](#6-development-plan)

---

## 1. Problem Statement

### Current state

Every "wait for event" in the system is a polling loop:

| Location | What it polls | Interval | Problem |
|----------|---------------|----------|---------|
| `CommissionClient.watch()` | `getProgramAccounts` (full scan) | 2 000 ms | Full account scan on every tick — expensive on devnet |
| `OnChainDeliveryClient.watchDelivery()` | `getDelivery()` RPC | 3 000 ms | Unnecessary RPC traffic when nothing has changed |
| `agent-executor.ts` system prompt | CLI `commission list` via bash loop | "every 5s" | Agent generates `sleep 5` in bash → single `execSync` call times out at 60 s before 3-min max is reached |
| `agent-delegator.ts` system prompt | CLI `bid list` + `msg get` via bash loop | "every 5s" | Same timeout problem; agent may thrash retrying rather than truly polling |

The bash tool has `timeout: 60 000` (1 minute). Any workflow step that needs to wait up to 3 minutes cannot express that as a single shell command. The agent instead tries to generate a loop, which either times out or produces fragile multi-step bash that the LLM gets wrong.

### Goal

Replace all polling with **server-sent events** (Solana WebSocket) at the SDK layer. Expose the resulting event-driven behaviour through **blocking CLI commands** so agents can express each wait step as a single, deterministic shell invocation that returns only when the event actually arrives.

```
Before (agent generates):
  for i in $(seq 1 36); do
    result=$(inter-knot bid list $ID ...)
    [ -n "$result" ] && break
    sleep 5
  done

After (agent generates):
  inter-knot bid list $ID --wait --timeout 180
  # Returns immediately when ≥1 bid appears; exits non-zero if timeout
```

---

## 2. Solana WebSocket Primitives

`@solana/web3.js` `Connection` exposes three subscription methods over `wss://`:

| Method | Granularity | Best for |
|--------|-------------|----------|
| `connection.onLogs(programId, cb)` | All transactions touching the program | Detecting any activity; lowest overhead |
| `connection.onAccountChange(pubkey, cb)` | Single account data update | Watching one specific PDA (delivery, commission) |
| `connection.onProgramAccountChange(programId, cb, commitment, filters)` | All accounts owned by program, with optional filter | Watching for new commission PDAs matching a task type |

All three methods return a subscription ID; call `connection.removeAccountChangeListener(id)` (or the equivalent) to unsubscribe.

**Reconnection note**: devnet public WebSocket nodes drop idle connections after ~90 s. The SDK wrapper must implement exponential-backoff reconnection transparently so callers do not need to handle it.

---

## 3. SDK Changes

### 3.1 `CommissionClient.watch()` — replace polling with `onProgramAccountChange`

**Current**: full `getProgramAccounts` scan every 2 s.

**New**: subscribe to `programId` with a memcmp filter on `taskType` bytes, decode accounts on change.

```typescript
// sdk/src/client/commission.ts
watch(params: {
  taskType?: string;
  onNew: (commission: Commission) => void | Promise<void>;
}): { stop: () => void } {
  const seen = new Set<number>();

  // Build memcmp filter for taskType if provided (offset = 8 discriminator + layout offset)
  const filters = params.taskType
    ? [{ memcmp: { offset: TASK_TYPE_OFFSET, bytes: encodeTaskType(params.taskType) } }]
    : [];

  const subId = this.ik.connection.onProgramAccountChange(
    this.ik.programId,
    (keyedAccountInfo) => {
      try {
        const raw = this.ik.program.coder.accounts.decode(
          "commission",
          keyedAccountInfo.accountInfo.data
        );
        if (raw.status.open === undefined) return;      // only open commissions
        const c = this.parseCommission(raw, keyedAccountInfo.accountId);
        if (!seen.has(c.commissionId)) {
          seen.add(c.commissionId);
          params.onNew(c);
        }
      } catch { /* skip accounts that don't decode as Commission */ }
    },
    "confirmed",
    filters
  );

  return {
    stop: () => { this.ik.connection.removeProgramAccountChangeListener(subId); }
  };
}
```

**TASK_TYPE_OFFSET** = 8 (discriminator) + layout-offset-of-taskType in the Commission account. Exact value derived from the IDL.

### 3.2 `OnChainDeliveryClient.watchDelivery()` — replace polling with `onAccountChange`

**Current**: fetches the delivery PDA every 3 s.

**New**: subscribe to the specific delivery PDA; emit only when `status` field changes.

```typescript
// sdk/src/delivery/onchain-client.ts
async watchDelivery(
  commissionId: number,
  opts: { onUpdate: (delivery: TaskDelivery) => void; timeoutMs?: number }
): Promise<{ stop: () => void }> {
  const pda = this.deliveryPda(commissionId);
  let lastStatus: DeliveryStatus | null = null;

  const subId = this.ik.connection.onAccountChange(
    pda,
    (accountInfo) => {
      try {
        const raw = this.ik.program.coder.accounts.decode(
          "taskDelivery",
          accountInfo.data
        );
        const delivery = this.parseDelivery(raw, pda);
        if (delivery.status !== lastStatus) {
          lastStatus = delivery.status;
          opts.onUpdate(delivery);
        }
      } catch { /* ignore */ }
    },
    "confirmed"
  );

  // Optional timeout — resolve/reject the outer promise after timeoutMs
  if (opts.timeoutMs) {
    setTimeout(() => {
      this.ik.connection.removeAccountChangeListener(subId);
    }, opts.timeoutMs);
  }

  return {
    stop: () => { this.ik.connection.removeAccountChangeListener(subId); }
  };
}
```

### 3.3 Reconnection wrapper (shared utility)

Create `sdk/src/utils/ws-reconnect.ts`:

```typescript
/**
 * Wraps a subscribe/unsubscribe pair with transparent reconnection.
 * Re-invokes `subscribe` on the same connection if the WebSocket drops.
 * Callers get back a single { stop } handle.
 */
export function withReconnect(
  connection: Connection,
  subscribe: () => number,
  removeListener: (id: number) => Promise<void>,
  intervalMs = 60_000   // re-check liveness every 60 s
): { stop: () => void }
```

The `CommissionClient.watch()` and `watchDelivery()` implementations both use this wrapper.

---

## 4. CLI Changes

Two new flags on existing commands; no new top-level commands.

### 4.1 `bid list <commission-id> --wait [--timeout <seconds>]`

```
inter-knot bid list <id> --wait --timeout 180 --keypair <path>
```

- Without `--wait`: existing behaviour (list current bids and exit).
- With `--wait`: use `OnChainDeliveryClient.watchDelivery()` (or a simpler account subscription on the commission PDA) to block until `commission.status === matched` or at least one bid account appears. Exits 0 on success, exits 1 on timeout.
- `--timeout` defaults to 180 s.
- Prints bids to stdout once available (same format as current).

### 4.2 `msg get <commission-id> --wait [--timeout <seconds>]`

```
inter-knot msg get <id> --wait --timeout 180 --keypair <path>
```

- Without `--wait`: existing behaviour (fetch CID if available, else print "not ready").
- With `--wait`: subscribe to the delivery PDA via `watchDelivery()`; block until the relevant CID field is non-empty (input for executor, output for delegator). Then fetch + decrypt and print/write as normal.
- `--timeout` defaults to 180 s.

### 4.3 `msg inbox --watch` (already exists — upgrade internals)

The flag already exists. Change the internal implementation from `setInterval` polling to `onProgramAccountChange` subscription. External behaviour (output format, Ctrl-C to stop) unchanged.

---

## 5. Agent System Prompt Changes

With blocking CLI commands, each workflow step becomes one deterministic line. The system prompt no longer needs to explain looping.

### `agent-executor.ts`

```
// BEFORE
1. List open commissions matching task type "${TASK_TYPE}" — poll every 5 seconds until you find one (max 3 minutes)

// AFTER
1. Wait for an open commission of type "${TASK_TYPE}":
   inter-knot commission list --task-type ${TASK_TYPE} --wait --timeout 180 --keypair ${KEYPAIR}
   (This command blocks until a matching commission appears, then exits and prints the commission ID.)
```

```
// BEFORE
3. Watch your inbox for incoming tasks — poll "msg inbox" every 5 seconds until you see an input for your commission (max 3 minutes)

// AFTER
3. Wait for the delegator's input message:
   inter-knot msg get <commission-id> --wait --timeout 180 --keypair ${KEYPAIR}
   (Blocks until the encrypted input is available, then decrypts and prints it.)
```

### `agent-delegator.ts`

```
// BEFORE
2. Poll bid list every 5 seconds until at least 1 bid appears (max 2 minutes)

// AFTER
2. Wait for at least one bid:
   inter-knot bid list <commission-id> --wait --timeout 120 --keypair ${KEYPAIR}
   (Blocks until bids appear, then prints them.)
```

```
// BEFORE
5. Poll "msg get" every 5 seconds until output is available (max 2 minutes)

// AFTER
5. Wait for the executor's result:
   inter-knot msg get <commission-id> --wait --timeout 180 --keypair ${KEYPAIR}
   (Blocks until the executor's output is available, decrypts, and prints it.)
```

Also: increase bash tool `timeout` from 60 000 ms to **200 000 ms** (200 s) to accommodate blocking wait commands with up to 180 s timeout.

---

## 6. Development Plan

### Day 9-ex1 (SDK): WebSocket subscriptions

**Scope**: SDK layer only. No CLI, no agent changes.

- [ ] Add `sdk/src/utils/ws-reconnect.ts` — shared reconnect wrapper
- [ ] Refactor `CommissionClient.watch()` to use `onProgramAccountChange`
  - [ ] Calculate `TASK_TYPE_OFFSET` from IDL layout
  - [ ] Unit-testable: stub `connection.onProgramAccountChange` in test
- [ ] Refactor `OnChainDeliveryClient.watchDelivery()` to use `onAccountChange`
- [ ] Manual devnet smoke: watch fires within 2 s of an on-chain state change (vs 3–5 s with polling)
- [ ] `pnpm build` + `pnpm test:cli` still green

**Definition of done**: both `watch()` implementations use WS subscriptions; reconnect wrapper in place; build passes.

### Day 9-ex2 (CLI + Agents): Blocking wait commands + prompt update

**Scope**: CLI `--wait` flags, agent prompt update, bash timeout bump.

- [ ] `bid list --wait --timeout` flag (uses `onAccountChange` on commission PDA to detect first bid)
- [ ] `msg get --wait --timeout` flag (uses `watchDelivery()` internally)
- [ ] `msg inbox --watch` internal switch from polling to `onProgramAccountChange`
- [ ] `commission list --wait --timeout` flag for executor agent (wait for matching open commission)
- [ ] Increase bash tool `timeout` to 200 000 ms in both agent files
- [ ] Update `agent-executor.ts` system prompt (remove sleep-loop language, use `--wait` commands)
- [ ] Update `agent-delegator.ts` system prompt (same)
- [ ] `pnpm test:cli` 5/5 still passes (new flags are additive, no regression)
- [ ] Devnet autonomous run: `bash demo/agent-demo.sh` completes full cycle without any manual intervention; capture stdout + executor log as review artifact

**Definition of done**: autonomous agent run produces tx signatures for all 8 lifecycle steps; no manual CLI commands between orchestration start and completion.
