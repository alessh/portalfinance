---
slug: ses-bounce-simulator-no-logs
status: resolved
trigger: "Test 4-a — bounce@simulator.amazonses.com sent from prod via the email/resend (signup verification) flow produces zero logs anywhere. Suspected areas (per user): worker queue registration, SES sandbox identity rules for the simulator address, SNS subscription state, configuration set's Bounce → SNS event destination."
created: 2026-05-01
updated: 2026-05-01
goal: find_and_fix
---

# Debug: SES bounce simulator produces no logs in prod

## Symptoms

- **Test:** Test 4-a — send to `bounce@simulator.amazonses.com` from prod.
- **Trigger path:** Email/resend (signup verification) flow on prod (Auth.js v5 credentials provider; signup or `/api/auth/email/resend`).
- **Expected outcomes (all missing):**
  - SES send log in web app (SendEmail success + MessageId).
  - SNS bounce notification received at the bounce webhook endpoint.
  - Worker pg-boss job for bounce handling processed.
  - DB row recorded (suppression_list / bounce_events or equivalent).
- **Actual:** Zero logs anywhere — no web app SES send log, no SNS receipt log, no worker job, no DB row.
- **Timeline:** Unknown / not previously tested. Test 4-a is the first attempt to exercise this path; no prior signal that it ever worked.
- **Environment:** Prod (AWS Copilot Fargate, sa-east-1 — see memory note that prod is not Railway).

## Suspected areas (user-supplied investigation hints)

1. Worker queue registration — is the bounce-handler queue actually registered/started in the prod worker service?
2. SES sandbox identity rules — does the SES account in prod have the simulator address allowed (sandbox vs. production access)?
3. SNS subscription state — is the SNS topic for SES bounces actually subscribed to the app's HTTPS endpoint, and is the subscription `Confirmed`?
4. Configuration set's Bounce → SNS event destination — is a configuration set applied to the SendEmail call, and does it route Bounce events to the SNS topic?

## Current Focus

- hypothesis: The "email/resend" flow never actually calls SES in Phase 1 — it is an explicit 501 stub. No outbound SES send means no MessageId, no SNS bounce notification, and no downstream logs.
- test: Read `src/app/api/auth/email/resend/route.ts` and the signup flow; confirm whether any SendEmail call is reachable from the trigger path.
- expecting: Either a `sendEmail()` invocation in the signup/resend path, or confirmation that the route is a stub.
- next_action: Resolved — the route is a stub. Document scope and required fixes to make Test 4-a runnable.

## Evidence

- timestamp: 2026-05-01 — file: `src/app/api/auth/email/resend/route.ts` — finding: The endpoint is a documented Phase-1 stub. Body of the handler:
  ```ts
  export async function POST() {
    return NextResponse.json(
      { ok: false, error: 'not_implemented' },
      { status: 501 },
    );
  }
  ```
  The header comment says: "Returns 501 Not Implemented. The real SES-backed email verification flow ships in Phase 2." The Email Verification Nag Banner calls this endpoint optimistically and swallows the response.
- timestamp: 2026-05-01 — file: `src/app/api/auth/signup/route.ts` + `src/app/(auth)/signup/signupCore.ts` — finding: The signup flow validates → hashes password → INSERTs `users` + `user_consents` + `audit_log` and auto-signs-in the new user. It does NOT enqueue any email job and does NOT call `sendEmail()`. There is no verification email path wired up at signup yet.
- timestamp: 2026-05-01 — search: `enqueue\(QUEUES\.` across `src/` — finding: The only producers in Phase 1 are:
  - `api/auth/login` → `QUEUES.SEND_UNLOCK_EMAIL` (account-unlock email)
  - `api/auth/reset/request` → `QUEUES.SEND_PASSWORD_RESET_EMAIL`
  - `api/privacy/export` + `api/privacy/delete` → `QUEUES.DSR_ACKNOWLEDGE`
  - `api/webhooks/ses/bounces` → `QUEUES.SES_BOUNCE`
  No producer enqueues a "verification email" job. The signup → verification email path does not exist in Phase 1.
- timestamp: 2026-05-01 — file: `src/jobs/worker.ts` — finding: The worker entrypoint registers all four Phase 1 queues, including `QUEUES.SES_BOUNCE` with `localConcurrency: 2` and `sesBounceWorker`. So worker registration is correct; the bounce worker would drain SES_BOUNCE jobs if any were ever enqueued.
- timestamp: 2026-05-01 — file: `src/jobs/boss.ts` — finding: `getBoss()` calls `_boss.createQueue(queue)` for every queue in `QUEUES`, including `ses.bounce`. Cold-start order is therefore safe — both web and worker create the queue idempotently.
- timestamp: 2026-05-01 — file: `src/lib/mailer.ts` — finding: The `SendEmailCommand` is built WITHOUT a `ConfigurationSetName` field:
  ```ts
  const cmd = new SendEmailCommand({
    Source: env.SES_FROM_EMAIL,
    Destination: { ToAddresses: [params.to] },
    Message: { Subject: { ... }, Body: { Html: { ... } } },
  });
  ```
  Confirmed by grep: no occurrence of `ConfigurationSetName|configuration_set|configurationSet` anywhere in `src/`. Even when the app DOES send (login unlock, password reset), SES has no configuration-set hook to forward bounce/complaint events to SNS. The `api/webhooks/ses/bounces` receiver is wired and the `ses_suppressions` table exists, but the producer side of the SES → SNS event pipeline is not configured in the SDK call.
