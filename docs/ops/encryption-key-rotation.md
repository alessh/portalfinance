# Encryption Key Rotation Runbook

## Overview

Portal Finance uses two long-lived secrets that protect user PII at rest:

| Secret | Env var | Algorithm | Protects |
|---|---|---|---|
| Encryption key | `ENCRYPTION_KEY` | AES-256-GCM | CPF ciphertext, Pluggy item IDs |
| CPF hash pepper | `CPF_HASH_PEPPER` | HMAC-SHA256 | Unique CPF index (login lookup) |

**Rotation of either secret requires a data migration.** Plan the rotation
during a low-traffic maintenance window (typically 02:00–04:00 BRT).

---

## Rotation principles

1. **Never delete the old key before all rows are re-encrypted.** Run the
   migration first, verify row counts, then remove the old key.
2. **Rotate ENCRYPTION_KEY and CPF_HASH_PEPPER separately.** Rotating both
   at the same time doubles the blast radius if something goes wrong.
3. **Keep one previous key version in memory** using a `ENCRYPTION_KEY_OLD`
   env var during the migration window so the app can decrypt with the old
   key and re-encrypt with the new one.

---

## Rotating ENCRYPTION_KEY

### Why

- Scheduled annual rotation (compliance best practice).
- Suspected key leak (rotate immediately).
- Railway secret management policy change.

### Procedure

**Step 1 — Generate a new 256-bit key**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Step 2 — Set both keys in Railway**

In the Railway environment variables panel:

```
ENCRYPTION_KEY=<new-hex-key>
ENCRYPTION_KEY_OLD=<current-hex-key>
```

Do NOT deploy yet.

**Step 3 — Deploy the migration worker**

Run the following one-off script (create as `scripts/rotate-encryption-key.ts`):

```typescript
/**
 * Re-encrypt all AES-256-GCM ciphertext from ENCRYPTION_KEY_OLD → ENCRYPTION_KEY.
 *
 * Affected columns: users.cpf_encrypted, pluggy_items.pluggy_item_id_encrypted.
 */
import { db } from '../src/db';
import { users, pluggy_items } from '../src/db/schema';
import { decryptAES, encryptAES } from '../src/lib/crypto';

async function rotateUsers() {
  const rows = await db.select({ id: users.id, cpf_encrypted: users.cpf_encrypted }).from(users);
  for (const row of rows) {
    if (!row.cpf_encrypted) continue;
    const plain = await decryptAES(row.cpf_encrypted, process.env.ENCRYPTION_KEY_OLD!);
    const next = await encryptAES(plain, process.env.ENCRYPTION_KEY!);
    await db.update(users).set({ cpf_encrypted: next }).where(eq(users.id, row.id));
  }
  console.log(`Rotated ${rows.length} user rows`);
}

async function rotateItems() {
  const rows = await db.select({ id: pluggy_items.id, pluggy_item_id_encrypted: pluggy_items.pluggy_item_id_encrypted }).from(pluggy_items);
  for (const row of rows) {
    const plain = await decryptAES(row.pluggy_item_id_encrypted, process.env.ENCRYPTION_KEY_OLD!);
    const next = await encryptAES(plain, process.env.ENCRYPTION_KEY!);
    await db.update(pluggy_items).set({ pluggy_item_id_encrypted: next }).where(eq(pluggy_items.id, row.id));
  }
  console.log(`Rotated ${rows.length} pluggy_items rows`);
}

await rotateUsers();
await rotateItems();
console.log('Key rotation complete.');
```

Run via:

```bash
DATABASE_URL="$PROD_DATABASE_URL" \
ENCRYPTION_KEY="$NEW_KEY" \
ENCRYPTION_KEY_OLD="$OLD_KEY" \
npx tsx scripts/rotate-encryption-key.ts
```

**Step 4 — Verify row counts**

```sql
-- All rows should have non-null cpf_encrypted and be decryptable.
SELECT COUNT(*) FROM users WHERE cpf_encrypted IS NOT NULL;
```

Spot-check 5 random rows by attempting a decrypt with the new key.

**Step 5 — Remove ENCRYPTION_KEY_OLD**

Remove `ENCRYPTION_KEY_OLD` from Railway. Redeploy.

**Step 6 — Log the rotation**

Add an entry to the rotation log (internal ops doc):

```
Date: YYYY-MM-DD
Rotated: ENCRYPTION_KEY
Reason: [scheduled / suspected leak]
Performed by: [name]
Rows affected: [count]
```

---

## Rotating CPF_HASH_PEPPER

### Why

- Suspected pepper leak.
- Login lookup index must remain consistent — rotate requires rehashing all CPFs.

### Procedure

**Step 1 — Generate a new pepper**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Step 2 — Set both peppers in Railway**

```
CPF_HASH_PEPPER=<new-hex-pepper>
CPF_HASH_PEPPER_OLD=<current-hex-pepper>
```

**Step 3 — Run the hash migration**

The migration must:

1. Read each `users.cpf_encrypted` row.
2. Decrypt CPF using `ENCRYPTION_KEY`.
3. Compute `newHash = hmacSha256(cpf, CPF_HASH_PEPPER)`.
4. Update `users.cpf_hash` to `newHash`.

```typescript
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { decryptAES } from '../src/lib/crypto';
import { hashCPF } from '../src/lib/password';

const rows = await db.select({ id: users.id, cpf_encrypted: users.cpf_encrypted }).from(users);
for (const row of rows) {
  if (!row.cpf_encrypted) continue;
  const cpf = await decryptAES(row.cpf_encrypted, process.env.ENCRYPTION_KEY!);
  const hash = await hashCPF(cpf); // reads CPF_HASH_PEPPER from env
  await db.update(users).set({ cpf_hash: hash }).where(eq(users.id, row.id));
}
console.log(`Re-hashed ${rows.length} CPF rows`);
```

**Step 4 — Verify login still works**

Attempt login with a known test account to confirm hash lookup resolves.

**Step 5 — Remove CPF_HASH_PEPPER_OLD**

Remove from Railway. Redeploy.

---

## Emergency: suspected key/pepper leak

1. Immediately set `MAINTENANCE_MODE=true` in Railway to block logins.
2. Generate new key/pepper.
3. Execute the rotation procedure above.
4. Verify.
5. Set `MAINTENANCE_MODE=false`.
6. Notify affected users per LGPD Art. 48 (within 2 business days).
7. File incident report in internal ops doc.
