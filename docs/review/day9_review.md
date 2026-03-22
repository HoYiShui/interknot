# Day 9 Code Review

Date: 2026-03-21
Scope: Day 9 commit `2b1284f` (`CLI msg commands + agent integration`), reviewed against Phase 2 Day 9 plan in `docs/plans/2026-03-21-phase2-architecture.md:483-498`.

## Findings (ordered by severity)

1. **[High] `agent-demo.sh` reads demo wallets with the wrong JSON shape and will fail before agents start**
   - **Location:** `demo/agent-demo.sh:31-32`, `demo/src/config.ts:25-40`
   - **Issue:** The script writes keypair files using `w.agentA.secretKey` / `w.agentB.secretKey`, but `.demo-wallets.json` stores `agentA` and `agentB` directly as `number[]`.
   - **Impact:** Agent orchestration fails early, so the Day 9 autonomous demo cannot run as advertised.
   - **Evidence:** local repro of `Array.from(w.agentA.secretKey)` returns `undefined is not iterable`.

2. **[High] Delegator agent prompt is inconsistent with the CLI contract and likely fails on commission creation**
   - **Location:** `demo/src/agent-delegator.ts:24`, `cli/src/commands/commission.ts:13`
   - **Issue:** The prompt tells the agent to call `inter-knot commission create` without `--spec`, but `--spec` is a required CLI option.
   - **Impact:** The agent's first workflow step is likely to fail or thrash, reducing reliability of the "autonomous full-cycle" claim.

3. **[High] Day 9 CLI smoke validation is not currently green in this branch**
   - **Location:** `scripts/cli-smoke-test.ts:27`, runtime import path in `sdk/dist/index.js`
   - **Issue:** `pnpm test:cli` fails with `ERR_MODULE_NOT_FOUND` when executing `node cli/dist/index.js --help`, due to ESM module resolution on SDK dist imports.
   - **Impact:** Day 9 plan includes a CLI smoke-test milestone; this is currently not satisfied in runnable terms.

4. **[Medium] `msg send` does not explicitly validate matched commission state before dereferencing selected executor**
   - **Location:** `cli/src/commands/msg.ts:40-53`
   - **Issue:** The code accesses `commission.selectedExecutor!` without a prior explicit matched-state check and without a clear user-facing error path for unmatched commissions.
   - **Impact:** Error handling is brittle and can produce confusing failures outside expected happy paths.

5. **[Medium] Day 9 additions are not covered by the existing CLI smoke test**
   - **Location:** `scripts/cli-smoke-test.ts:26-67`, Day 9 checklist `docs/plans/2026-03-21-phase2-architecture.md:486-489`
   - **Issue:** The smoke test still checks only the old command set and does not validate:
     - `msg send` / `msg get` / `msg inbox`
     - `bid submit --delivery-method` behavior
   - **Impact:** Regressions in the Day 9 command surface can ship without automated signal.

## Plan Alignment (Day 9)

- Implemented in code: `msg` command group, `--delivery-method` flag, agent script files.
- Not yet convincing as complete:
  - CLI smoke test for Day 9 additions is not present and current root smoke command is failing.
  - Agent demo script has a blocking wallet parsing bug.
  - Autonomous agent prompt contract has at least one required-arg mismatch.

## Verification

- `pnpm --dir demo exec tsc --noEmit`: passed
- `pnpm --dir cli build`: passed
- `anchor test`: passed (`52 passing`)
- `pnpm test:cli`: **failed**
  - `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/hoyishui/Projects/SolanaHackathon/sdk/dist/client/program' imported from /Users/hoyishui/Projects/SolanaHackathon/sdk/dist/index.js`

---

## Response & Fixes

Date: 2026-03-22
Reviewer: **claude-sonnet-4-6**

All 5 findings accepted and fixed. Verification: `pnpm test:cli` passes (5/5), `pnpm --dir demo exec tsc --noEmit` passes.

### Finding #1 (High) — agent-demo.sh wallet shape bug — **Fixed**

`demo/agent-demo.sh:31-32`: Changed `Array.from(w.agentA.secretKey)` → `w.agentA` (and same for agentB). The `.demo-wallets.json` format stores agents directly as `number[]`, not as objects with a `secretKey` field. This was confirmed by reading `demo/src/config.ts`'s `saveWallets()` and `DemoWallets` interface.

### Finding #2 (High) — delegator prompt missing `--spec` — **Fixed**

`demo/src/agent-delegator.ts`: Added `--spec '<json>'` to the available command example for `commission create`, and updated workflow step 1 to include `spec '{"model":"llama-3-8b","maxTokens":512}'`. This matches the `--spec <json>` `requiredOption` in `cli/src/commands/commission.ts:13`.

### Finding #3 (High) — SDK ESM module resolution — **Fixed**

Root cause: `moduleResolution: "bundler"` doesn't add `.js` extensions to relative imports in compiled output. Node.js ESM requires explicit extensions.

Fix:
1. `sdk/tsconfig.json`: Changed `module: "ES2020"` → `"NodeNext"`, `moduleResolution: "bundler"` → `"NodeNext"`.
2. Added `.js` extension to all relative imports in 8 SDK source files (`index.ts`, `client/program.ts`, `client/commission.ts`, `client/bid.ts`, `client/matching.ts`, `client/query.ts`, `delivery/onchain-client.ts`, `delivery/irys-client.ts`).
3. Added `with { type: "json" }` import attribute to the IDL JSON import in `client/program.ts` (required by NodeNext).

`@noble/*` imports (e.g., `@noble/curves/ed25519.js`) were unaffected — they already used package export paths with `.js` suffix.

### Finding #4 (Medium) — msg send commission state validation — **Fixed**

`cli/src/commands/msg.ts`: Added explicit check after role determination: reads `Object.keys(commission.status)[0]` and throws a clear error if the status is not `"matched"`. This prevents the `selectedExecutor!` non-null assertion from silently producing an undefined value for commissions in Open/Cancelled/Completed states.

### Finding #5 (Medium) — smoke test missing Day 9 coverage — **Fixed**

`scripts/cli-smoke-test.ts`: Expanded from 4 to 5 steps. Step 5 checks:
- `msg --help` includes `send`, `get`, `inbox`
- `bid submit --help` includes `delivery-method`

Signed: **claude-sonnet-4-6**

