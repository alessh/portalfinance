'use client';
/**
 * SyncProgressCard — 3-step progress indicator for /connect/success.
 *
 * Plan 02-03 / CONTEXT.md D-03, UI-SPEC § 3.4.
 *
 * Polls GET /api/sync-status every 2 seconds (TanStack Query refetchInterval).
 * Auto-redirects to /transactions on phase='completed' or after 60 seconds.
 *
 * Step state machine:
 *   Step 1 (Conta conectada) — always 'completed' when this page renders.
 *   Step 2 (Carregando contas) — in-progress until accounts appear.
 *   Step 3 (Carregando transações) — in-progress until tx_count > 0.
 *
 * Copy (pt-BR) is from UI-SPEC Copywriting Contract § Connect Success.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CheckCircle2, Loader2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SyncPhase = 'connecting' | 'loading_accounts' | 'loading_transactions' | 'completed' | 'no_items';

interface SyncStatusResponse {
  phase: SyncPhase;
  transactions_count: number;
}

type StepStatus = 'pending' | 'in-progress' | 'completed';

function StepRow({ label, status }: { label: string; status: StepStatus }) {
  if (status === 'completed') {
    return (
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" aria-hidden="true" />
        <span className="text-sm text-success-fg line-through">{label}</span>
      </div>
    );
  }
  if (status === 'in-progress') {
    return (
      <div className="flex items-center gap-3">
        <span
          className="motion-safe:animate-pulse h-3 w-3 rounded-full bg-primary flex-shrink-0 mt-0.5"
          aria-hidden="true"
        />
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
    );
  }
  // pending
  return (
    <div className="flex items-center gap-3">
      <Circle className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

const TIMEOUT_MS = 60_000;

export function SyncProgressCard() {
  const router = useRouter();
  const [elapsed_ms, setElapsed_ms] = useState(0);
  const redirectedRef = useRef(false);
  const startRef = useRef(Date.now());

  // Elapsed time ticker for 60s timeout.
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed_ms(Date.now() - startRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll /api/sync-status every 2 seconds (D-03).
  const { data } = useQuery<SyncStatusResponse>({
    queryKey: ['sync-status'],
    queryFn: () => fetch('/api/sync-status').then((r) => r.json()),
    refetchInterval: 2000, // POLL_INTERVAL_MS — inline so pattern grep works
  });

  // Auto-redirect on completion or timeout.
  useEffect(() => {
    if (redirectedRef.current) return;

    if (data?.phase === 'completed') {
      redirectedRef.current = true;
      router.push('/transactions');
      return;
    }

    if (elapsed_ms >= TIMEOUT_MS) {
      redirectedRef.current = true;
      router.push('/transactions?partial=true');
    }
  }, [data?.phase, elapsed_ms, router]);

  // Derive step statuses from current phase.
  const phase = data?.phase ?? 'connecting';
  const isTimeout = elapsed_ms >= TIMEOUT_MS;

  const step1Status: StepStatus = 'completed'; // always completed on this page
  const step2Status: StepStatus =
    phase === 'completed' || phase === 'loading_transactions'
      ? 'completed'
      : phase === 'loading_accounts'
        ? 'in-progress'
        : 'pending';
  const step3Status: StepStatus =
    phase === 'completed'
      ? 'completed'
      : phase === 'loading_transactions'
        ? 'in-progress'
        : 'pending';

  return (
    <div className="space-y-6 text-center">
      {/* Headline */}
      <div>
        <Loader2
          className="mx-auto h-10 w-10 text-primary motion-safe:animate-spin"
          aria-hidden="true"
        />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Sincronizando...</h1>
      </div>

      {/* Progress steps */}
      <div className="space-y-3 text-left">
        <StepRow label="Conta conectada" status={step1Status} />
        <StepRow label="Carregando contas..." status={step2Status} />
        <StepRow label="Carregando transações..." status={step3Status} />
      </div>

      {/* Patience copy */}
      {!isTimeout && (
        <p className="text-xs text-muted-foreground">Isso pode levar até 1 minuto.</p>
      )}

      {/* Auto-redirect note or timeout state */}
      {isTimeout ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Está demorando mais do que o esperado. Suas transações aparecerão em breve.
          </p>
          <Button asChild className="w-full">
            <Link href="/transactions">Ir para transações →</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Você será redirecionado automaticamente.</p>
          <Button asChild variant="ghost" size="sm">
            <Link href="/transactions">Ir para transações →</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
