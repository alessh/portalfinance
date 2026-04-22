import { AuthShell } from '@/components/auth/AuthShell';
import { AccountLockedScreen } from '@/components/auth/AccountLockedScreen';

export default function LockedPage() {
  return (
    <AuthShell title="Acesso bloqueado">
      <AccountLockedScreen />
    </AuthShell>
  );
}
