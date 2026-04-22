/**
 * Auth route-group layout. Thin pass-through — the AuthShell component
 * handles the actual visual chrome inside each page.
 */
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
