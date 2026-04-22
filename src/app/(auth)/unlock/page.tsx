import { AuthShell } from '@/components/auth/AuthShell';
import { UnlockPendingScreen } from '@/components/auth/UnlockPendingScreen';

interface PageProps {
  searchParams: Promise<{ result?: string }>;
}

export default async function UnlockPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const result = params.result === 'ok' ? 'ok' : 'expired';
  return (
    <AuthShell title="Desbloqueio de conta">
      <UnlockPendingScreen result={result} />
    </AuthShell>
  );
}
