/**
 * Authenticated dashboard — UI-SPEC § 2.10.
 *
 * Plan 01-04 — D-03 (first post-signup screen).
 *
 * Server component: reads email_verified_at from DB, renders
 * EmailVerificationNagBanner only when email is unverified,
 * then renders DemoDashboard with illustrative BR middle-class data.
 */
export const runtime = 'nodejs';

import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { DemoDashboard } from '@/components/demo/DemoDashboard';
import { EmailVerificationNagBanner } from '@/components/banners/EmailVerificationNagBanner';
import { LogoutButton } from './LogoutButton';

export default async function DashboardPage() {
  const { userId } = await requireSession();

  const [user] = await db
    .select({ email_verified_at: users.email_verified_at })
    .from(users)
    .where(eq(users.id, userId));

  const email_verified = !!user?.email_verified_at;

  return (
    <>
      <EmailVerificationNagBanner emailVerified={email_verified} />
      <main className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <LogoutButton />
        </header>
        <DemoDashboard />
      </main>
    </>
  );
}