- timestamp: 2026-05-01 — file: `src/app/api/webhooks/ses/bounces/route.ts` — finding: The receiver is correctly implemented: SNS signature verification first (T-WH-FORGE), `SubscriptionConfirmation` handshake supported, idempotent `webhook_events` insert keyed by `MessageId`, enqueue to `QUEUES.SES_BOUNCE`, structured log `event: ses_bounce_received`. So if SNS ever delivered, this endpoint would log it — which proves SNS never delivered.

## Eliminated

- "Worker queue registration is missing" — eliminated. `src/jobs/worker.ts` registers `QUEUES.SES_BOUNCE` and `getBoss()` creates the queue in pgboss schema on first call from either side.
- "Bounce worker not deployed" — eliminated. `sesBounceWorker` is imported and bound to the queue; the worker entrypoint logs `worker started — registered queues` listing it.

The remaining suspected areas (SES sandbox identity rules, SNS subscription state, configuration-set event destination) are downstream of the actual root cause and cannot be validated from the codebase alone. They become relevant once the producer side starts emitting SES sends.

## Resolution

### Root cause

The trigger path "Email/resend (signup verification) flow" produces zero logs everywhere because **the flow does not exist in Phase 1**:

1. `POST /api/auth/email/resend` is an explicit 501 stub — it returns `{ ok: false, error: 'not_implemented' }` with no SES call. Documented in the file header as "ships in Phase 2".
2. The signup route does not enqueue or send a verification email at all.
3. Therefore SES never receives a SendEmail for any signup-verification address — including `bounce@simulator.amazonses.com`. No MessageId is ever produced. SES has nothing to bounce, so SNS has nothing to notify, so the bounce webhook has nothing to receive, so the SES_BOUNCE worker has nothing to drain, so `ses_suppressions` has nothing to insert.

A secondary, latent issue exists for any SES send the app DOES perform today (login unlock, password reset, DSR acknowledge): `src/lib/mailer.ts` builds `SendEmailCommand` without `ConfigurationSetName`. Even if Test 4-a were rerouted through one of those flows, bounces would still not reach SNS unless the SDK call is updated and the SES configuration set has a Bounce → SNS event destination.

### Fix

The original symptom — "Test 4-a from the email/resend flow produces no logs" — is **expected and correct behavior** for Phase 1. Test 4-a as written is not runnable in Phase 1 because the path it exercises is not implemented yet.

Recommended action depends on the goal:

- **If the goal is to defer Test 4-a to Phase 2:** mark the test as blocked-on-Phase-2 in the UAT plan. No code change. The Phase 2 plan must include (a) replacing the resend stub with a real SES SendEmail, (b) routing signup to enqueue a verification email, (c) adding `ConfigurationSetName` to the `SendEmailCommand` in `src/lib/mailer.ts`, and (d) provisioning the SES configuration set with a Bounce → SNS event destination plus a confirmed SNS subscription to `https://<host>/api/webhooks/ses/bounces`.
- **If the goal is to make Test 4-a runnable now via an existing email path:** trigger a password-reset email to `bounce@simulator.amazonses.com` instead. That path DOES call `sendEmail()` today. However, this still requires (1) adding `ConfigurationSetName` to the `SendEmailCommand`, (2) creating the SES configuration set in sa-east-1 with an SNS event destination for Bounce events, (3) confirming the SNS subscription to the bounce webhook URL, and (4) confirming the prod SES account is out of sandbox or that the simulator address is allowlisted (the simulator addresses generally work in sandbox without verification — they are AWS-owned).

No code was modified by this debug session — the symptom is by design for Phase 1.

### Files relevant to the resolution

- `C:\Users\aless\git\PortalFinance\web\src\app\api\auth\email\resend\route.ts` — Phase-1 stub returning 501; documents Phase-2 follow-up.
- `C:\Users\aless\git\PortalFinance\web\src\app\(auth)\signup\signupCore.ts` — confirms no verification-email enqueue in signup.
- `C:\Users\aless\git\PortalFinance\web\src\lib\mailer.ts` — `SendEmailCommand` is missing `ConfigurationSetName`; latent issue for Phase 2.
- `C:\Users\aless\git\PortalFinance\web\src\jobs\worker.ts` — confirms `SES_BOUNCE` worker is registered.
- `C:\Users\aless\git\PortalFinance\web\src\jobs\boss.ts` — confirms `ses.bounce` queue is created idempotently.
- `C:\Users\aless\git\PortalFinance\web\src\app\api\webhooks\ses\bounces\route.ts` — receiver is correct; not the source of the missing logs.
