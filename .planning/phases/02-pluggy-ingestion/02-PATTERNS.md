# Phase 2: Pluggy Ingestion - Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 39 files (new or modified)
**Analogs found:** 35 / 39
**Phase 1 codebase scanned:** `src/app`, `src/components`, `src/db/schema`, `src/jobs`, `src/lib`, `src/emails`, `tests/integration`, `scripts`

> Planner-actionable map. Each row tells the planner exactly which Phase 1 file to copy-paste-modify and which excerpts to mirror. All file paths absolute under `C:\Users\aless\git\PortalFinance\web\`.

---

## File Classification

### Schemas (Drizzle)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/db/schema/_shared.ts` (modify) | shared-type | — | self (add `pgEnum` block) | exact |
| `src/db/schema/pluggyItems.ts` (new) | model | CRUD | `src/db/schema/users.ts` (bytea + uniqueIndex) + `src/db/schema/accountLocks.ts` (FK + index) | exact |
| `src/db/schema/accounts.ts` (new) | model | CRUD | `src/db/schema/accountLocks.ts` | role-match |
| `src/db/schema/transactions.ts` (new) | model | CRUD | `src/db/schema/auditLog.ts` (multi-index) + `src/db/schema/sesSuppressions.ts` (UNIQUE) | role-match |
| `src/db/schema/index.ts` (modify) | barrel | — | self | exact |

### Env / Lib Extensions

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/lib/env.ts` (modify) | config | — | self (add Pluggy block + extend OPS-04 refine) | exact |
| `src/lib/consentScopes.ts` (modify) | config | — | self (add `PLUGGY_CONNECT_PENDING`) | exact |
| `src/lib/auditLog.ts` (modify) | utility | — | self (extend `AuthAuditAction` union via schema) | exact |

### Service Layer

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/services/PluggyService.ts` (new) | service | request-response | `src/lib/mailer.ts` (lazy singleton + lib wrapper + structured log) | role-match |

### Webhook + API Routes

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/app/api/webhooks/pluggy/route.ts` (new) | controller | event-driven | `src/app/api/webhooks/ses/bounces/route.ts` | exact |
| `src/app/api/connect/init/route.ts` (new) | controller | request-response | `src/app/api/auth/signup/route.ts` (session + JSON wrapper) | role-match |
| `src/app/api/pluggy/items/route.ts` (new) | controller | request-response | `src/app/api/auth/signup/route.ts` | role-match |
| `src/app/api/pluggy/items/[id]/route.ts` (new, DELETE) | controller | request-response | `src/app/api/auth/signup/route.ts` | role-match |
| `src/app/api/pluggy/items/[id]/sync/route.ts` (new, POST) | controller | request-response | `src/app/api/webhooks/ses/bounces/route.ts` (enqueue pattern) | role-match |
| `src/app/api/sync-status/route.ts` (new, GET) | controller | request-response | none (small read endpoint) | partial |

### pg-boss Workers

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/jobs/boss.ts` (modify) | config | — | self (extend `QUEUES`) | exact |
| `src/jobs/worker.ts` (modify) | controller | event-driven | self (register 5 new `boss.work` calls + 1 cron) | exact |
| `src/jobs/workers/pluggySyncWorker.ts` (new) | worker | event-driven | `src/jobs/workers/sesBounceWorker.ts` (job loop + try/throw + audit) | role-match |
| `src/jobs/workers/transferDetectorWorker.ts` (new) | worker | batch | `src/jobs/workers/sesBounceWorker.ts` | role-match |
| `src/jobs/workers/faturaDetectorWorker.ts` (new) | worker | batch | `src/jobs/workers/sesBounceWorker.ts` | role-match |
| `src/jobs/workers/reAuthNotifierWorker.ts` (new) | worker | event-driven | `src/jobs/workers/passwordResetEmailWorker.ts` (sendEmail + React.createElement) | exact |
| `src/jobs/workers/reconcileStaleItemsWorker.ts` (new) | worker | batch (cron) | `src/jobs/workers/sesBounceWorker.ts` | role-match |

### React Email Template

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/emails/ReAuthRequired.tsx` (new) | component | — | `src/emails/PasswordReset.tsx` | exact |

### React Pages (App Router)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/app/connect/page.tsx` (new) | component | — | `src/app/(auth)/signup/page.tsx` (server-component + form) | role-match |
| `src/app/connect/success/page.tsx` (new) | component | — | none (polling client component) | partial |
| `src/app/transactions/page.tsx` (new) | component | CRUD | `src/app/dashboard/page.tsx` | role-match |
| `src/app/settings/connections/page.tsx` (new) | component | CRUD | `src/app/settings/privacy/page.tsx` | role-match |

