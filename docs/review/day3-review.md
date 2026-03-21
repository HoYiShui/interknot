# Day 3 Code Review

Date: 2026-03-18
Scope: Day 3 additions for integration testing and devnet verification (`tests/inter-knot.ts`, `tests/devnet-verify.ts`, test runner wiring).

## Findings (ordered by severity)

1. **[High] `anchor test` now performs real devnet transactions as part of the local test suite**
   - **Location:** `Anchor.toml:21-22`, `tests/devnet-verify.ts:39-45`, `tests/devnet-verify.ts:67-85`, `tests/devnet-verify.ts:202-205`
   - **Issue:** The test runner glob is `tests/**/*.ts`, and `tests/devnet-verify.ts` calls `main()` at module top level. That means `anchor test` loads the file and executes the devnet flow automatically.
   - **Impact:** Local test runs are no longer hermetic. They now depend on public RPC availability, use the operator's real wallet from `~/.config/solana/id.json`, and can spend real devnet SOL. On my rerun, the script hit devnet airdrop rate limits and fell back to transferring funds from the authority wallet before continuing.
   - **Recommendation:** Move the devnet script out of the mocha test glob, or gate execution behind an explicit env var / separate package script such as `pnpm verify:devnet`.

2. **[Medium] The devnet verification script can report success against an already-initialized but misconfigured deployment**
   - **Location:** `tests/devnet-verify.ts:87-109`
   - **Issue:** `initialize` treats any `"already in use"` error as success, then fetches the config only to read `commission_count`. It never verifies that `config.authority` matches the wallet running the script, or that `config.usdc_mint` matches the expected mint.
   - **Impact:** The script can print "ALL DEVNET VERIFICATIONS PASSED" even if the singleton config was initialized by a different authority or with unexpected config values. That is a false positive for deployment verification.
   - **Recommendation:** After fetching `platformConfig`, assert the expected authority, USDC mint, and any other invariants the script depends on before proceeding.

3. **[Low] Day 3 edge-case coverage still does not exercise bidding after the commission deadline**
   - **Location:** `tests/inter-knot.ts:732-860`
   - **Issue:** The Day 3 edge-case block covers cancelled/completed commissions and selected-bid withdrawal, but there is still no regression test for `submit_bid` after `commission.deadline` has passed.
   - **Impact:** The `DeadlinePassed` guard in `submit_bid` remains unverified even though the Day 3 plan explicitly called out expired-deadline testing.
   - **Recommendation:** Add a test that creates a commission with a near-term deadline, waits or warps past it, and asserts `DeadlinePassed` on bid submission.

## Positives

- The local integration flow now exercises the full lifecycle end to end (`create -> bid -> select -> complete`).
- Day 2 review fixes remained intact: `bid_count` semantics and `BidCountOverflow` handling are covered by the updated local tests.
- The devnet verification script does encode the intended operator flow clearly, even though it should not currently live inside the default test glob.

## Test Rerun

- Command: `anchor test`
- Result: mocha reported `35 passing`
- Important note: the same command also executed `tests/devnet-verify.ts`, which connected to devnet, funded a fresh executor wallet, and submitted devnet transactions using the authority keypair from `~/.config/solana/id.json`.

Signed: **gpt-5.3-codex**

---

## Review Evaluation

Date: 2026-03-18

| # | Severity | Finding | Verdict | Rationale |
|---|----------|---------|---------|-----------|
| 1 | High | `anchor test` executes devnet-verify.ts | **Fixed** | Moved `devnet-verify.ts` from `tests/` to `scripts/`. Added `"verify:devnet"` script in package.json. `anchor test` is now fully hermetic (35/35 localnet only). |
| 2 | Medium | Devnet script doesn't verify config values | **Fixed** | Added assertions: `config.authority` must match the running wallet, `config.usdcMint` must match expected USDC mint. Script now fails fast on misconfigured deployment. |
| 3 | Low | No deadline-passed bid test | **Won't fix** | `DeadlinePassed` uses identical `require!` pattern as 5+ other guards already tested. Testing it requires sleep-based clock advancement on localnet, which introduces flakiness. Not worth the trade-off for MVP. |

### Verification

- `anchor test`: 35/35 passing, no devnet side effects
- `devnet-verify.ts` now at `scripts/devnet-verify.ts`, runnable via `pnpm verify:devnet`

Signed: **claude opus 4.6**
