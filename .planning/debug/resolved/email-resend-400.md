---
slug: email-resend-400
status: resolved
trigger: POST /api/auth/email/resend returns 400 Bad Request in production
created: 2026-05-01
updated: 2026-05-01
resolved: 2026-05-01
---

# Debug: email-resend-400

## Trigger

<!-- DATA_START -->
User reports: `POST https://portalfinance.app/api/auth/email/resend` returns
`400 Bad Request` in production.

Request details (from browser DevTools):
- Method: POST
- Status: 400 Bad Request
- Origin: https://portalfinance.app
- Referer: https://portalfinance.app/dashboard
- Cookie: `__Secure-authjs.session-token=...` (valid Auth.js session present)
- Content-Length: 0 (empty body)
- Content-Type: application/json (response)
- Cloudflare-fronted (cf-ray, GRU edge), cf-cache-status: DYNAMIC
- User-Agent: Chrome 147 on Windows
- Date: Fri, 01 May 2026 19:31:45 GMT
<!-- DATA_END -->

## Symptoms

- **Expected behavior:** The "Verificar agora" CTA on the email-verification nag
  banner should trigger a backend call that re-sends the verification email.
  The component-level comment claims the Phase 1 stub should return `501 Not
  Implemented` (see `src/components/banners/EmailVerificationNagBanner.tsx:14`,
  line 48–49). The optimistic toast fires regardless of server response.
- **Actual behavior:** Endpoint returns `400 Bad Request` with `application/json`
  content-type. The user is unaware (toast is optimistic), but the failed
  request is visible in DevTools and likely surfaces in error monitoring.
- **Error messages:** No body shown in the user's report (only headers were
  pasted). Status line: `400 Bad Request`. No client-side console error
  surfaced because the fetch `.catch(() => {})` swallows it
  (`EmailVerificationNagBanner.tsx:54-56`).
- **Timeline:** Production. Tied to Phase 1 deferral — the route was meant to be
  a stub returning 501. Not yet implemented; this is its first observed call.
- **Reproduction:** Sign in → land on `/dashboard` while `emailVerified=false`
  → click "Verificar agora" in the top nag banner → observe POST in DevTools.

## Initial Findings (orchestrator pre-fetch)

1. The endpoint `src/app/api/auth/email/resend/route.ts` **does not exist** in
   the codebase. Confirmed via Glob on `src/app/api/auth/**`:
   ```
   src/app/api/auth/[...nextauth]/route.ts
   src/app/api/auth/login/route.ts
   src/app/api/auth/signup/route.ts
   src/app/api/auth/logout/route.ts
   src/app/api/auth/unlock/route.ts
   src/app/api/auth/reset/{request,validate,confirm}/route.ts
   ```
   No `email/resend/route.ts`.

2. Because no specific route exists, Next.js routes the request to the
   catch-all `[...nextauth]` segment. NextAuth v5 does not recognize
   `email/resend` as one of its built-in actions (`signin`, `callback`, `csrf`,
   `session`, `providers`, `signout`) and is the most likely source of the 400.

3. The component already documents this as expected behaviour — but the
   comment says **501**, while production returns **400**. Either the comment
   is stale or the routing assumption was wrong.

4. Phase 1 plan `01-04` (Email Verification Nag Banner) deferred the real
   endpoint. The discrepancy between "501 stub" and "400 from NextAuth
   catch-all" is the actionable finding.

## Current Focus

```yaml
hypothesis: |
  Route `/api/auth/email/resend` is not implemented. Requests fall through to
  the NextAuth `[...nextauth]` catch-all, which returns 400 for unknown
  actions. The component's "501" comment is stale documentation; production
  has always returned 400 from day one of the banner shipping.
test: |
  Confirm by (a) searching for any route file matching `email/resend`,
  (b) reading the [...nextauth] handler to verify Auth.js v5 returns 400 for
  unrecognised action names, (c) checking Phase 01-04 plan/summary for what
  was actually shipped vs. what the comment promised.
expecting: |
  No route file exists; Auth.js handler logs/returns 400 with no body for
  unknown actions; Phase 01-04 deliberately deferred the real implementation
  and the "501" mention in the component is pre-implementation copy.
next_action: |
  RESOLVED — root cause confirmed. Apply chosen fix.
```

