/**
 * AuthenticatedShell — Plan 02-06, UI-SPEC § Authenticated Shell Layout.
 *
 * Server async component that wraps every authenticated page with:
 *   - BannerStack (ReAuthBanner at priority=10, EmailVerificationNagBanner at priority=5)
 *   - Minimal sticky TopNav (full nav lands in Phase 4)
 *   - Centered main content area
 *
 * SECURITY:
 *   - All DB queries filter on user_id (IDOR, P26).
 *   - Server component — no client-side data leakage risk.
 */
import * as React from 'react';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { pluggy_items, users } from '@/db/schema';
import { BannerStack } from '@/components/banners/BannerStack';
import { ReAuthBanner } from '@/components/banners/ReAuthBanner';
import { EmailVerificationNagBanner } from '@/components/banners/EmailVerificationNagBanner';

export interface AuthenticatedShellProps {
  user_id: string;
  email_verified: boolean;
  children: React.ReactNode;
}

export async function AuthenticatedShell({
  user_id,
  email_verified,
  children,
}: AuthenticatedShellProps) {
  // Fetch broken items (LOGIN_ERROR / WAITING_USER_INPUT) for ReAuthBanner (IDOR via user_id)
  const broken_items = await db
    .select({
      id: pluggy_items.id,
      institution_name: pluggy_items.institution_name,
    })
    .from(pluggy_items)
    .where(
      and(
        eq(pluggy_items.user_id, user_id),
        inArray(pluggy_items.status, ['LOGIN_ERROR', 'WAITING_USER_INPUT']),
      ),
    );

  return (
    <>
      <BannerStack
        banners={[
          { priority: 10, node: <ReAuthBanner items={broken_items} /> },
          {
            priority: 5,
            node: <EmailVerificationNagBanner emailVerified={email_verified} />,
          },
        ]}
      />
      {/* Minimal sticky TopNav — top-12 offsets below one banner (48px). Full nav in Phase 4. */}
      <header className="sticky top-12 z-30 h-14 px-4 flex items-center bg-card border-b border-border">
        <span className="text-sm font-semibold text-foreground">Portal Finance</span>
      </header>
      <main className="max-w-screen-xl mx-auto px-4 md:px-8 py-6">{children}</main>
    </>
  );
}
