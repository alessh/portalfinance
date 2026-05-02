/**
 * BannerStack — Plan 02-05 (D-37, UI-SPEC § Authenticated Shell Layout).
 *
 * Composes multiple priority-sorted banner components in a vertical stack.
 * Higher priority banners render above lower priority ones.
 *
 * Caller contract:
 * ```tsx
 * <BannerStack
 *   banners={[
 *     { priority: 10, node: <ReAuthBanner items={brokenItems} /> },
 *     { priority: 5,  node: <EmailVerificationNagBanner emailVerified={false} /> },
 *   ]}
 * />
 * ```
 *
 * The `priority` prop is used only for sorting — components render with their
 * own sticky positioning. Both banners display simultaneously when both
 * conditions are active (re-auth=10, email-verification=5).
 */
import * as React from 'react';

export interface BannerEntry {
  priority: number;
  node: React.ReactNode;
}

export interface BannerStackProps {
  banners: BannerEntry[];
}

export function BannerStack({ banners }: BannerStackProps) {
  if (banners.length === 0) return null;

  // Sort descending by priority so highest-priority banners render first (topmost).
  const sorted = [...banners].sort((a, b) => b.priority - a.priority);

  return (
    <div className="flex flex-col">
      {sorted.map((banner, idx) => (
        <React.Fragment key={idx}>{banner.node}</React.Fragment>
      ))}
    </div>
  );
}
