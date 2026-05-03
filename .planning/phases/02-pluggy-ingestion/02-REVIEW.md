---
phase: 02-pluggy-ingestion
reviewed: 2026-05-02T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - .env.example
  - docs/ops/integration-tests.md
  - docs/ops/local-dev-setup.md
  - package.json
  - src/app/api/connect/init/route.ts
  - src/lib/cpf.ts
  - src/lib/cpfServer.ts
  - src/lib/crypto.ts
  - src/lib/env.ts
  - tests/fixtures/db.ts
  - tests/fixtures/env-runner/env-runner.ts
  - tests/fixtures/integration-globals.ts
  - tests/integration/observability/env-assert.test.ts
  - tests/unit/lib/cpf-client-isolation.test.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 02: Code Review Report (Gap-closure plans 02-07 / 02-08 / 02-09)

**Reviewed:** 2026-05-02
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

The three gap-closure plans land cleanly. The client/server CPF split (02-07) is correct: `src/lib/cpf.ts` is now pure (no server-only transitive imports) and `src/lib/cpfServer.ts` carries the `import 'server-only'` marker plus the encryption wrapper. The env-assert good-fixture (02-08) covers the new Phase 2 OPS-04 refines (`PLUGGY_ENV=production`, `PLUGGY_ITEM_ID_HASH_PEPPER`, `SERVICE_NAME=web`) and the local-dev runbook documents the env-loading model accurately. The single-fork + globalThis singleton pattern (02-09) is well-justified and matches what `vitest.config.ts` and `tests/fixtures/db.ts` actually implement.

No critical security or correctness defects. The findings below are pre-existing concerns surfaced during review of the touched files (route.ts ordering, base64 alphabet, dead local) plus a handful of low-risk consistency / robustness suggestions on the new test infrastructure. None block merge of phases 02-07/02-08/02-09.

## Warnings

### WR-01: `/api/connect/init` writes consent row before IDOR check, leaving orphaned rows on 404

**File:** `src/app/api/connect/init/route.ts:87-110`
**Issue:** Step 4 (`INSERT user_consents` with `scope='PLUGGY_CONNECT_PENDING'`) runs unconditionally before step 5 (the reconnect_item_id IDOR check). When step 5 fails with 404 (item not found or owned by another user), the consent row is already committed with no compensating delete. Same problem if the subsequent `getPluggyService().createConnectToken()` call throws — orphan `PLUGGY_CONNECT_PENDING` rows accumulate per failed reconnect attempt and pollute LGPD audit queries.
**Fix:** Either (a) reorder so the IDOR check runs before the consent insert, or (b) wrap steps 4-6 in `db.transaction(async (tx) => ...)` so a thrown error rolls back the consent row. Option (a) is the smaller change:
```typescript
// 4a. Reconnect path: load + IDOR-check the item BEFORE recording consent.
let reconnect_item_id_enc: Buffer | undefined;
if (body.reconnect_item_id) {
  const itemRows = await db.select(...).from(pluggy_items)
    .where(eq(pluggy_items.id, body.reconnect_item_id)).limit(1);
  if (!itemRows[0] || itemRows[0].user_id !== session.userId) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  reconnect_item_id_enc = itemRows[0].pluggy_item_id_enc as Buffer;
}

// 4b. Pre-widget consent row (only after all auth/validation passes).
await db.insert(user_consents).values({ ... });
```

### WR-02: `has_cpf` detection by Buffer length is fragile and silently breaks on format change

**File:** `src/app/api/connect/init/route.ts:70`
**Issue:** `const has_cpf = user.cpf_enc && (user.cpf_enc as Buffer).byteLength !== 44;` conflates "user has a real CPF" with "cpf_enc is not 44 bytes long". The 44-byte placeholder size is an implementation detail of `signupCore` (Plan 02-01). If signupCore ever changes the placeholder length (e.g., 32 bytes), or if a future migration writes a placeholder of a different shape, this comparison silently flips and the route stops requiring CPF for new users — a P28 violation that no test would catch because the byte-length contract isn't asserted anywhere.
**Fix:** Add an explicit nullable column (`users.cpf_set_at timestamp` or `users.has_cpf boolean default false`) that signupCore leaves NULL/false and `/api/connect/init` flips on first real CPF. Until that schema change lands, at minimum extract the magic numbers to named constants and add a unit test pinning the placeholder length:
```typescript
// In src/lib/cpf.ts (or a new constants file)
export const CPF_PLACEHOLDER_BYTES = 44; // signupCore writes randomBytes(44).
export const CPF_ENCRYPTED_BYTES = 39;   // 12 (iv) + 16 (tag) + 11 (cpf).

// In route.ts
const has_cpf = !!user.cpf_enc && (user.cpf_enc as Buffer).byteLength === CPF_ENCRYPTED_BYTES;
```

