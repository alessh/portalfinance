/**
 * AuthShell — UI-SPEC § 2.1 layout for every Phase 1 auth surface.
 *
 * Full-viewport teal background, centered card capped at 440px. Logo +
 * uppercase wordmark sit above a focal-point title (heading 20px/600).
 * Renders a `<main role="main">` landmark for screen readers
 * (UI-SPEC § Accessibility).
 */
import Image from 'next/image';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface AuthShellProps {
  children: ReactNode;
  title: string;
  description?: string;
  footer?: ReactNode;
  className?: string;
}

export function AuthShell({
  children,
  title,
  description,
  footer,
  className,
}: AuthShellProps) {
  return (
    <main
      role="main"
      className={cn(
        'min-h-screen bg-background flex items-center justify-center px-4 py-12',
        className,
      )}
    >
      <div className="max-w-[440px] w-full mx-auto bg-card rounded-xl shadow-md border border-border p-8">
        <div className="flex flex-col items-center mb-6">
          <Image
            src="/logo.svg"
            alt="Portal Finance"
            width={32}
            height={32}
            priority
          />
        </div>
        <p className="text-center text-sm font-semibold text-muted-foreground tracking-wide uppercase mb-8">
          Portal Finance
        </p>
        <h1 className="text-xl font-semibold text-foreground mb-1">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground mb-6">{description}</p>
        ) : (
          <div className="mb-6" />
        )}
        {children}
        {footer ? <div className="mt-6">{footer}</div> : null}
      </div>
    </main>
  );
}