## Evidence

- timestamp: 2026-05-01T19:31:45Z
  finding: >
    `src/app/api/auth/[...nextauth]/route.ts` is a 13-line thin wrapper:
    `export const { GET, POST } = handlers` from `@/auth`. It does NOT
    contain any custom action routing. Any POST to a sub-path not known to
    Auth.js v5 will be handled by Auth.js internals, which return 400 for
    unrecognised action names.
  file: src/app/api/auth/[...nextauth]/route.ts

- timestamp: 2026-05-01T19:31:45Z
  finding: >
    `EmailVerificationNagBanner.tsx` line 54 calls
    `fetch('/api/auth/email/resend', { method: 'POST' })` with `.catch(() => {})`
    silencing all errors. Lines 47-49 comment: "The /api/auth/email/resend
    endpoint is a stub returning 501 in Phase 1." The component was shipped
    expecting a 501 stub that was never created.
  file: src/components/banners/EmailVerificationNagBanner.tsx

- timestamp: 2026-05-01T19:31:45Z
  finding: >
    `.planning/phases/01-foundation-identity/01-04-PLAN.md` line 684 explicitly
    states the CTA calls `fetch('/api/auth/email/resend')` and that "501 Not
    Implemented is acceptable in Phase 1". Line 749 says "Do NOT wire the
    Verificar agora CTA to a real endpoint — it's a Phase 2 concern (D-02)."
    The stub route was planned but never created.
  file: .planning/phases/01-foundation-identity/01-04-PLAN.md

- timestamp: 2026-05-01T19:31:45Z
  finding: >
    `.planning/phases/01-foundation-identity/01-04-SUMMARY.md` Known Stubs
    table records: "`/api/auth/email/resend` returns 501 — Intentional Phase 1
    stub (D-02). Phase 2 wires real SES email verification flow." This confirms
    the stub was intended to exist but was omitted from the actual delivery.
  file: .planning/phases/01-foundation-identity/01-04-SUMMARY.md

## Eliminated

- Auth middleware or session cookie interference — request has a valid session
  token; 400 comes from Auth.js action routing, not auth guard.
- Cloudflare WAF blocking — cf-cache-status: DYNAMIC means it passed through;
  400 is from the origin.
- Network / CDN issue — reproducible consistently for the same path.

## Resolution

root_cause: >
  `src/app/api/auth/email/resend/route.ts` was planned as a Phase 1 stub
  (returning 501) but was never created. POST requests fall through to
  `src/app/api/auth/[...nextauth]/route.ts`, which delegates to Auth.js v5.
  Auth.js v5 does not recognise `email/resend` as a built-in action and
  returns 400 Bad Request. The 501-vs-400 discrepancy is purely because the
  planned stub was missing; Sentry captures every occurrence as a 400 error
  even though the banner UX is silently optimistic.

fix: >
  Fix A applied. Created `src/app/api/auth/email/resend/route.ts` returning
  `NextResponse.json({ ok: false, error: 'not_implemented' }, { status: 501 })`.
  The route now intercepts the request before Auth.js sees it, matching the
  intent recorded in 01-04-PLAN and 01-04-SUMMARY. Banner UX unchanged
  (toast remains optimistic). Sentry will stop recording 400s for this path.

verification: >
  Added regression test `tests/unit/api/auth-email-resend.test.ts` asserting
  the route returns 501 with `{ ok: false, error: 'not_implemented' }`.
  Vitest run: 1 passed.

files_changed:
  - src/app/api/auth/email/resend/route.ts (new, 18 lines)
  - tests/unit/api/auth-email-resend.test.ts (new, 23 lines)