### React Components

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/components/consent/ConsentScreen.tsx` (modify) | component | — | self (add CPF inline field + ctaLabel) | exact |
| `src/components/banners/ReAuthBanner.tsx` (new) | component | — | `src/components/banners/EmailVerificationNagBanner.tsx` | exact |
| `src/components/banners/BannerStack.tsx` (new — if not in P1) | component | — | `EmailVerificationNagBanner` (sticky shell) | partial |
| `src/components/connect/PluggyConnectWidget.tsx` (new) | component | — | none (3rd-party SDK wrapper) | no-analog |
| `src/components/connect/SyncProgressCard.tsx` (new) | component | — | none (custom polling UI) | partial |
| `src/components/transactions/TransactionList.tsx` (new) | component | CRUD | none (date-grouped list) | partial |
| `src/components/transactions/EmptyTransactions.tsx` (new) | component | — | `EmailVerificationNagBanner` (icon + heading + CTA pattern) | partial |
| `src/components/connections/ConnectionCard.tsx` (new) | component | — | `src/app/(auth)/signup/page.tsx` card layout (inferred) | partial |
| `src/components/connections/DisconnectConfirmModal.tsx` (new) | component | — | shadcn Dialog pattern (Phase 1 has dialog installed) | partial |
| `src/components/billing/PaywallStubCard.tsx` (new) | component | — | `EmptyTransactions` shape | partial |

### Tests

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `tests/integration/pluggy/webhook.test.ts` (new) | test | — | `tests/integration/webhooks/ses-bounce.test.ts` | exact |
| `tests/integration/pluggy/sync-worker.test.ts` (new) | test | — | `tests/integration/webhooks/ses-bounce.test.ts` | role-match |
| `tests/integration/pluggy/transfer-detector.test.ts` (new) | test | — | `tests/integration/webhooks/ses-bounce.test.ts` | role-match |
| `tests/e2e/pluggy/connect-flow.spec.ts` (new) | test | — | `tests/e2e/auth.spec.ts` | role-match |
| `scripts/run-e2e.ts` (modify if needed) | utility | — | self (add Pluggy env vars to `.env.local` write block) | exact |

---

## Pattern Assignments

### `src/app/api/webhooks/pluggy/route.ts` (controller, event-driven)

**Analog:** `src/app/api/webhooks/ses/bounces/route.ts`

**Imports + runtime declaration** (lines 20-25):
```typescript
export const runtime = 'nodejs';

import { db } from '@/db';
import { webhook_events } from '@/db/schema';
import { enqueue, QUEUES } from '@/jobs/boss';
import { logger } from '@/lib/logger';
```

**Auth header validation pattern** (replace `verifySnsMessage` with `crypto.timingSafeEqual` per D-42; mirror lines 39-47):
```typescript
// --- 1. Verify custom signature header (D-42) ---
const sig_header = req.headers.get('x-pluggy-signature') ?? '';
const expected = env.PLUGGY_WEBHOOK_SECRET;
const sig_buf = Buffer.from(sig_header);
const exp_buf = Buffer.from(expected);
if (sig_buf.length !== exp_buf.length || !timingSafeEqual(sig_buf, exp_buf)) {
  logger.warn({ event: 'pluggy_webhook_signature_failed' }, 'invalid signature');
  return new Response('unauthorized', { status: 401 });
}
```

**Idempotent insert + enqueue (CRITICAL — copy verbatim shape)** (lines 59-77):
```typescript
const inserted = await db
  .insert(webhook_events)
  .values({
    source: 'PLUGGY',                     // SES analog: 'SES'
    event_type: body.event,               // analog: 'bounce'
    event_id: body.eventId,               // analog: body.MessageId
    payload: body as Record<string, unknown>,
  })
  .onConflictDoNothing()
  .returning({ id: webhook_events.id });

const was_duplicate = inserted.length === 0;

if (!was_duplicate) {
  const queue = mapEventToQueue(body.event);    // returns null for unmapped (Pitfall 10)
  if (queue) {
    await enqueue(queue, { webhook_event_id: inserted[0].id, item_id: body.itemId });
  } else {
    logger.info({ event: 'pluggy_webhook_unmapped_event', event_type: body.event });
  }
}
```

**Tail logger + 200** (lines 78-87):
```typescript
logger.info({
  event: 'pluggy_webhook_received',
  event_type: body.event,
  event_id: body.eventId,
  latency_ms: Date.now() - start,
  was_duplicate,
}, 'Pluggy webhook processed');

return new Response('ok', { status: 200 });
```

**MUST honor:**
- Hardcoded receiver runtime = `'nodejs'` (top of file).
- NO Sentry instrumentation in hot path (Pitfall 3).
- Receiver `await enqueue()` BEFORE returning 200 (Pitfall 3 — pg-boss send is fast but failure = lose event).
- `mapEventToQueue` returns `null` for unknown events; row still inserted (Pitfall 10).

---

### `src/services/PluggyService.ts` (service, request-response)

**Analog:** `src/lib/mailer.ts` (lazy singleton + suppression-guard pattern + structured logging)

**Lazy singleton SDK client** (mailer lines 36-64):
```typescript
let _client: PluggyClient | null = null;

function getClient(): PluggyClient {
  if (_client) return _client;
  _client = new PluggyClient({
    clientId: env.PLUGGY_CLIENT_ID,
    clientSecret: env.PLUGGY_CLIENT_SECRET,
  });
  return _client;
}
```

**Decrypt-on-use pattern + audit log on every call** (combine `crypto.ts` decrypt + mailer logger):
```typescript
import { decryptCPF as decrypt } from '@/lib/crypto';   // generic AES-256-GCM helper
import { logger } from '@/lib/logger';
import { hashUserIdForSentry as hashId } from '@/lib/sentry';

async createConnectToken(args: { userId: string; reconnectItemIdEnc?: Buffer }) {
  const itemId = args.reconnectItemIdEnc ? decrypt(args.reconnectItemIdEnc) : undefined;
  const t = await getClient().createConnectToken(itemId ? { itemId } : undefined);
  logger.info({
    event: 'pluggy_connect_token_created',
    user_id_hashed: hashId(args.userId),
    reconnect: !!itemId,
  });
  return { connectToken: t.accessToken, expiresAt: t.expiresAt };
}
```

**Sentry transaction wrapping (D-47)** — mirror Phase 1 `beforeSend` integration; wrap every public method:
```typescript
import * as Sentry from '@sentry/nextjs';

