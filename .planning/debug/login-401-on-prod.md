---
slug: login-401-on-prod
status: root_cause_confirmed
trigger: "Login 401 on prod (POST /api/auth/login) — needs investigation."
created: 2026-05-01
updated: 2026-05-01
goal: find_root_cause_only
scope: read_only
---

# Debug: Login 401 on Prod

## Symptoms

- **Endpoint:** `POST https://portalfinance.app/api/auth/login`
- **Status:** `401 Unauthorized`
- **Response:** `content-type: application/json`, `content-length: 93` (small JSON body — exact body not yet captured)
- **Edge:** Cloudflare in front of origin (`cf-ray: 9f50a8542dbbf233-GRU`, `server: cloudflare`, `cf-cache-status: DYNAMIC`)
- **Origin reachable:** yes (DYNAMIC cache status implies request reached origin and origin returned 401, not Cloudflare WAF block)
- **Browser:** Chrome 147 on Windows, Referer `https://portalfinance.app/login`
- **Request locale headers:** `accept-language: pt-BR`
- **Timeline:** Never worked on prod (no regression — broken since prod came up)
- **Repro:** Known-valid user from prod DB (account row + password verified by user)
- **Local status:** Not yet confirmed whether same flow works locally — investigate
- **Scope from user:** Read-only investigation first; no prod changes, no code changes until approved

## Initial Hypotheses (status updated)

1. ~~**Auth.js misconfiguration on prod**~~ — ELIMINATED for the user-reported endpoint. `POST /api/auth/login` is a CUSTOM route (`src/app/api/auth/login/route.ts`), not the Auth.js v5 catch-all. AUTH_SECRET / trustHost paths do not gate this handler.
2. ~~**Argon2 verify failure path**~~ — Possible in principle, but only reachable AFTER Zod parse, rate-limit, and Turnstile gates. See H7 below — Zod parse fails first.
3. **CPF/email lookup mismatch** — N/A. The custom login route only reads `users.email` (plain text, lowercased) — no CPF involvement. Schema confirms `email text NOT NULL` with `users_email_unique`. This hypothesis would only matter if signup stored emails differently — not the case.
4. ~~**Trusted host / CSRF rejection**~~ — ELIMINATED. The custom route does not invoke Auth.js `trustHost`. Auth.js v5 config has `trustHost: true` anyway.
5. **Custom `/api/auth/login` route shape** — CONFIRMED. Custom route has FIVE distinct return paths (one 400, three 401, one 429). Three of those 401 paths are pre-auth guards.
6. **Cookie/secure flag** — Not the cause of the 401. Cookie issues would manifest as a successful POST followed by /dashboard redirecting back to /login.
7. **Zod parse rejects `turnstileToken: null`** — **CONFIRMED.** Captured response body is exactly `{"ok":false,"error":"E-mail ou senha incorretos."}` (50 bytes), matching the Zod-parse 401 branch at `src/app/api/auth/login/route.ts:50-54`. The earlier `content-length: 93` reading was the REQUEST content-length conflated with the response. Bug reproduces deterministically on every first login attempt.

## Current Focus

- **hypothesis:** H7 — `LoginForm.tsx` always sends `turnstileToken: null` (initial state of `useState<string | null>(null)`). The `LoginSchema` declares `turnstileToken: z.string().optional()`, which in Zod accepts `string | undefined` but REJECTS explicit `null`. Every login request fails Zod parse and the handler returns 401 at `route.ts:50–54`. **CONFIRMED by captured response body.**
- **next_action:** none (root cause confirmed; fix proposed but not applied per read-only scope).
- **expecting:** N/A — investigation complete.
- **reasoning_checkpoint:** The 50-byte captured body uniquely identifies the Zod-fail branch. No 5th 401 source exists. No edge layer rewrites the body. Fargate image is not stale. Diagnosis is unambiguous.

## Evidence

- timestamp: 2026-05-01
  source: `src/app/api/auth/login/route.ts`
  observation: Custom route, 5 return branches:
    - **400** `Corpo inválido.` (line 42–46) — body size 39
    - **401** Zod parse fail, `E-mail ou senha incorretos.` (line 50–54) — body size **50**
    - **429** Account-lock branch (line 70–77) — body size 77
    - **401** Turnstile fail, with `require_turnstile: true` (line 85–93) — body size 75
    - **401** Bad password / no user, with `require_turnstile: counter.count >= 2` (line 112–119) — body size 75 or 76
