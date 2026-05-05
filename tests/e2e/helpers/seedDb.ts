/**
 * E2E DB seed helpers — connect to the same testcontainers Postgres
 * that `scripts/run-e2e.ts` writes into `.env.local`, then perform
 * raw inserts that the running Next.js webServer will read.
 *
 * Why raw SQL instead of `import { db } from '@/db'`?
 *   - The Next.js server alias resolves at server runtime, not in the
 *     spec process. Importing `@/db` here would pull in `server-only`
 *     and the env-validated `env.ts`, which Playwright's worker is not
 *     configured for.
 *   - `scripts/run-e2e.ts` writes DATABASE_URL + ENCRYPTION_KEY +
 *     PLUGGY_ITEM_ID_HASH_PEPPER into `.env.local`. We parse that file
 *     once per spec process and connect via `postgres-js` with raw SQL.
 *
 * Visual smoke only — these helpers are NOT a substitute for the
 * integration test fixtures in `tests/integration/pluggy/*`. They
 * exist so the screenshot specs can drive `/transactions` and
 * `/settings/connections` into their documented states (Concern #13).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import postgres from 'postgres';

interface SeedEnv {
  database_url: string;
  encryption_key: Buffer; // 32 raw bytes
  pluggy_item_id_hash_pepper: string;
}

let cached_env: SeedEnv | null = null;

function loadEnvLocal(): SeedEnv {
  if (cached_env) return cached_env;
  const env_path = join(process.cwd(), '.env.local');
  if (!existsSync(env_path)) {
    throw new Error(
      `[seedDb] ${env_path} not found — run \`pnpm test:e2e\` so scripts/run-e2e.ts can write it.`,
    );
  }
  const text = readFileSync(env_path, 'utf8');
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq_idx = trimmed.indexOf('=');
    if (eq_idx < 0) continue;
    map.set(trimmed.slice(0, eq_idx), trimmed.slice(eq_idx + 1));
  }
  const database_url = map.get('DATABASE_URL');
  const enc_key_b64 = map.get('ENCRYPTION_KEY');
  const pepper = map.get('PLUGGY_ITEM_ID_HASH_PEPPER');
  if (!database_url || !enc_key_b64 || !pepper) {
    throw new Error(
      '[seedDb] .env.local missing one of DATABASE_URL / ENCRYPTION_KEY / PLUGGY_ITEM_ID_HASH_PEPPER',
    );
  }
  const encryption_key = Buffer.from(enc_key_b64, 'base64');
  if (encryption_key.byteLength !== 32) {
    throw new Error('[seedDb] ENCRYPTION_KEY must decode to 32 bytes');
  }
  cached_env = {
    database_url,
    encryption_key,
    pluggy_item_id_hash_pepper: pepper,
  };
  return cached_env;
}

let cached_pg: ReturnType<typeof postgres> | null = null;

function getPg(): ReturnType<typeof postgres> {
  if (cached_pg) return cached_pg;
  const env = loadEnvLocal();
  cached_pg = postgres(env.database_url, { max: 2 });
  return cached_pg;
}

/**
 * AES-256-GCM encrypt — mirrors src/lib/crypto.ts encryptCPF layout
 * (`iv (12) || tag (16) || ciphertext`).
 */
function encryptAesGcm(plaintext: string): Buffer {
  const env = loadEnvLocal();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', env.encryption_key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function hmacPluggyItemId(plaintext: string): Buffer {
  const env = loadEnvLocal();
  return createHmac('sha256', Buffer.from(env.pluggy_item_id_hash_pepper, 'utf8'))
    .update(plaintext)
    .digest();
}

/**
 * Look up a user row by email. Throws if missing — the screenshot
 * specs always sign up first.
 */
export async function findUserIdByEmail(email: string): Promise<string> {
  const pg = getPg();
  const rows = await pg<{ id: string }[]>`
    SELECT id FROM users WHERE email = ${email} LIMIT 1
  `;
  if (rows.length === 0) {
    throw new Error(`[seedDb] user not found for email=${email}`);
  }
  return rows[0].id;
}

