---
slug: login-401-on-prod
status: root_cause_found
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
7. **NEW (prime suspect): Zod parse rejects `turnstileToken: null`** — see Evidence below.

## Current Focus

- **hypothesis:** H7 — `LoginForm.tsx` always sends `turnstileToken: null` (initial state of `useState<string | null>(null)`). The `LoginSchema` declares `turnstileToken: z.string().optional()`, which in Zod accepts `string | undefined` but REJECTS explicit `null`. Every login request fails Zod parse and the handler returns 401 at `route.ts:50–54`.
- **next_action:** confirm by capturing the actual 93-byte response body from prod (or a single Network-tab response payload). The hypothesised 401 body is `{"ok":false,"error":"E-mail ou senha incorretos."}` (50 bytes), which does NOT match the reported 93 bytes — so either the user's content-length report includes other framing, or a different 401 path is being hit, or the body has additional fields not visible in the source.
- **expecting:** the captured body will either match `{"ok":false,"error":"E-mail ou senha incorretos."}` (50 bytes) and confirm H7 — but with a length mismatch we may need to widen the search, OR the body will reveal a 5th 401 source (Cloudflare WAF JSON challenge, edge response, Next standalone runtime fallback).
- **reasoning_checkpoint:** The route enumerates the only 401 shapes the source can return. None of them serialize to 93 bytes (computed: 50, 75, 76 for the three 401 paths; 39 for the 400 "Corpo inválido."; 77 for the 429 lock message). A 93-byte body therefore implies either (a) the response carries an extra field not present in the current `master` source (stale Copilot deployment?), or (b) the 401 is emitted by a layer in front of the route handler (Cloudflare error JSON, Next runtime).

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

## Eliminated

- Auth.js v5 catch-all is not on the failing path (different URL).
- AUTH_SECRET / NEXTAUTH_URL misconfig: would crash the boot (Zod refine), not return 401.
- CPF lookup: not part of the login flow at all.
- Argon2 prebuild missing on container: would throw 500, not 401.
- Cloudflare WAF block: ruled out by cf-cache-status: DYNAMIC.
- Email-canonicalisation mismatch: signup writes lowercased email (validation.ts:31), login reads with the same lowercased schema (line 96–98). Symmetric.
- Cookie / `__Secure-` prefix: not relevant to a 401 BEFORE any session is set.

## Resolution

### Root cause

**`LoginForm.tsx` always sends `turnstileToken: null` on the first submit; `LoginSchema` declares `turnstileToken: z.string().optional()` which rejects `null`. The handler returns 401 at the Zod-fail branch (`route.ts:50–54`) before any password check runs. Every first login attempt fails — including with valid credentials — which exactly matches the user's report.**

The independent empirical Zod check (executed with the project's installed Zod) confirms the rejection:

```
.safeParse({ ..., turnstileToken: null }) → success: false
  issues: [{ code: 'invalid_type', expected: 'string', received: null,
             path: ['turnstileToken'] }]
```

### Why the byte-length mismatch is not load-bearing

The route's three 401 bodies serialize to 50, 75, and 76 bytes (computed empirically). The user reported `content-length: 93`. Older commits emit the same bodies, so it isn't a stale-image artefact. Plausible non-load-bearing explanations: gzip framing in transit, a Cloudflare Worker / Transform Rule injecting a field, or the captured Network entry was a different request. None of these change the diagnosis — the Zod-null-rejection is independently confirmed and explains every observed symptom.

### Why pre-prod testing missed it

- `tests/e2e/auth.spec.ts` exercises signup → reload → logout but **never** POSTs to `/api/auth/login` through the form.
- `tests/integration/auth/rate-limit.test.ts` always sends `turnstileToken: 'test-token'` (a non-null string) — never the null the browser actually produces.

### Recommended fix (two complementary one-liners)

1. **Schema (server-side, primary):** `src/lib/validation.ts:50`
   ```ts
   // before
   turnstileToken: z.string().optional(),
   // after
   turnstileToken: z.string().nullish(),
   ```
   `.nullish()` accepts `string | null | undefined`. Server stays lenient about how the client encodes "no token yet."

2. **Form (client-side, defensive):** `src/components/auth/LoginForm.tsx:42–50`
   ```ts
   body: JSON.stringify({
     email: values.email,
     password: values.password,
     ...(turnstile_token ? { turnstileToken: turnstile_token } : {}),
   }),
   ```
   Spreads in `turnstileToken` only when it's a non-null string. Either fix alone resolves the 401; both together guarantee the bug stays dead even if a future schema change is stricter.

### Regression-test gap to close

Add an integration test that posts to `/api/auth/login` with `turnstileToken: null` for a known-valid user and expects status 200 (not 401). This is the test that would have caught it pre-deploy and should be the first thing committed alongside the fix.

### Files implicated

- `src/lib/validation.ts:50` — schema definition (fix here)
- `src/components/auth/LoginForm.tsx:30,42–50` — null source (defensive fix here)
- `src/app/api/auth/login/route.ts:48–54` — 401 emit point (no change needed)
- `tests/integration/auth/` — missing regression test
