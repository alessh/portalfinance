/**
 * /connect/success — post-connection polling page.
 *
 * Plan 02-03 / CONTEXT.md D-03, UI-SPEC § 3.4.
 *
 * Server component shell. requireSession() call keeps this page session-gated.
 * SyncProgressCard (client component) owns the polling + redirect logic.
 *
 * Polling flow:
 *   1. SyncProgressCard polls GET /api/sync-status every 2s.
 *   2. On phase='completed' → router.push('/transactions').
 *   3. After 60s without completion → router.push('/transactions?partial=true').
 */
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { SyncProgressCard } from '@/components/connect/SyncProgressCard';

export default async function ConnectSuccessPage() {
  try {
    await requireSession();
  } catch {
    redirect('/login?next=/connect/success');
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-[440px] shadow-md rounded-xl p-8">
        <SyncProgressCard />
      </div>
    </main>
  );
}