async listTransactions(args: ...) {
  return Sentry.startSpan(
    { op: 'pluggy.list_transactions', name: 'PluggyService.listTransactions' },
    async () => { /* SDK call */ }
  );
}
```

**MUST honor:**
- NEVER expose plaintext `pluggy_item_id` in errors or logs — always pass through `hashId()` first (P4).
- Method signatures from RESEARCH § Pattern 5: `createConnectToken`, `getItem`, `listAccounts`, `listTransactions(itemId, accountId, { from, to, cursor? })`, `deleteItem`.

---

### `src/jobs/workers/pluggySyncWorker.ts` (worker, event-driven)

**Analog:** `src/jobs/workers/sesBounceWorker.ts`

**Job loop shape — copy verbatim** (lines 38-121):
```typescript
import type { Job } from 'pg-boss';
import { db } from '@/db';
import { logger } from '@/lib/logger';

interface Payload { webhook_event_id?: string; user_id: string; item_id: string; trigger: 'webhook' | 'manual' | 'reconcile' | 'reconnect'; }

export async function pluggySyncWorker(jobs: Job<Payload>[]): Promise<void> {
  for (const job of jobs) {
    try {
      // 1. Read pluggy_items row (FOR UPDATE) — equivalent of webhook_events read
      // 2. Skip if already processed (mirrors `if (ev.processed_at)` check on line 54)
      // 3. UPDATE pluggy_items SET status='UPDATING'
      // 4. PluggyService.listAccounts(itemId) → upsert accounts
      // 5. For each account, iterate cursor-paginated listTransactions, batched upsert (Pattern 4)
      // 6. enqueue 'pluggy.transfer-detector' + 'pluggy.fatura-detector'
      // 7. UPDATE pluggy_items SET status='UPDATED', last_synced_at=now()
    } catch (err) {
      logger.error(
        { event: 'worker_job_failed', job_id: job.id, worker: 'pluggySync', error: String(err) },
        'Job processing failed — pg-boss will retry',
      );
      throw err;       // re-throw so pg-boss retries
    }
  }
}
```

**Upsert with `ON CONFLICT DO UPDATE` (TX-01)** — RESEARCH Pattern 4:
```typescript
await db
  .insert(transactions)
  .values(rows)
  .onConflictDoUpdate({
    target: transactions.pluggy_transaction_id,
    set: {
      status: sql.raw('excluded.status'),
      amount: sql.raw('excluded.amount'),
      description: sql.raw('excluded.description'),
      posted_at: sql.raw('excluded.posted_at'),
      raw_payload: sql.raw('excluded.raw_payload'),
      updated_at: sql`now()`,
      // DO NOT update is_transfer / is_credit_card_payment / transfer_pair_id
    },
  });
```

**MUST honor:**
- `for (const job of jobs)` outer loop with try/catch → re-throw (mirrors sesBounceWorker exactly).
- `processed_at` idempotency guard (Pitfall 9 — detector double-run safety).
- Re-throw on error so pg-boss retry kicks in.

---

### `src/jobs/workers/reAuthNotifierWorker.ts` (worker, event-driven)

**Analog:** `src/jobs/workers/passwordResetEmailWorker.ts`

**sendEmail + React.createElement pattern — copy verbatim** (lines 22-31):
```typescript
import { sendEmail } from '@/lib/mailer';
import { ReAuthRequired } from '@/emails/ReAuthRequired';
import React from 'react';

await sendEmail({
  to: user.email,
  subject: `Reconecte seu ${item.institution_name}`,    // D-35
  template: React.createElement(ReAuthRequired, {
    institution_name: item.institution_name,
    last_synced_at: item.last_synced_at,
    reconnect_url: `${env.NEXTAUTH_URL}/connect?reconnect=${item.id}`,
  }),
});
```

**Debounce guard (D-34)** — read `pluggy_items.last_reauth_email_at`, skip if `< now() - interval '24 hours'`:
```typescript
if (item.last_reauth_email_at && item.last_reauth_email_at > new Date(Date.now() - 24*60*60*1000)) {
  logger.info({ event: 'reconnect_email_debounced', item_id_hashed: hashId(item.id) });
  continue;
}
```

---

### `src/db/schema/pluggyItems.ts` (model, CRUD)

**Analog:** `src/db/schema/users.ts` (bytea + uniqueIndex on partial null)

**Imports — Drizzle table style** (users.ts lines 1-3):
```typescript
import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid, pgEnum } from 'drizzle-orm/pg-core';
import { bytea } from './_shared';
import { users } from './users';
```

**`pgEnum` declaration site (D-43 status enum)** — declare in `_shared.ts`:
```typescript
// src/db/schema/_shared.ts — append below `bytea`
export const item_status_enum = pgEnum('item_status', [
  'UPDATING',
  'LOGIN_ERROR',
  'OUTDATED',
  'WAITING_USER_INPUT',
  'UPDATED',
]);
```

**Table body — mirror users.ts (lines 23-44):**
```typescript
export const pluggy_items = pgTable(
  'pluggy_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pluggy_item_id_enc: bytea('pluggy_item_id_enc').notNull(),
    pluggy_item_id_hash: bytea('pluggy_item_id_hash').notNull(),
    connector_id: text('connector_id').notNull(),
    institution_name: text('institution_name').notNull(),
    institution_logo_url: text('institution_logo_url'),
    status: item_status_enum('status').notNull(),
    execution_status: text('execution_status'),
    last_synced_at: timestamp('last_synced_at', { withTimezone: true }),
    last_error_at: timestamp('last_error_at', { withTimezone: true }),
    last_reauth_email_at: timestamp('last_reauth_email_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    user_item_unique: uniqueIndex('pluggy_items_user_item_hash_unique').on(
      t.user_id,
      t.pluggy_item_id_hash,
    ),
    by_user_status: index('pluggy_items_user_status_idx').on(t.user_id, t.status),
  }),
);