export async function setUserSubscriptionTier(
  user_id: string,
  tier: 'free' | 'paid',
): Promise<void> {
  const pg = getPg();
  await pg`UPDATE users SET subscription_tier = ${tier} WHERE id = ${user_id}`;
}

export interface SeedItemArgs {
  user_id: string;
  status: 'UPDATED' | 'LOGIN_ERROR' | 'UPDATING' | 'OUTDATED' | 'WAITING_USER_INPUT';
  institution_name?: string;
  last_synced_at?: Date | null;
  last_manual_sync_at?: Date | null;
}

export interface SeededItem {
  id: string;
  pluggy_item_id_plain: string;
}

export async function seedPluggyItem(args: SeedItemArgs): Promise<SeededItem> {
  const pg = getPg();
  const pluggy_item_id_plain = `e2e-pluggy-item-${randomUUID()}`;
  const pluggy_item_id_enc = encryptAesGcm(pluggy_item_id_plain);
  const pluggy_item_id_hash = hmacPluggyItemId(pluggy_item_id_plain);
  const id = randomUUID();
  await pg`
    INSERT INTO pluggy_items (
      id, user_id, pluggy_item_id_enc, pluggy_item_id_hash,
      connector_id, institution_name, status,
      last_synced_at, last_manual_sync_at
    ) VALUES (
      ${id},
      ${args.user_id},
      ${pluggy_item_id_enc},
      ${pluggy_item_id_hash},
      ${'e2e-connector-1'},
      ${args.institution_name ?? 'Sandbox Bank'},
      ${args.status}::item_status_enum,
      ${args.last_synced_at ?? null},
      ${args.last_manual_sync_at ?? null}
    )
  `;
  return { id, pluggy_item_id_plain };
}

export interface SeedAccountArgs {
  user_id: string;
  pluggy_item_id: string;
  name?: string;
  type?: 'BANK' | 'CREDIT';
  balance?: string; // numeric as string
}

export async function seedAccount(args: SeedAccountArgs): Promise<string> {
  const pg = getPg();
  const id = randomUUID();
  const pluggy_account_id = `e2e-acct-${randomUUID()}`;
  await pg`
    INSERT INTO accounts (
      id, user_id, pluggy_item_id, pluggy_account_id,
      type, name, currency, balance, status
    ) VALUES (
      ${id},
      ${args.user_id},
      ${args.pluggy_item_id},
      ${pluggy_account_id},
      ${args.type ?? 'BANK'}::account_type_enum,
      ${args.name ?? 'Conta Corrente'},
      ${'BRL'},
      ${args.balance ?? '1000.00'},
      ${'ACTIVE'}::account_status_enum
    )
  `;
  return id;
}

export interface SeedTransactionArgs {
  user_id: string;
  account_id: string;
  description: string;
  amount: string; // numeric as string
  type?: 'CREDIT' | 'DEBIT';
  posted_at: Date;
}

export async function seedTransaction(args: SeedTransactionArgs): Promise<string> {
  const pg = getPg();
  const id = randomUUID();
  const pluggy_transaction_id = `e2e-tx-${randomUUID()}`;
  await pg`
    INSERT INTO transactions (
      id, user_id, account_id, pluggy_transaction_id,
      type, amount, currency, description, posted_at, status, raw_payload
    ) VALUES (
      ${id},
      ${args.user_id},
      ${args.account_id},
      ${pluggy_transaction_id},
      ${args.type ?? 'DEBIT'}::tx_type_enum,
      ${args.amount},
      ${'BRL'},
      ${args.description},
      ${args.posted_at},
      ${'POSTED'}::tx_status_enum,
      ${JSON.stringify({ source: 'e2e-seed' })}::jsonb
    )
  `;
  return id;
}

/**
 * Best-effort cleanup — close the shared pg pool. Call from a spec's
 * `test.afterAll` if the spec file is the last to run; otherwise the
 * process exits and the pool is reaped.
 */
export async function closeSeedPg(): Promise<void> {
  if (cached_pg) {
    await cached_pg.end();
    cached_pg = null;
  }
}
