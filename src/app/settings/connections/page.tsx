/**
 * /settings/connections — Server Component (Plan 02-06, D-17, D-18, D-20, D-21, D-25, D-28, D-29).
 *
 * Renders one ConnectionCard per pluggy_items row owned by the session user.
 * Each card includes: institution logo, name, status pill, sub-account list with balance,
 * cooldown-aware sync button, and disconnect button (D-17, D-20).
 *
 * SECURITY:
 *   - requireSession() gates the page; redirect to /login on failure (P26).
 *   - All queries filter on user_id = session.userId (IDOR, P26).
 *   - Subscription tier is read server-side — client cannot bypass paywall (T-02-C).
 */
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { accounts, pluggy_items, users } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { AuthenticatedShell } from '@/components/layout/AuthenticatedShell';
import { ConnectionsClient } from './ConnectionsClient';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Conexões bancárias — Portal Finance',
};

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes (mirrors sync route constant)

export default async function ConnectionsPage() {
  let session: { userId: string; email: string };
  try {
    session = await requireSession();
  } catch {
    redirect('/login');
  }

  // Load user tier + email_verified_at (IDOR-safe via session)
  const [user_row] = await db
    .select({
      subscription_tier: users.subscription_tier,
      email_verified_at: users.email_verified_at,
    })
    .from(users)
    .where(eq(users.id, session.userId));

  const tier = user_row?.subscription_tier ?? 'free';
  const email_verified = !!user_row?.email_verified_at;

  // Load all pluggy items for user with their accounts (IDOR via user_id)
  const items_raw = await db
    .select({
      id: pluggy_items.id,
      institution_name: pluggy_items.institution_name,
      institution_logo_url: pluggy_items.institution_logo_url,
      status: pluggy_items.status,
      last_synced_at: pluggy_items.last_synced_at,
      // Account fields (LEFT JOIN — may be null if item has no ACTIVE accounts)
      account_id: accounts.id,
      account_name: accounts.name,
      account_balance: accounts.balance,
      account_currency: accounts.currency,
      account_type: accounts.type,
      account_credit_limit: accounts.credit_limit,
    })
    .from(pluggy_items)
    .leftJoin(
      accounts,
      and(
        eq(accounts.pluggy_item_id, pluggy_items.id),
        eq(accounts.status, 'ACTIVE'),
      ),
    )
    .where(eq(pluggy_items.user_id, session.userId))
    .orderBy(pluggy_items.created_at);

  // Group accounts by item
  const items_map = new Map<
    string,
    {
      id: string;
      institution_name: string;
      institution_logo_url: string | null;
      status: 'UPDATING' | 'LOGIN_ERROR' | 'OUTDATED' | 'WAITING_USER_INPUT' | 'UPDATED';
      last_synced_at: Date | null;
      accounts: Array<{
        id: string;
        name: string;
        balance: string;
        currency: string;
        type: string;
        credit_limit: string | null;
      }>;
    }
  >();

  for (const row of items_raw) {
    if (!items_map.has(row.id)) {
      items_map.set(row.id, {
        id: row.id,
        institution_name: row.institution_name,
        institution_logo_url: row.institution_logo_url,
        status: row.status,
        last_synced_at: row.last_synced_at,
        accounts: [],
      });
    }
    // Add account if present (LEFT JOIN may produce null row)
    if (row.account_id) {
      items_map.get(row.id)!.accounts.push({
        id: row.account_id,
        name: row.account_name!,
        balance: row.account_balance!,
        currency: row.account_currency!,
        type: row.account_type!,
        credit_limit: row.account_credit_limit ?? null,
      });
    }
  }

  const items = [...items_map.values()];

  // Compute cooldown_remaining_seconds per item (server-side, not client-guessable)
  const now_ms = Date.now();
  const items_with_cooldown = items.map((item) => ({
    ...item,
    cooldown_remaining_seconds: item.last_synced_at
      ? Math.max(0, Math.ceil((COOLDOWN_MS - (now_ms - item.last_synced_at.getTime())) / 1000))
      : 0,
  }));

  return (
    <AuthenticatedShell user_id={session.userId} email_verified={email_verified}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Conexões bancárias</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie suas contas conectadas
          </p>
        </div>

        <Separator />

        {items_with_cooldown.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">
              Nenhuma conta bancária conectada ainda.
            </p>
          </div>
        ) : (
          /* ConnectionsClient handles sync + disconnect client interactions */
          <ConnectionsClient
            items={items_with_cooldown}
            subscription_tier={tier}
          />
        )}

        <Separator />

        {/* Add connection CTA */}
        <div className="flex justify-center">
          <Button asChild variant="outline" className="w-full md:w-auto">
            <Link href="/connect">+ Conectar outro banco</Link>
          </Button>
        </div>
      </div>
    </AuthenticatedShell>
  );
}
