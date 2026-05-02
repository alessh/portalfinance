/**
 * /transactions — Server Component (Plan 02-06, D-15, D-16, D-22, D-23, D-27, D-31).
 *
 * Date-grouped paginated transaction list with server-side month/account filters
 * and free-tier paywall gate for history older than 3 months.
 *
 * SECURITY:
 *   - requireSession() gates the page; redirect to /login on failure (P26).
 *   - All queries filter on user_id = session.userId (IDOR, P26).
 *   - Free-tier history gate is server-side — transaction data never serialized
 *     to client when paywall is active (T-02-D).
 */
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { startOfMonth, endOfMonth, subMonths, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import Link from 'next/link';
import { db } from '@/db';
import { accounts, pluggy_items, transactions, users } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { AuthenticatedShell } from '@/components/layout/AuthenticatedShell';
import { TransactionList, type TransactionRow } from '@/components/transactions/TransactionList';
import {
  EmptyNoItems,
  EmptySyncing,
  EmptyNoTransactionsInMonth,
} from '@/components/transactions/EmptyTransactions';
import { FilterRow } from './FilterRow';
import { PaywallStubCard } from '@/components/billing/PaywallStubCard';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export const metadata = {
  title: 'Transações — Portal Finance',
};

const PAGE_SIZE = 50;
// Free tier: current month + previous 2 months (3-month window total)
const FREE_TIER_MONTHS = 3;
// Paid tier: 12-month window
const PAID_TIER_MONTHS = 12;

function buildMonthOptions(now: Date, count: number): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i++) {
    const d = subMonths(now, i);
    const value = format(d, 'yyyy-MM');
    const label =
      i === 0
        ? 'Este mês'
        : `${format(d, 'MMMM yyyy', { locale: ptBR }).replace(/^\w/, (c) => c.toUpperCase())}`;
    options.push({ value, label });
  }
  return options;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; account?: string; cursor?: string }>;
}) {
  let session: { userId: string; email: string };
  try {
    session = await requireSession();
  } catch {
    redirect('/login');
  }

  const { month, account: account_filter_id, cursor: cursor_param } = await searchParams;

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
  const months_allowed = tier === 'free' ? FREE_TIER_MONTHS : PAID_TIER_MONTHS;

  const now = new Date();
  const month_options = buildMonthOptions(now, months_allowed);
  const default_month = month_options[0].value; // current month
  const selected_month = month ?? default_month;

  // Parse selected month into date range
  const [year_str, mon_str] = selected_month.split('-');
  const selected_date = new Date(Number(year_str), Number(mon_str) - 1, 1);
  const month_start = startOfMonth(selected_date);
  const month_end = endOfMonth(selected_date);
  const month_label = format(selected_date, 'MMMM yyyy', { locale: ptBR }).replace(
    /^\w/,
    (c) => c.toUpperCase(),
  );

  // Free-tier paywall: block months older than 3-month window (D-27, T-02-D)
  const free_cutoff = startOfMonth(subMonths(now, FREE_TIER_MONTHS - 1));
  const paywall_active = tier === 'free' && month_start < free_cutoff;

  if (paywall_active) {
    return (
      <AuthenticatedShell user_id={session.userId} email_verified={email_verified}>
        <div className="space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Transações</h1>
            <p className="text-sm text-muted-foreground mt-1">Histórico de transações</p>
          </div>
          <Separator />
          {/* Paywall overlay — transaction data never sent to client (T-02-D) */}
          <Card className="relative overflow-hidden bg-background/80 backdrop-blur-sm">
            <PaywallStubCard context="transactions-history" />
          </Card>
        </div>
      </AuthenticatedShell>
    );
  }

  // Check if user has any items at all (for empty state discrimination)
  const [item_count_row] = await db
    .select({ count: pluggy_items.id })
    .from(pluggy_items)
    .where(eq(pluggy_items.user_id, session.userId))
    .limit(1);

  const has_items = !!item_count_row;

  // Check if any item is still syncing
  const [syncing_row] = await db
    .select({ id: pluggy_items.id })
    .from(pluggy_items)
    .where(and(eq(pluggy_items.user_id, session.userId), eq(pluggy_items.status, 'UPDATING')))
    .limit(1);

  const is_syncing = !!syncing_row;

  // Load accounts for filter dropdown (IDOR via user_id through pluggy_items)
  const account_rows = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.user_id, session.userId))
    .orderBy(accounts.name);

  // Pagination offset
  const cursor = Number(cursor_param ?? '0');

  // Transaction query with optional account filter (P26 IDOR: user_id on transactions)
  const query_conditions = [
    eq(transactions.user_id, session.userId),
    gte(transactions.posted_at, month_start),
    lt(transactions.posted_at, month_end),
    ...(account_filter_id ? [eq(transactions.account_id, account_filter_id)] : []),
  ];

  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      type: transactions.type,
      posted_at: transactions.posted_at,
      status: transactions.status,
      is_transfer: transactions.is_transfer,
      is_credit_card_payment: transactions.is_credit_card_payment,
      account_name: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.account_id))
    .where(and(...query_conditions))
    .orderBy(desc(transactions.posted_at))
    .limit(51) // 50 per page + 1 lookahead for hasMore detection (D-22)
    .offset(cursor);

  const has_more = rows.length > PAGE_SIZE;
  const page_rows = has_more ? rows.slice(0, PAGE_SIZE) : rows;

  const tx_list: TransactionRow[] = page_rows.map((r) => ({
    id: r.id,
    description: r.description,
    amount: r.amount,
    type: r.type as 'DEBIT' | 'CREDIT',
    posted_at: r.posted_at,
    status: r.status as 'PENDING' | 'POSTED',
    is_transfer: r.is_transfer,
    is_credit_card_payment: r.is_credit_card_payment,
    account_name: r.account_name,
  }));

  // Build next-page URL for "Carregar mais"
  const next_cursor = cursor + PAGE_SIZE;
  const next_url = new URL(`/transactions`, 'http://x');
  next_url.searchParams.set('month', selected_month);
  if (account_filter_id) next_url.searchParams.set('account', account_filter_id);
  next_url.searchParams.set('cursor', String(next_cursor));

  return (
    <AuthenticatedShell user_id={session.userId} email_verified={email_verified}>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Transações</h1>
          <p className="text-sm text-muted-foreground mt-1">Histórico de transações</p>
        </div>

        <Separator />

        {/* Filter row — client component that auto-submits on select change (D-16) */}
        <FilterRow
          month_options={month_options}
          selected_month={selected_month}
          account_options={account_rows.map((acc) => ({ value: acc.id, label: acc.name }))}
          selected_account={account_filter_id ?? ''}
        />

        {/* Transaction list or empty states */}
        {!has_items ? (
          <EmptyNoItems />
        ) : is_syncing && tx_list.length === 0 ? (
          <EmptySyncing />
        ) : tx_list.length === 0 ? (
          <EmptyNoTransactionsInMonth month_label={month_label} />
        ) : (
          <div>
            {/* TransactionList renders the rows; pagination is a server-rendered Link (SSR-first, D-22) */}
            <TransactionList
              transactions={tx_list}
              hasMore={false}
              onLoadMore={() => {}}
              isLoadingMore={false}
            />
            {has_more && (
              <div className="text-center py-6">
                <Link
                  href={next_url.pathname + next_url.search}
                  className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground min-w-[200px]"
                >
                  Carregar mais
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </AuthenticatedShell>
  );
}
