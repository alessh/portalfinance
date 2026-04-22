'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      data-testid="logout"
      variant="outline"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
      }}
    >
      Sair
    </Button>
  );
}
