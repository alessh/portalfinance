/**
 * Phase 1 minimal authenticated landing. Real DemoDashboard
 * (UI-SPEC § 2.10) lands in plan 01-03; for now we render a welcome
 * line and a logout control so the e2e flow can verify session
 * lifecycle.
 */
export const runtime = 'nodejs';

import { requireSession } from '@/lib/session';
import { LogoutButton } from './LogoutButton';

export default async function DashboardPage() {
  const session = await requireSession();
  return (
    <main role="main" className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">
            Bem-vindo!
          </h1>
          <LogoutButton />
        </header>
        <p className="text-sm text-muted-foreground">
          {session.email} — Dashboard real em desenvolvimento.
        </p>
      </div>
    </main>
  );
}
