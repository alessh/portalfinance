/**
 * Settings > Privacy page — UI-SPEC § 2.11.
 *
 * Server component: calls requireSession() to gate access, then renders
 * the DSRRequestCard inside a Card with the UI-SPEC heading + description.
 *
 * Phase 1: Shows export and delete CTAs. The actual data processing
 * is Phase 6 — Phase 1 only acknowledges (D-17).
 */
import { requireSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DSRRequestCard } from '@/components/settings/DSRRequestCard';
import { Separator } from '@/components/ui/separator';

export const runtime = 'nodejs';

export const metadata = {
  title: 'Privacidade — Configurações — Portal Finance',
};

export default async function SettingsPrivacyPage() {
  try {
    await requireSession();
  } catch {
    redirect('/login');
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-12 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Privacidade e Dados</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie seus dados pessoais conforme seus direitos pela LGPD (Lei
          13.709/2018).
        </p>
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Seus direitos sobre seus dados</CardTitle>
          <CardDescription>
            Você pode solicitar uma cópia dos seus dados ou a exclusão da sua
            conta a qualquer momento. Todas as solicitações são processadas em
            conformidade com a LGPD.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DSRRequestCard />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Política de Privacidade</CardTitle>
          <CardDescription>
            Saiba quais dados coletamos, como os utilizamos e com quem
            compartilhamos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href="/legal/privacy"
            className="text-primary hover:underline text-sm"
          >
            Ver Política de Privacidade →
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