- timestamp: 2026-05-01
  source: `src/components/auth/LoginForm.tsx:30,48`
  observation: `const [turnstile_token, setTurnstileToken] = useState<string | null>(null);` then `body: JSON.stringify({ email, password, turnstileToken: turnstile_token })`. On the FIRST submit before any failure, `turnstile_token === null`, so the request body literally contains `"turnstileToken": null`.
- timestamp: 2026-05-01
  source: `src/lib/validation.ts:50`
  observation: `turnstileToken: z.string().optional()`. Zod's `.optional()` adds `undefined` to the allowed type but does NOT add `null`. Empirical Zod v4 check (executed with the project's installed zod):
    ```
    null token success: false
        issues: [{ expected: 'string', code: 'invalid_type', path: ['turnstileToken'],
                   message: 'Invalid input: expected string, received null' }]
    undefined token success: true
    omitted token success: true
    empty-string token success: true
    ```
- timestamp: 2026-05-01
  source: `tests/integration/auth/rate-limit.test.ts:147,162,177,190`
  observation: Every integration test sends `turnstileToken: 'test-token'` (a non-null string). The integration tests therefore CANNOT exercise the null-token path the browser produces.
- timestamp: 2026-05-01
  source: `tests/e2e/auth.spec.ts`
  observation: The single Playwright e2e flow is `signup → dashboard → reload → logout → /dashboard redirects /login`. It never fills the LoginForm or POSTs `/api/auth/login`. Login was effectively never end-to-end tested before prod deploy.
- timestamp: 2026-05-01
  source: `.planning/STATE.md`
  observation: STATE.md and Phase 01.1 docs confirm prod runs on **AWS Copilot Fargate sa-east-1**, not Railway (CLAUDE.md is stale on this point). Cloudflare → Copilot Fargate. This does not change the root cause but disqualifies any hypothesis tied to Railway-specific networking.
- timestamp: 2026-05-01
  source: `src/lib/env.ts:144–161`
  observation: Production env validation requires `TURNSTILE_SECRET_KEY` for the `web` service. If those keys are absent on Fargate, the server crashes at boot (Zod throws during `EnvSchema.parse(process.env)`) — it would NOT serve a 401. So the route IS booting normally, which is consistent with the user's report that the request reaches origin (Cloudflare DYNAMIC).
- timestamp: 2026-05-01
  source: response-size analysis (computed)
  observation: **MISMATCH** — the user reports `content-length: 93`. None of the route's 401 bodies serialize to 93 bytes (closest are 75/76). Possible explanations:
    1. The deployed Copilot image is OLDER than current `master` and the 401 body in that revision had additional fields (e.g., a `code` or `attempt` field that has since been removed). This is plausible because STATE.md last_activity is 2026-04-27 but commits d537e10 / 486a98a / 98f64db post-date Copilot deploy.
    2. The 401 is not emitted by this handler at all — possibly Cloudflare's "521 Web server is down" or a managed challenge JSON, but DYNAMIC cache status argues against that.
    3. A reverse-proxy (Cloudflare Workers / Transform Rule / Page Rule) rewrites the body in flight. No evidence for this in repo.
    4. The body has framing the user did not capture (e.g., gzip encoding inflates content-length report). However content-length should be the on-wire byte count.