export type PluggyItem = typeof pluggy_items.$inferSelect;
export type NewPluggyItem = typeof pluggy_items.$inferInsert;
```

**MUST honor:**
- `bytea` from `./_shared` — never declare a second `customType` for binary blobs.
- `pgEnum` declarations live in `_shared.ts` (or separate `enums.ts`) — keep table files free of enum collisions across schemas.
- `users.id` import + `onDelete: 'cascade'` references (P26 IDOR + cascade-on-delete pattern).
- Self-FK in `transactions.transfer_pair_id` uses lazy `references((): AnyPgColumn => transactions.id)` (Pitfall 7).

---

### `src/db/schema/transactions.ts` (model, CRUD)

**Analog:** `src/db/schema/auditLog.ts` (multi-index pattern) + `users.ts` (uniqueIndex)

**`pgEnum` declarations in `_shared.ts`:**
```typescript
export const account_type_enum = pgEnum('account_type', ['CHECKING','SAVINGS','CREDIT_CARD','LOAN','INVESTMENT','OTHER']);
export const account_status_enum = pgEnum('account_status', ['ACTIVE','FROZEN','DELETED']);
export const tx_type_enum = pgEnum('tx_type', ['DEBIT','CREDIT']);
export const tx_status_enum = pgEnum('tx_status', ['PENDING','POSTED']);
```

**Indexes (D-45 — 3 indexes including partial)** — mirror auditLog.ts (lines 49-52):
```typescript
(t) => ({
  pluggy_tx_unique: uniqueIndex('transactions_pluggy_tx_unique').on(t.pluggy_transaction_id),
  by_user_posted: index('transactions_user_posted_idx').on(t.user_id, t.posted_at),
  by_account_posted: index('transactions_account_posted_idx').on(t.account_id, t.posted_at),
  // Partial index — Drizzle 0.45 supports .where() on indexes
  by_user_posted_real: index('transactions_user_posted_real_idx')
    .on(t.user_id, t.posted_at)
    .where(sql`${t.is_transfer} = false AND ${t.is_credit_card_payment} = false`),
}),
```

**MUST honor:**
- Self-FK declaration: `transfer_pair_id: uuid('transfer_pair_id').references((): AnyPgColumn => transactions.id)` — lazy callback (Pitfall 7).
- `numeric(15,2)` columns: `numeric('amount', { precision: 15, scale: 2 })`.
- `category_id` is **nullable text slug** in Phase 2 (D-46 defers FK to Phase 3).

---

### `src/db/schema/index.ts` (barrel)

**Analog:** self (lines 10-23)

**Append in dependency order (Pitfall 7) — copy structure exactly:**
```typescript
// ... existing exports
export * from './pluggyItems';   // depends on users
export * from './accounts';      // depends on users + pluggyItems
export * from './transactions';  // depends on users + accounts + self-FK
```

**MUST honor:**
- Order matters — `pluggy_items` BEFORE `accounts` BEFORE `transactions` (Drizzle Kit migration generation reads declaration order).

---

### `src/lib/env.ts` (config)

**Analog:** self (lines 27-91 schema body, 92-138 OPS-04 refine)

**New Pluggy block** (mirror existing `PLUGGY_ENV` declaration on line 60 + add siblings):
```typescript
PLUGGY_ENV: z.enum(['sandbox', 'production']).optional(),       // already present
PLUGGY_CLIENT_ID: z.string().min(1).optional(),
PLUGGY_CLIENT_SECRET: z.string().min(1).optional(),
PLUGGY_WEBHOOK_SECRET: z.string().min(32).optional(),
PLUGGY_SANDBOX_CLIENT_ID: z.string().optional(),
PLUGGY_SANDBOX_CLIENT_SECRET: z.string().optional(),
```

**Extend OPS-04 refine** (lines 128-130 already check `PLUGGY_ENV !== 'production'`); add per-service requirement on `web` + `worker`:
```typescript
// In production, web AND worker need PLUGGY_CLIENT_ID/SECRET + PLUGGY_WEBHOOK_SECRET
if ((e.SERVICE_NAME === 'web' || e.SERVICE_NAME === 'worker')
    && (!e.PLUGGY_CLIENT_ID || !e.PLUGGY_CLIENT_SECRET || !e.PLUGGY_WEBHOOK_SECRET)) {
  return false;
}
```

**MUST honor:**
- Top-of-file comment "ONLY `zod`" — do NOT introduce new imports. Sandbox keys keep `.optional()`; production refine bans them.
- Existing `OPS-04` refine pattern: skip during `NEXT_PHASE === 'phase-production-build'`.

---

### `src/jobs/boss.ts` (config — modify)

**Analog:** self (lines 32-39)

**Append to `QUEUES` const (Pitfall 4) — verbatim shape:**
```typescript
export const QUEUES = {
  DSR_ACKNOWLEDGE: 'dsr.acknowledge',
  SEND_PASSWORD_RESET_EMAIL: 'email.password_reset',
  SEND_UNLOCK_EMAIL: 'email.account_unlock',
  SES_BOUNCE: 'ses.bounce',
  // Phase 2 additions
  PLUGGY_SYNC: 'pluggy.sync',
  PLUGGY_TRANSFER_DETECTOR: 'pluggy.transfer-detector',
  PLUGGY_FATURA_DETECTOR: 'pluggy.fatura-detector',
  PLUGGY_REAUTH_NOTIFIER: 'pluggy.re-auth-notifier',
  PLUGGY_RECONCILE_STALE: 'pluggy.reconcile.stale-items',
} as const;
```

**MUST honor:**
- `getBoss()` lines 99-101 already iterates `Object.values(QUEUES)` and calls `boss.createQueue(queue)` — Phase 2 queues auto-register on next boot. NO additional code needed in `getBoss()`.
- `singletonKey` + `singletonHours` pass through `enqueue()` via `SendOptions` argument (line 125) — D-41 enqueues use `{ singletonKey: user_id, singletonHours: 0 }`.

---

### `src/jobs/worker.ts` (controller — modify)

**Analog:** self (lines 26-45)

**Register Phase 2 workers — mirror lines 30-33 verbatim:**
```typescript
import { pluggySyncWorker } from './workers/pluggySyncWorker';
import { transferDetectorWorker } from './workers/transferDetectorWorker';
import { faturaDetectorWorker } from './workers/faturaDetectorWorker';
import { reAuthNotifierWorker } from './workers/reAuthNotifierWorker';
import { reconcileStaleItemsWorker } from './workers/reconcileStaleItemsWorker';

