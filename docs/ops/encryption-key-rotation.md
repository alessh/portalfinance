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
- AWS Copilot SSM secret management policy change.

### Procedure

**Step 1 — Generate a new 256-bit key**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Step 2 — Stage both keys as SSM SecureString parameters**

The runtime reads `ENCRYPTION_KEY` from `/copilot/portalfinance/prod/secrets/ENCRYPTION_KEY`. During rotation we add a sibling `_OLD` parameter so the migration script can decrypt with the old key before re-encrypting with the new one.

```sh
aws ssm put-parameter \
  --name /copilot/portalfinance/prod/secrets/ENCRYPTION_KEY_OLD \
  --value "$CURRENT_KEY" --type SecureString --overwrite \
  --region sa-east-1 --profile portalfinance-prod
aws ssm add-tags-to-resource --resource-type Parameter \
  --resource-id /copilot/portalfinance/prod/secrets/ENCRYPTION_KEY_OLD \
  --tags Key=copilot-application,Value=portalfinance Key=copilot-environment,Value=prod \
  --region sa-east-1 --profile portalfinance-prod

aws ssm put-parameter \
  --name /copilot/portalfinance/prod/secrets/ENCRYPTION_KEY \
  --value "$NEW_KEY" --type SecureString --overwrite \
  --region sa-east-1 --profile portalfinance-prod
```

The `copilot-application` + `copilot-environment` tags are mandatory; the task execution role's policy is tag-conditioned and untagged parameters fail at task launch with `AccessDeniedException`. Do NOT redeploy services yet -- the running web/worker tasks must keep using the old key until the migration finishes.

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

Run via the **migrate** Scheduled Job (it has the IAM task role for Secrets Manager + RDS, runs in the right VPC, and reads the SSM parameters set in Step 2). Add the script as another bundled CMD entry in `tsup.config.ts`, then:

```sh
copilot job deploy --name migrate --env prod
copilot job run    --name migrate --env prod \
  --command "node dist/db/rotate-encryption-key.js"
aws logs tail /copilot/portalfinance-prod-migrate --since 5m \
  --region sa-east-1 --profile portalfinance-prod --follow
```

The job inherits `ENCRYPTION_KEY` and `ENCRYPTION_KEY_OLD` from the SSM parameters bound by the migrate manifest's `secrets:` block (add `ENCRYPTION_KEY_OLD` there before deploying).

Never run rotation from a developer laptop -- the prod `DATABASE_URL` and `ENCRYPTION_KEY` must stay inside the VPC.

**Step 4 — Verify row counts**

```sql
-- All rows should have non-null cpf_encrypted and be decryptable.
SELECT COUNT(*) FROM users WHERE cpf_encrypted IS NOT NULL;
```

Spot-check 5 random rows by attempting a decrypt with the new key.

**Step 5 — Remove ENCRYPTION_KEY_OLD**

```sh
aws ssm delete-parameter \
  --name /copilot/portalfinance/prod/secrets/ENCRYPTION_KEY_OLD \
  --region sa-east-1 --profile portalfinance-prod
```

Remove the `ENCRYPTION_KEY_OLD` line from `copilot/migrate/manifest.yml` (and any other manifest that bound it). Redeploy each affected service:

```sh
copilot svc deploy --name web    --env prod
copilot svc deploy --name worker --env prod
copilot job deploy --name migrate --env prod
```

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

**Step 2 — Stage both peppers as SSM SecureString parameters**

Mirror the procedure from Step 2 of `Rotating ENCRYPTION_KEY`, but for the pepper:

```sh
aws ssm put-parameter \
  --name /copilot/portalfinance/prod/secrets/CPF_HASH_PEPPER_OLD \
  --value "$CURRENT_PEPPER" --type SecureString --overwrite \
  --region sa-east-1 --profile portalfinance-prod
aws ssm add-tags-to-resource --resource-type Parameter \
  --resource-id /copilot/portalfinance/prod/secrets/CPF_HASH_PEPPER_OLD \
  --tags Key=copilot-application,Value=portalfinance Key=copilot-environment,Value=prod \
  --region sa-east-1 --profile portalfinance-prod

aws ssm put-parameter \
  --name /copilot/portalfinance/prod/secrets/CPF_HASH_PEPPER \
  --value "$NEW_PEPPER" --type SecureString --overwrite \
  --region sa-east-1 --profile portalfinance-prod
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

```sh
aws ssm delete-parameter \
  --name /copilot/portalfinance/prod/secrets/CPF_HASH_PEPPER_OLD \
  --region sa-east-1 --profile portalfinance-prod
```

Drop the `CPF_HASH_PEPPER_OLD` line from any manifest that bound it, then redeploy the affected services with `copilot svc deploy` / `copilot job deploy`.

---

## Emergency: suspected key/pepper leak

1. Immediately set `/copilot/portalfinance/prod/secrets/MAINTENANCE_MODE=true` (SSM `String`, tagged) and bind it in the web manifest's `secrets:` block, then `copilot svc deploy --name web --env prod` to short-circuit the auth route into a 503.
2. Generate new key/pepper.
3. Execute the rotation procedure above.
4. Verify.
5. Set `MAINTENANCE_MODE=false` and redeploy.
6. Notify affected users per LGPD Art. 48 (within 2 business days).
7. File incident report in internal ops doc.