- timestamp: 2026-05-01
  source: user-captured prod response body (DevTools Network tab, Response payload)
  observation: **AMBIGUITY RESOLVED.** Captured response body verbatim:
    ```
    {"ok":false,"error":"E-mail ou senha incorretos."}
    ```
    This is exactly **50 bytes** — a byte-perfect match for the Zod-parse 401 path at `src/app/api/auth/login/route.ts:50-54`. The previously reported `content-length: 93` was the **request** content-length (a JSON body of `{"email":"<user>","password":"<pwd>","turnstileToken":null}` with the user's actual credentials sums to ~93 bytes), not the response content-length. The prior cycle's "MISMATCH" entry conflated request-side and response-side content-length and manufactured a spurious "5th 401 source" hypothesis. With the actual response body in hand:
    - H7 (Zod-null-rejection) is **fully confirmed** — exact body, exact branch.
    - The Fargate image is **not stale** — current `master` source produces this exact byte sequence.
    - **No edge-layer body rewrite** exists — Cloudflare is passing the origin response through unchanged.
    - **No 5th 401 source** exists — the four enumerated 401-emitting layers (route handler, Auth.js catch-all, Cloudflare WAF, Next runtime) are exhaustive, and the response is unambiguously from the route handler.
    The bug is exactly the null-turnstileToken Zod parse failure on `master`. Diagnosis is closed.

## Eliminated

- Auth.js v5 catch-all is not on the failing path (different URL).
- AUTH_SECRET / NEXTAUTH_URL misconfig: would crash the boot (Zod refine), not return 401.
- CPF lookup: not part of the login flow at all.
- Argon2 prebuild missing on container: would throw 500, not 401.
- Cloudflare WAF block: ruled out by cf-cache-status: DYNAMIC.
- Email-canonicalisation mismatch: signup writes lowercased email (validation.ts:31), login reads with the same lowercased schema (line 96–98). Symmetric.
- Cookie / `__Secure-` prefix: not relevant to a 401 BEFORE any session is set.
- **Stale Fargate image** — eliminated by exact 50-byte body match against current `master`.
- **5th 401 source / edge body rewrite** — eliminated by exact 50-byte body match; the spurious hypothesis was an artefact of confusing request and response content-length.

## Resolution

- **root_cause:** `LoginForm.tsx` initialises `turnstile_token` as `null` (`useState<string | null>(null)`) and serialises it directly into the request body as `"turnstileToken": null`. `LoginSchema` in `src/lib/validation.ts:50` declares `turnstileToken: z.string().optional()`, which Zod treats as `string | undefined` and **rejects** explicit `null`. The handler at `src/app/api/auth/login/route.ts:50-54` returns 401 with body `{"ok":false,"error":"E-mail ou senha incorretos."}` at the Zod-parse-failure branch — before any password check runs. Every first login attempt fails, even with valid credentials. Confirmed by exact 50-byte captured response body.

- **fix (proposed, NOT applied — read-only scope):**
  1. **Schema-side (preferred, primary):** `src/lib/validation.ts:50`
     ```ts
     // before
     turnstileToken: z.string().optional(),
     // after
     turnstileToken: z.string().nullish(),
     ```
     `.nullish()` accepts `string | null | undefined`. The server stays lenient about how the client encodes "no token yet" and the bug dies in one line.
  2. **Form-side (defence-in-depth):** `src/components/auth/LoginForm.tsx:48`
     ```ts
     // before
     body: JSON.stringify({ email, password, turnstileToken: turnstile_token })
     // after
     body: JSON.stringify({ email, password, turnstileToken: turnstile_token ?? undefined })
     ```
     `?? undefined` prevents `null` from ever reaching the wire; `JSON.stringify` then omits the key entirely. Either fix alone resolves the 401; both together guarantee the bug stays dead under future schema tightening.

- **verification:**
  1. **Local repro before fix:** `pnpm dev` → fill LoginForm with a valid local credential → submit → expect 401 with body `{"ok":false,"error":"E-mail ou senha incorretos."}`. Confirms parity with prod.
  2. **Local repro after fix:** same flow with `validation.ts` patched → expect 200 with session cookie set → `/dashboard` loads.
  3. **New integration test:** `tests/integration/auth/login-null-turnstile.test.ts` — POST `/api/auth/login` with `{ email, password, turnstileToken: null }` for a known-valid seeded user; assert status 200 and `Set-Cookie` present. This is the test that would have caught the bug pre-deploy.
  4. **New Playwright e2e:** `tests/e2e/login.spec.ts` — extend existing auth flow to: signup → logout → fill LoginForm → submit → assert `/dashboard` reached. Closes the testing gap that allowed this regression to ship (existing `auth.spec.ts` never POSTs `/api/auth/login` through the form).
  5. **Prod smoke after deploy:** repeat the captured failing request; expect 200.

- **files_changed:** none. Read-only scope honoured. Fix is proposed only; no source files modified during this debug session.

### Files implicated (reference only)

- `src/lib/validation.ts:50` — schema definition (fix here)
- `src/components/auth/LoginForm.tsx:30,48` — null source (defensive fix here)
- `src/app/api/auth/login/route.ts:48–54` — 401 emit point (no change needed)
- `tests/integration/auth/` — missing regression test (add login-null-turnstile)
- `tests/e2e/auth.spec.ts` — missing login-form e2e coverage (extend)