// inside main(), after Phase 1 boss.work calls:
await boss.work(QUEUES.PLUGGY_SYNC, { localConcurrency: 4 }, pluggySyncWorker);
await boss.work(QUEUES.PLUGGY_TRANSFER_DETECTOR, { localConcurrency: 2 }, transferDetectorWorker);
await boss.work(QUEUES.PLUGGY_FATURA_DETECTOR, { localConcurrency: 2 }, faturaDetectorWorker);
await boss.work(QUEUES.PLUGGY_REAUTH_NOTIFIER, { localConcurrency: 2 }, reAuthNotifierWorker);
await boss.work(QUEUES.PLUGGY_RECONCILE_STALE, { localConcurrency: 1 }, reconcileStaleItemsWorker);

// D-38 cron registration — runs hourly at :00 BRT
await boss.schedule(
  QUEUES.PLUGGY_RECONCILE_STALE,
  '0 * * * *',
  {},
  { tz: 'America/Sao_Paulo' },
);
```

**MUST honor:**
- `import '@/lib/env'` MUST stay first (line 18) — OPS-04 boot assertion.
- `boss.createQueue` (in `getBoss()`) MUST run BEFORE `boss.work` and `boss.schedule` (Pitfall 4 — pg-boss v10+ no auto-create).
- Cron uses `tz: 'America/Sao_Paulo'` (BRT, D-38).

---

### `src/emails/ReAuthRequired.tsx` (component)

**Analog:** `src/emails/PasswordReset.tsx` (verbatim structure + token colors)

**Imports + props shape — copy lines 10-29:**
```typescript
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr } from '@react-email/components';
import * as React from 'react';

export interface ReAuthRequiredProps {
  institution_name: string;
  last_synced_at: Date;
  reconnect_url: string;
}
```

**Visual contract — mirror PasswordReset.tsx lines 38-118:** same Container card (max-width 600px, white bg, rounded-8px), same Heading typography (20px/600/`#1e2e2e`), same teal CTA button (`#0d7f7a` bg, `#fff` text), same warning box pattern (amber `#fef3c7` bg, `#b45309` text), same `pt-BR` date formatting via `toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })`.

