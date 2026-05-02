/**
 * /connect — bank connection entry point.
 *
 * Server component. Determines rendering branch based on:
 *   - subscription_tier + active_item_count → paywall stub (D-49)
 *   - ?reconnect={uuid} search param → reconnect flow with per-connector scope
 *   - default → PLUGGY_CONNECT_PENDING consent screen
 *
 * SECURITY (P26 / SEC-01):
 *   - requireSession() called first; unauthenticated → redirect to /login.
 *   - Reconnect path: pluggy_items filtered by user_id = session.userId (IDOR guard).
 *   - 404 returned for reconnect with unknown/foreign item_id (D-12, P26).
 *
 * The client island (ConnectIsland) owns the form submit → token fetch → widget render
 * sequence. No Pluggy SDK calls happen in this server component.
 */
// ConnectIsland (below) renders ConsentScreen for the consent form + CPF field (D-02).
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, pluggy_items, accounts } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { PaywallStubCard } from '@/components/billing/PaywallStubCard';
import { ConnectIsland } from './ConnectIsland';

interface ConnectPageProps {
  searchParams: Promise<{ reconnect?: string }>;
}

/**
 * Count a user's active items — items that have at least one ACTIVE account.
 * This definition aligns with D-49: "free user with 1 active item is blocked".
 * An item without any accounts (e.g., still syncing) counts as active.
 * Items where ALL accounts are DELETED are considered inactive.
 */
async function getActiveItemCount(userId: string): Promise<number> {
  // Count pluggy_items where there exists at least one ACTIVE account,
  // OR where no accounts exist yet (sync in progress).
  const rows = await db
    .select({ id: pluggy_items.id })
    .from(pluggy_items)
    .where(eq(pluggy_items.user_id, userId));

  // Filter: an item is "active" if it has no accounts yet (syncing) OR has at least one ACTIVE account.
  let count = 0;
  for (const item of rows) {
    const activeAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.pluggy_item_id, item.id), eq(accounts.status, 'ACTIVE')))
      .limit(1);

    const allAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.pluggy_item_id, item.id))
      .limit(1);

    // Item is active if: it has ACTIVE accounts, OR it has no accounts yet (newly connected).
    if (activeAccounts.length > 0 || allAccounts.length === 0) {
      count++;
    }
  }
  return count;
}

export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  let session: { userId: string; email: string };
  try {
    session = await requireSession();
  } catch {
    const params = await searchParams;
    const next = params.reconnect ? `/connect?reconnect=${params.reconnect}` : '/connect';
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const params = await searchParams;
  const reconnectId = params.reconnect;

  // Load user subscription tier and CPF status.
  const userRows = await db
    .select({ cpf_hash: users.cpf_hash, subscription_tier: users.subscription_tier })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const user = userRows[0];
  if (!user) redirect('/login');

  const hasCpf = !!user.cpf_hash;
  const isFree = user.subscription_tier === 'free';

  // D-49: Free user attempting 2nd connection → paywall stub (widget never opens).
  if (isFree && !reconnectId) {
    const activeItemCount = await getActiveItemCount(session.userId);
    if (activeItemCount >= 1) {
      return (
        <main className="min-h-screen flex items-center justify-center p-4">
          <div className="w-full max-w-[440px]">
            <PaywallStubCard context="second-item-block" />
          </div>
        </main>
      );
    }
  }

  // D-12: Reconnect deep-link flow — server validates item ownership (IDOR guard, P26).
  if (reconnectId) {
    const itemRows = await db
      .select({ id: pluggy_items.id, connector_id: pluggy_items.connector_id })
      .from(pluggy_items)
      .where(and(eq(pluggy_items.id, reconnectId), eq(pluggy_items.user_id, session.userId)))
      .limit(1);

    if (!itemRows[0]) {
      // 404 not 403 — leaking row existence is itself a privacy violation (P26).
      redirect('/connect');
    }

    const item = itemRows[0];
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-[440px] shadow-md rounded-xl p-8">
          <ConnectIsland
            scope={`PLUGGY_CONNECTOR:${item.connector_id}`}
            hasCpf={hasCpf}
            reconnectItemId={reconnectId}
          />
        </div>
      </main>
    );
  }

  // Default: PLUGGY_CONNECT_PENDING consent screen.
  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[440px] shadow-md rounded-xl p-8">
        <ConnectIsland
          scope="PLUGGY_CONNECT_PENDING"
          hasCpf={hasCpf}
        />
      </div>
    </main>
  );
}