### WR-03: `ENCRYPTION_KEY` regex accepts URL-safe base64 but `Buffer.from(s, 'base64')` cannot decode it

**File:** `src/lib/env.ts:43`
**Issue:** The regex `/^[A-Za-z0-9+/=_-]+$/` accepts both standard base64 (`+/=`) and URL-safe base64 (`-_=`). However, `Buffer.from(s, 'base64')` in Node.js strictly decodes the standard alphabet — URL-safe `-` and `_` characters are silently treated as garbage. Node's base64 decoder is lenient enough that the byte-length refine (`length === 32`) may still pass for a URL-safe input, leaving you with a 32-byte key silently different from the operator-supplied secret. Consequence: every CPF encrypted with the corrupted key is unrecoverable on a future key rotation.
**Fix:** Tighten the regex to standard base64 only — matches the runbook's `openssl rand -base64 32` instruction:
```typescript
ENCRYPTION_KEY: z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'ENCRYPTION_KEY must be standard base64 (no URL-safe alphabet)')
  .refine((s) => Buffer.from(s, 'base64').length === 32, ...)
```
Same applies to any future base64-encoded secret. (`CPF_HASH_PEPPER` and `PLUGGY_ITEM_ID_HASH_PEPPER` are validated as raw strings min-32, not base64, so they're unaffected.)

### WR-04: Trust-on-first-write of `x-forwarded-for` for LGPD audit `ip_address`

**File:** `src/app/api/connect/init/route.ts:92`
**Issue:** `ip_address: req.headers.get('x-forwarded-for') ?? null` writes the raw header value. If the deployment ever runs without a proxy that overrides client-supplied XFF (or behind a misconfigured ALB / CloudFront origin), an attacker can forge their own `X-Forwarded-For: 1.2.3.4` and pollute the LGPD audit trail with arbitrary IPs. The audit row claims to record "IP at time of consent" — that becomes a lie in the threat model.
**Fix:** Centralize IP extraction in a helper that (a) only honors XFF when a `TRUSTED_PROXY` env flag is set, (b) parses XFF as a comma-separated list and takes the leftmost entry, and (c) falls back to a Next.js / Node-level remote address. Until that helper exists, document the trust boundary in code:
```typescript
// TODO(SEC): only trust XFF when behind a known proxy (Copilot ALB sets it).
// For local dev / direct connections, this header is attacker-controlled.
const client_ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
```
Warning rather than Critical because the Phase 2 deployment plan puts the route behind Copilot ALB which always overwrites XFF; the bug bites only if that assumption changes.

## Info

### IN-01: Inconsistent pepper encoding in `crypto.ts` — `string` vs `Buffer.from(pepper, 'utf8')`

**File:** `src/lib/crypto.ts:55,80`
**Issue:** `hashCPF` passes `env.CPF_HASH_PEPPER` directly as a string to `createHmac`, while `hashPluggyItemId` wraps the pepper in `Buffer.from(pepper, 'utf8')`. Functionally equivalent (Node coerces string keys to UTF-8 internally), but the inconsistency reads as if one form is "more correct" than the other.
**Fix:** Pick one and apply consistently. Recommend the explicit `Buffer.from(..., 'utf8')` form everywhere — it documents intent:
```typescript
export function hashCPF(plaintext: string): Buffer {
  return createHmac('sha256', Buffer.from(env.CPF_HASH_PEPPER, 'utf8')).update(plaintext).digest();
}
```

### IN-02: `booted` local in `integration-globals.ts` is written but never read

**File:** `tests/fixtures/integration-globals.ts:25,31,40`
**Issue:** `let booted: TestDb | null = null;` is assigned in `setup()` and reset in `teardown()`, but no code path ever reads it. The singleton state lives on `globalThis` inside `db.ts`; this module-scope variable is dead and will be flagged by `noUnusedLocals` if that ever turns on.
**Fix:** Remove the local — `setup()` only needs `await startTestDb()` for its side effect on `process.env.TEST_DATABASE_URL`:
```typescript
export async function setup(): Promise<void> {
  const td = await startTestDb();
  process.env.TEST_DATABASE_URL = td.url;
}
export async function teardown(): Promise<void> {
  await stopSharedTestDb();
  delete process.env.TEST_DATABASE_URL;
}
```

### IN-03: `cpf-client-isolation.test.ts` regex misses dynamic `import()` and `require()` calls

**File:** `tests/unit/lib/cpf-client-isolation.test.ts:28`
**Issue:** `IMPORT_RE = /^\s*import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm` only matches static `import ... from '...';` statements at line start. It will not catch:
- Dynamic `await import('@/lib/crypto')` (could re-introduce the leak via lazy import).
- `require('@/lib/crypto')` (CJS, less likely in this codebase but possible in a generated file).
- `import type { ... } from '@/lib/crypto';` (type-only — would actually be safe, but currently silently skipped).
**Fix:** Add patterns for dynamic import + require:
```typescript
const STATIC_IMPORT_RE = /^\s*import\s+(?:type\s+)?(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
```
Low priority — the codebase doesn't currently use dynamic imports for these modules, but the test claims to be a regression guard and should be tight enough that someone can't sneak the violation back via `await import(...)`.

### IN-04: `package.json` `start:worker` env-file order is opposite of `.env.example` comment

**File:** `package.json:14` vs `.env.example:13`
**Issue:** `package.json` runs `tsx --env-file-if-exists=.env --env-file-if-exists=.env.local`. With `tsx`, the later flag wins, so `.env.local` overrides `.env`. `.env.example` line 13 says `pnpm start:worker -> .env.local + .env`, which reads as "load `.env.local` first then layer `.env` on top" — the opposite of actual behavior. The runbook (`docs/ops/local-dev-setup.md` line 25) is correct.
**Fix:** Update the `.env.example` comment so contributors don't expect `.env` to override `.env.local`:
```
# - `pnpm start:worker`            -> .env then .env.local (later overrides; tsx --env-file-if-exists, see package.json).
```

### IN-05: `env-runner.ts` patches `Module._cache` via `as any` — undocumented Node internals dependency

**File:** `tests/fixtures/env-runner/env-runner.ts:29-38`
**Issue:** The fixture writes directly to `Module._cache`, a Node.js internal whose shape has changed across major versions and is officially "use at your own risk". This works on Node 24 today but is fragile if the integration tests ever pin a different Node line. The comment block already calls out the risk.
**Fix:** Optional — switch to `Module.register()` + a loader hook (Node 20.6+) or use the `--import` flag with a tiny loader that returns `export default {}` for the `server-only` specifier. For now, leave the hack in place but be aware of it on Node minor bumps; the env-assert good-path test will fail loudly if it breaks.

### IN-06: `env.ts` reads `process.env.NEXT_PHASE` directly inside refines instead of validating it on the schema

**File:** `src/lib/env.ts:109,158,179`
**Issue:** Three `.refine()` blocks dereference `process.env.NEXT_PHASE` to bypass OPS-04 during `next build`. This works, but it bypasses Zod's schema parsing — a typo'd `NEXT_PHASE` (e.g. `next_phase`) would silently never bypass, and a typo'd value comparison (e.g. `phase-prod-build`) would be undetectable except by manual inspection. Reading via the parsed schema centralizes validation.
**Fix:**
```typescript
NEXT_PHASE: z.string().optional(),
// ...
.refine((e) => {
  if (e.NODE_ENV !== 'production') return true;
  if (e.NEXT_PHASE === 'phase-production-build') return true;
  // ...
})
```
Optional — the current pattern is documented in three comments and works correctly.

---

_Reviewed: 2026-05-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
