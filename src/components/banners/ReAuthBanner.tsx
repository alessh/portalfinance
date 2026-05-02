'use client';

/**
 * Re-auth Banner — Plan 02-05 (D-36, D-37, UI-SPEC § 3.1).
 *
 * Displayed when one or more Pluggy items are in LOGIN_ERROR / WAITING_USER_INPUT
 * state. Persists until the item reconnects successfully (status flips to UPDATED).
 *
 * Design decisions (UI-SPEC § 3.1):
 *   - z-50: positioned one z-level above EmailVerificationNagBanner (z-40) per D-37.
 *   - NOT dismissable (D-36): no X button. The banner is a persistent call-to-action
 *     that disappears only when the underlying connection issue is resolved.
 *   - role="alert" on the text paragraph: urgent live region for screen readers.
 *   - Single item: shows `"Reconectar {institution_name}"` CTA to `/connect?reconnect={id}`.
 *   - Multiple items: shows `"Ver conexões"` CTA to `/settings/connections`.
 *
 * BannerStack integration: rendered via <BannerStack> with priority=10 (above
 * EmailVerificationNagBanner at priority=5). The `priority` prop is accepted
 * but used only by BannerStack for sorting — not rendered on the DOM element.
 */
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

export interface ReAuthBannerProps {
  items: Array<{ id: string; institution_name: string }>;
  /** BannerStack priority — default 10 (above email-verification banner's 5). */
  priority?: number;
}

export function ReAuthBanner({ items }: ReAuthBannerProps) {
  if (items.length === 0) return null;

  const single = items.length === 1 ? items[0] : null;

  return (
    /*
     * UI-SPEC § 3.1: sticky top, z-50, h-12 (48px).
     * Amber palette mirrors the warning semantic color (warning-bg / warning-fg).
     * NOT dismissable — D-36.
     */
    <aside
      aria-label="Reconexão necessária"
      className="sticky top-0 z-50 flex items-center gap-3 h-12 px-4 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800"
    >
      <AlertTriangle
        size={16}
        className="text-amber-700 dark:text-amber-400 flex-shrink-0"
        aria-hidden="true"
      />

      <p role="alert" className="flex-1 text-sm text-foreground">
        {single
          ? `Sua conexão com ${single.institution_name} expirou.`
          : `Suas conexões com ${items[0].institution_name} e mais ${items.length - 1} precisam de atenção.`}
      </p>

      {single ? (
        <Link
          href={`/connect?reconnect=${single.id}`}
          className="text-sm text-primary font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary whitespace-nowrap"
          aria-label={`Reconectar ${single.institution_name}`}
        >
          {`Reconectar ${single.institution_name}`}
        </Link>
      ) : (
        <Link
          href="/settings/connections"
          className="text-sm text-primary font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary whitespace-nowrap"
          aria-label="Ver conexões"
        >
          Ver conexões
        </Link>
      )}
    </aside>
  );
}
