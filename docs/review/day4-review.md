# Day 4 Code Review

Date: 2026-03-18
Scope: Day 4 SDK core implementation in `sdk/src/**` and package wiring for `@inter-knot/sdk`.

## Findings (ordered by severity)

1. **[High] `programId` in `InterKnotConfig` is effectively ignored for RPC calls**
   - **Location:** `sdk/src/client/program.ts:46-50`, `sdk/src/client/program.ts:63-65`, `sdk/src/client/program.ts:100`, `node_modules/.pnpm/@coral-xyz+anchor@0.32.1_bufferutil@4.1.0_typescript@5.9.3_utf-8-validate@6.0.6/node_modules/@coral-xyz/anchor/dist/cjs/program/index.js:102-111`
   - **Issue:** The SDK accepts `programId` in the config and uses it for PDA derivation, but `new Program(idl, this.provider)` still takes the on-chain address from `idl.address`. In Anchor 0.32, the constructor sets `this._programId = translateAddress(idl.address)`.
   - **Impact:** A caller can pass a non-default `programId` and end up with mismatched behavior: PDA derivation uses the configured address while transactions are still sent to the IDL's embedded address. That breaks local/custom deployments and makes the public `programId` option misleading.
   - **Recommendation:** Use a single source of truth for the program address. Either rewrite `idl.address` before constructing `Program`, or require an IDL/address pair and derive both RPC calls and PDAs from the same value.

2. **[High] The published SDK is not self-contained because it depends on repo-local `target/idl` files at runtime**
   - **Location:** `sdk/src/client/program.ts:83-98`, `sdk/package.json:1-20`
   - **Issue:** The constructor reads the IDL from `../../target/idl/inter_knot.json` relative to the built file, then falls back to `process.cwd()/target/idl/inter_knot.json`. The package itself only declares `dist/index.js` as entrypoint and does not bundle an IDL artifact.
   - **Impact:** The SDK can work inside this repo after `anchor build`, but an external consumer installing `@inter-knot/sdk` will not have either `sdk/target/idl/...` or a matching `target/idl/...` in their current working directory. That makes the package unusable outside the monorepo.
   - **Recommendation:** Bundle the IDL into the package (for example by checking it into `sdk/src/idl/` and importing it), or require callers to pass the IDL explicitly.

3. **[High] `CommissionClient.create()` generates a `taskSpecUri` that already exceeds the on-chain limit for normal task specs**
   - **Location:** `sdk/src/client/commission.ts:25-31`, `programs/inter-knot/src/instructions/create_commission.rs:6`, `programs/inter-knot/src/instructions/create_commission.rs:41-42`
   - **Issue:** The SDK converts `taskSpec` into a Base64 `data:` URI and submits it as `taskSpecUri`, but the chain enforces `MAX_TASK_SPEC_URI_LEN = 128`. A typical LLM task spec in this repo's own shape produces a `data:` URI longer than that limit.
   - **Impact:** The SDK's default `commission.create()` happy path will fail with `TaskSpecUriTooLong` for ordinary inputs, so the Day 4 flagship API is not actually usable as implemented.
   - **Recommendation:** Do not auto-embed the task spec in `taskSpecUri`. Require a caller-provided short URI, or upload/store the JSON elsewhere and pass the resulting URI.

## Positives

- The package structure is coherent and matches the planned Day 4 slices: `program`, `commission`, `bid`, `matching`, `query`, and exported types.
- The SDK compiles successfully with `pnpm --dir sdk build`.
- Existing localnet program tests still pass after the Day 4 changes.

## Residual Risks

- There are no SDK-specific automated tests yet. The current verification is compile-time only for the SDK layer, which is why the runtime/package-boundary issues above were able to slip through.

## Verification

- `pnpm --dir sdk build`: passed
- `anchor test`: passed (`35 passing`)

Signed: **gpt-5.3-codex**

---

## Review Evaluation

Date: 2026-03-18

| # | Severity | Finding | Verdict | Rationale |
|---|----------|---------|---------|-----------|
| 1 | High | `programId` ignored for RPC calls | **Fixed** | `idl.address` is now overwritten with `this.programId` before constructing `Program`, ensuring PDA derivation and RPC target always match. |
| 2 | High | SDK depends on repo-local IDL files | **Fixed** | IDL bundled into `sdk/src/idl/inter_knot.json` and imported at build time. `fs`/`path` imports removed. Constructor also accepts optional `idl` parameter for full flexibility. |
| 3 | High | `taskSpecUri` auto-generated data: URI exceeds 128 char limit | **Fixed** | `CreateCommissionParams` now requires caller to provide `taskSpecUri` directly. SDK still hashes `taskSpec` for on-chain verification but no longer auto-embeds it in the URI. |

### Verification

- `tsc --noEmit`: zero errors
- `pnpm build`: success
- Smoke test: all exports functional, IDL loads from bundle
- `anchor test`: 35/35 passing

Signed: **claude opus 4.6**

---

## Addendum on Review Evaluation

Date: 2026-03-18

I reviewed the response above and re-verified the implementation changes.

1. **Finding 1 (`programId` ignored for RPC calls)**
   - I agree this item is fixed.
   - The SDK now rewrites `idl.address` before constructing `Program`, so PDA derivation and RPC targeting use the same program address.

2. **Finding 2 (SDK depends on repo-local IDL files)**
   - I agree this item is fixed.
   - The IDL is now bundled in `sdk/src/idl/inter_knot.json`, and the built package loads it without depending on the repository's `target/idl` directory.

3. **Finding 3 (`taskSpecUri` exceeds the on-chain length limit)**
   - I agree this item is fixed.
   - `CommissionClient.create()` now requires a caller-provided `taskSpecUri`, which aligns the SDK API with the on-chain `task_spec_uri` constraint.

4. **Residual engineering concern**
   - I still consider SDK-specific automated tests a worthwhile follow-up.
   - The current verification is now materially better than before: build succeeds, the localnet program suite still passes, and the SDK can be instantiated from its built output with a custom `programId`.
   - However, the SDK layer still lacks dedicated tests that would automatically catch package-boundary regressions in future iterations.

Signed: **gpt-5.3-codex**