**MUST honor:**
- `<Html lang="pt-BR">`.
- Plaintext alternate body — generated separately (mailer's `render()` returns HTML; plaintext requires `@react-email/render` text mode — Phase 1 plan 01-05 lockdown). Add a `renderText()` helper alongside.
- NEVER include raw user PII (CPF / email body) — only `institution_name` + opaque URL.

---

### `src/components/banners/ReAuthBanner.tsx` (component)

**Analog:** `src/components/banners/EmailVerificationNagBanner.tsx`

**Sticky aside shell — copy lines 69-72 with priority change:**
```typescript
'use client';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface ReAuthBannerProps {
  items: Array<{ id: string; institution_name: string }>;
}

export function ReAuthBanner({ items }: ReAuthBannerProps) {
  if (items.length === 0) return null;
  return (
    <aside
      aria-label="Reconexão necessária"
      className="sticky top-0 z-50 flex items-center gap-3 h-12 px-4 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800"
    >
      <AlertTriangle size={16} className="text-amber-700 dark:text-amber-400 flex-shrink-0" aria-hidden="true" />
      <p role="alert" className="flex-1 text-sm text-foreground">
        {items.length === 1
          ? `Sua conexão com ${items[0].institution_name} expirou.`
          : `Suas conexões com ${items[0].institution_name} e mais ${items.length - 1} precisam de atenção.`}
      </p>
      {/* Reconnect CTA — same `text-primary font-semibold underline` (line 88) */}
      {items.length === 1 ? (
        <Link href={`/connect?reconnect=${items[0].id}`} className="text-sm text-primary font-semibold underline" aria-label={`Reconectar ${items[0].institution_name}`}>
          Reconectar {items[0].institution_name}
        </Link>
      ) : (
        <Link href="/settings/connections" className="text-sm text-primary font-semibold underline" aria-label="Ver conexões">
          Ver conexões
        </Link>
      )}
    </aside>
  );
}
```

**MUST honor:**
- `z-50` (one above email-verification's `z-40`) — UI-SPEC § 3.1 + D-37.
- NO dismiss button (D-36 — persistent, not dismissable).
- `role="alert"` on the message text only (live region for urgent updates).
- Server passes pre-fetched items; component is `'use client'` only because of Link interactivity — could be RSC if `<a>` is acceptable.

---

### `src/components/consent/ConsentScreen.tsx` (component — modify)

**Analog:** self (lines 32-112) + extend `lib/consentScopes.ts` (lines 14-15)

**Extend ConsentScope union (consentScopes.ts line 15):**
```typescript
export type ConsentScope =
  | 'ACCOUNT_CREATION'
  | 'PLUGGY_CONNECT_PENDING'
  | `PLUGGY_CONNECTOR:${string}`;
```

**Add new ScopeConfig entry + getScopeConfig branch:**
```typescript
const PLUGGY_CONNECT_PENDING: ScopeConfig = {
  title: 'Conectar sua conta bancária',
  dataPoints: [
    'Saldos e detalhes da conta',
    'Histórico de transações (até 12 meses)',
    'Limites e datas de vencimento do cartão',
  ],
  legalBasis: 'Base legal: Art. 7º, I da LGPD (consentimento)',
};
// in getScopeConfig: if (scope === 'PLUGGY_CONNECT_PENDING') return consentScopes.PLUGGY_CONNECT_PENDING;
```

**Add CPF inline field (D-02 + D-06)** — insert between data points and checkbox (after line 56). Reuse Phase 1 `lib/cpf.ts` `CPFSchema`:
```typescript
import { CPFSchema } from '@/lib/cpf';

// Props extension:
interface ConsentScreenProps {
  scope: ConsentScope;
  hasCpf?: boolean;                 // server-injected; hides field when true
  ctaLabel?: string;                // override "Concordar e continuar" → "Concordar e conectar"
  // ...
}

// Conditional render:
{!hasCpf && scope === 'PLUGGY_CONNECT_PENDING' && (
  <div className="space-y-1">
    <label htmlFor="cpf" className="text-sm font-medium">Seu CPF</label>
    <input
      id="cpf" type="text" inputMode="numeric" autoComplete="off"
      placeholder="000.000.000-00"
      onChange={(e) => setCpf(e.target.value)}
      className="w-full h-11 px-3 rounded-md border border-input"
    />
    {cpfError && <p className="text-xs text-destructive">CPF inválido. Verifique os dígitos e tente novamente.</p>}
  </div>
)}
```

**MUST honor:**
- Native `<input type="checkbox">` (consent file line 74-80 — Radix Checkbox is aria-hidden, breaks RHF register, Phase 1 plan 01-02 finding).
- Validation: client-side `CPFSchema.safeParse(cpf)` first, then server-side on submit (D-06).
- ON invalid CPF: NO DB write, NO consent row, NO token — return inline error only.

---

### `src/components/connect/PluggyConnectWidget.tsx` (component, no analog)

**No Phase 1 analog.** Falls back to RESEARCH.md Pattern 5 + UI-SPEC § 3.3.

**Use `react-pluggy-connect@2.12.0`:**
```typescript
'use client';
import { PluggyConnect } from 'react-pluggy-connect';

export function PluggyConnectWidget(props: PluggyConnectWidgetProps) {
  return (
    <PluggyConnect
      connectToken={props.connectToken}
      includeSandbox={env.NEXT_PUBLIC_PLUGGY_ENV === 'sandbox'}
      updateItem={props.reconnectItemId}
      onSuccess={(item) => props.onSuccess(item.id, item.connector.id)}
      onError={(err) => props.onError(err)}
      onClose={() => props.onClose()}
    />
  );
}
```

**MUST honor:**
- Pluggy widget runs entirely in iframe — MFA NEVER touches our handlers (D-11).
- `peerDependency` warning for `pluggy-js` is benign (Pitfall 2) — do NOT install `pluggy-js`.
- Wrap with full-screen overlay `fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm` per UI-SPEC § 3.3.

---

### `tests/integration/pluggy/webhook.test.ts` (test)

**Analog:** `tests/integration/webhooks/ses-bounce.test.ts` (verbatim structure)

**testcontainers + migrations + MSW pattern — copy lines 19-96:**
- `startTestDb()` from `tests/fixtures/db`.
- `process.env.*` setup in `beforeAll` (lines 64-71) — add `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_WEBHOOK_SECRET`.
- `vi.resetModules()` in `beforeEach` (line 95) so `vi.doMock('@/services/PluggyService', ...)` re-applies per test.
- `await db.execute(sql\`CREATE EXTENSION IF NOT EXISTS pgcrypto\`)` (line 77).
- `await migrate(db, { migrationsFolder: './src/db/migrations' })` (line 78).

**Test scenarios — mirror SES test structure:**
1. Invalid `X-Pluggy-Signature` → 401 (mirrors line 130-140).
2. 3x replay of same `eventId` → 1 webhook_events row (mirrors line 146-193).
3. Unknown event type (e.g. `payment_intent/created`) → row inserted, no enqueue, log entry (Pitfall 10).
4. `item/error` → enqueues `pluggy.re-auth-notifier`.
5. `item/created` → enqueues `pluggy.sync`.

**MUST honor:**
- Direct-import handler via `await import('@/app/api/webhooks/pluggy/route')` (lines 102-105) — NO HTTP server.
- Mock `crypto.timingSafeEqual` ONLY if needed; otherwise pass real header value matching `process.env.PLUGGY_WEBHOOK_SECRET`.
- `peekQueue()` / `drainQueue()` from `@/jobs/boss` to assert enqueued jobs (boss.ts test mode lines 53-58).

---

### `scripts/run-e2e.ts` (utility — modify if Phase 2 e2e tests need Pluggy env)

**Analog:** self (lines 50-58)

**Append Pluggy env block to `.env.local` write** (mirror lines 51-57):
```typescript
writeFileSync(
  ENV_PATH,
  `DATABASE_URL=${url}\n` +
    `NEXTAUTH_SECRET=e2e-secret-at-least-32-chars-long-xxxx\n` +
    `ENCRYPTION_KEY=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\n` +
    `CPF_HASH_PEPPER=e2e-pepper-at-least-32-chars-long-xxxxxx\n` +
    `E2E_TEST=1\n` +
    // Phase 2 additions
    `PLUGGY_ENV=sandbox\n` +
    `PLUGGY_CLIENT_ID=${process.env.PLUGGY_SANDBOX_CLIENT_ID ?? 'stub'}\n` +
    `PLUGGY_CLIENT_SECRET=${process.env.PLUGGY_SANDBOX_CLIENT_SECRET ?? 'stub'}\n` +
    `PLUGGY_WEBHOOK_SECRET=e2e-pluggy-webhook-secret-at-least-32-chars\n`,
  'utf8',
);
```

---

## Shared Patterns

### Pattern S1 — IDOR Guard on Every API Route (P26 / SEC-01)

**Source:** `src/lib/session.ts` lines 97-104
**Apply to:** All `/api/connect/*`, `/api/pluggy/*`, `/api/sync-status` routes; all `/transactions` and `/settings/connections` server components.

```typescript
import { requireSession } from '@/lib/session';

export async function POST(req: Request) {
  const session = await requireSession(req);   // throws UnauthorizedError → 401
  // EVERY query MUST include `AND user_id = ${session.userId}`
  await db.select().from(transactions).where(
    and(
      eq(transactions.id, params.id),
      eq(transactions.user_id, session.userId),    // P26 IDOR enforcement
    ),
  );
  // Return 404 (not 403) on missing row — leaking row existence is itself a privacy violation
}
```

### Pattern S2 — Idempotent Webhook Receiver Shape (P3)

**Source:** `src/app/api/webhooks/ses/bounces/route.ts` lines 28-88
**Apply to:** `src/app/api/webhooks/pluggy/route.ts`.

**Strict ordering:**
1. `export const runtime = 'nodejs'` at top.
2. Parse body (try/catch → 400).
3. Auth header validation (timingSafeEqual) FIRST (T-WH-FORGE).
4. `INSERT webhook_events ON CONFLICT DO NOTHING RETURNING id`.
5. If `inserted.length > 0`, await `enqueue(queue, { webhook_event_id, item_id })`.
6. Log with `latency_ms: Date.now() - start`, `was_duplicate`.
7. Return 200 < 200ms.

### Pattern S3 — pg-boss Worker Loop with Idempotency Guard

**Source:** `src/jobs/workers/sesBounceWorker.ts` lines 38-121
**Apply to:** All 5 new Phase 2 workers.

```typescript
export async function fooWorker(jobs: Job<Payload>[]): Promise<void> {
  for (const job of jobs) {
    try {
      // 1. Read driving row by id (e.g., webhook_event_id, pluggy_items.id)
      // 2. Check `processed_at` / `last_synced_at` idempotency guard
      // 3. Do the work (idempotent operations — UPSERT not INSERT)
      // 4. Mark processed
    } catch (err) {
      logger.error(
        { event: 'worker_job_failed', job_id: job.id, worker: 'foo', error: String(err) },
        'Job processing failed — pg-boss will retry',
      );
      throw err;   // re-throw — pg-boss retries
    }
  }
}
```

### Pattern S4 — Audit Log via `recordAudit()` (D-13)

**Source:** `src/lib/auditLog.ts` lines 27-36
**Apply to:** Every Phase 2 state transition emits an audit row via `recordAudit()`.

**Extend `AuthAuditAction` union in `src/db/schema/auditLog.ts` lines 12-22:**
```typescript
export type AuthAuditAction =
  // Phase 1
  | 'signup' | 'login_success' | /* ... */
  | 'consent_granted' | 'consent_revoked'
  // Phase 2 additions (D-13)
  | 'item_connected' | 'item_disconnected'
  | 'item_reauth_started' | 'item_reauth_succeeded' | 'item_reauth_failed'
  | 'manual_sync_triggered'
  | 'transfer_detected' | 'fatura_detected';
```

**Use:**
```typescript
await recordAudit({
  user_id: session.userId,
  action: 'item_connected',
  metadata: { connector_id, institution_name, cooldown_bypassed: false },   // scrubObject runs automatically (line 34)
  ip_address: req.headers.get('x-forwarded-for') ?? null,
  user_agent: req.headers.get('user-agent') ?? null,
});
```

**MUST honor:** NEVER pass plaintext `pluggy_item_id`, transaction descriptions, or CPF in `metadata` — `scrubObject()` line 34 protects against accidents but P13/P14 says don't put it there in the first place.

### Pattern S5 — pg-boss Singleton Key (D-41)

**Source:** RESEARCH.md § Pattern 2 + `src/jobs/boss.ts` line 125 (`SendOptions` passthrough)
**Apply to:** Every `pluggy.sync` enqueue (webhook receiver, manual sync route, reconnect handler, reconciliation cron).

```typescript
await enqueue(QUEUES.PLUGGY_SYNC,
  { user_id, item_id, trigger: 'webhook' },
  {
    singletonKey: user_id,        // D-41 — per-user concurrency = 1
    singletonHours: 0,            // in-flight only (no time-window dedup)
  },
);
```

**MUST honor:**
- `singletonKey` MUST be `user_id`, NEVER a constant (would serialize all users).
- Reconnect-triggered sync passes the same `singletonKey` but the worker reads `cooldown_bypassed=true` from job data (D-30).

### Pattern S6 — AES-256-GCM Encrypt-on-Write (P4 / CONN-07)

**Source:** `src/lib/crypto.ts` lines 30-54
**Apply to:** Every `pluggy_items` INSERT/UPDATE that touches `pluggy_item_id`.

**Reuse `encryptCPF` / `decryptCPF` AS-IS** (the helpers are generic over any plaintext string — RESEARCH.md "Don't Hand-Roll" table). For the SHA-256 uniqueness hash, use a separate helper or inline:
```typescript
import { encryptCPF as encrypt, decryptCPF as decrypt, hashCPF } from '@/lib/crypto';
import { createHash } from 'node:crypto';

// On write:
const enc = encrypt(pluggyItemIdPlaintext);                    // bytea — iv||tag||ciphertext
const itemHash = createHash('sha256').update(pluggyItemIdPlaintext).digest();   // bytea — for UNIQUE lookup
await db.insert(pluggy_items).values({ pluggy_item_id_enc: enc, pluggy_item_id_hash: itemHash, ... });

// On decrypt (PluggyService only):
const itemId = decrypt(row.pluggy_item_id_enc);
```

**MUST honor:**
- Plaintext NEVER stored, returned in API responses, or logged. Always `hashUserIdForSentry`-style hashing before logging.
- `decrypt()` ONLY inside `PluggyService` (`src/services/PluggyService.ts`). NEVER in route handlers, workers (other than Pluggy ones), or React components.

### Pattern S7 — pino Structured Logging (D-47)

**Source:** `src/lib/logger.ts` (PII-scrubbed via `scrubObject` hook on line 39-50) + `src/jobs/workers/sesBounceWorker.ts` line 102-104
**Apply to:** Every state transition in webhook receivers and workers.

**Catalogue (D-47 — emit literally these `event:` values):**
- `pluggy_webhook_received` { event_type, event_id, latency_ms, was_duplicate }
- `pluggy_webhook_signature_failed`
- `pluggy_webhook_unmapped_event` (Pitfall 10)
- `sync_started` { user_id_hashed, item_id_hashed, trigger }
- `sync_completed` { duration_ms, transactions_added, transactions_updated, transactions_deleted }
- `sync_failed` { reason, status, pluggy_error_code }
- `transfer_detected` { count, user_id_hashed }
- `fatura_detected` { count, user_id_hashed }
- `reconnect_email_sent` { item_id_hashed, debounce_seconds }
- `pluggy_rate_limited` { endpoint, retry_after_seconds }

**MUST honor:** NEVER log raw `pluggy_item_id`, transaction descriptions, CPFs, or Pluggy response bodies. Use `hashUserIdForSentry()` for any ID logged.

### Pattern S8 — Sentry Custom Transaction Wrapping (D-47)

**Source:** Phase 1 `src/lib/sentry.ts` (beforeSend PII scrubber)
**Apply to:** `pluggy.sync` worker entry — every job iteration.

```typescript
import * as Sentry from '@sentry/nextjs';

await Sentry.startSpan(
  {
    op: 'pluggy.sync',
    name: 'pluggy-sync-worker',
    attributes: { tier: subscription_tier, connector_id },
  },
  async () => {
    // sync work
  },
);
```

**MUST honor:** `beforeSend` (lines 64-115) is global — Phase 1 already scrubs PII from every Sentry event. No per-call scrubbing needed.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/connect/PluggyConnectWidget.tsx` | component | — | 3rd-party SDK wrapper (`react-pluggy-connect`) — no Phase 1 SDK wrapper to mirror; rely on UI-SPEC § 3.3 + RESEARCH § Pattern guidance. |
| `src/components/connect/SyncProgressCard.tsx` | component | polling | No polling client component in Phase 1 (Phase 1 is form-submit + redirect, no live polling). UI-SPEC § 3.4 specifies the polling shape. |
| `src/components/transactions/TransactionList.tsx` | component | CRUD | No date-grouped sticky-header list in Phase 1 (Phase 1 has only forms + banners). UI-SPEC § 3.5 specifies the structure. |
| `src/app/api/sync-status/route.ts` | controller | request-response | No simple read-status endpoint in Phase 1. Use minimal `requireSession` + count-query pattern. |

---

## Metadata

**Analog search scope:**
- `src/app/api/webhooks/ses/bounces/route.ts`
- `src/app/api/auth/signup/route.ts`
- `src/db/schema/users.ts`, `accountLocks.ts`, `auditLog.ts`, `consents.ts`, `webhookEvents.ts`, `_shared.ts`, `sesSuppressions.ts`, `index.ts`
- `src/jobs/boss.ts`, `worker.ts`
- `src/jobs/workers/sesBounceWorker.ts`, `passwordResetEmailWorker.ts`
- `src/lib/env.ts`, `crypto.ts`, `cpf.ts`, `session.ts`, `mailer.ts`, `auditLog.ts`, `consentScopes.ts`, `logger.ts`, `sentry.ts`
- `src/components/banners/EmailVerificationNagBanner.tsx`
- `src/components/consent/ConsentScreen.tsx`
- `src/emails/PasswordReset.tsx`
- `tests/integration/webhooks/ses-bounce.test.ts`
- `scripts/run-e2e.ts`

**Files scanned:** 24 Phase 1 files read in full or in targeted ranges.

**Pattern extraction date:** 2026-05-01.
