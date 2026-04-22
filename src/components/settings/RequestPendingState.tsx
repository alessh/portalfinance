'use client';
/**
 * RequestPendingState — UI-SPEC § 2.11.
 *
 * Shown after a DSR request is submitted. Displays the statutory deadline
 * per request type:
 *   - EXPORT: 15 dias (LGPD Art. 19)
 *   - DELETE: 30 dias (LGPD Art. 16 retention window)
 *
 * Accepts the dsr_request_id as the protocol reference.
 */
import { Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface RequestPendingStateProps {
  dsr_request_id: string;
  request_type: 'EXPORT' | 'DELETE';
}

export function RequestPendingState({
  dsr_request_id,
  request_type,
}: RequestPendingStateProps) {
  const is_export = request_type === 'EXPORT';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <Clock className="h-6 w-6 text-muted-foreground shrink-0" />
        <CardTitle className="text-base">Solicitação recebida</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {is_export ? (
          <p className="text-sm text-foreground leading-relaxed">
            Sua solicitação de exportação de dados foi recebida com sucesso.
            De acordo com a LGPD (Art. 19), você receberá seus dados em até{' '}
            <strong>15 dias</strong>.
          </p>
        ) : (
          <p className="text-sm text-foreground leading-relaxed">
            Sua solicitação de exclusão de conta foi recebida. Seus dados
            serão removidos dos nossos sistemas em até{' '}
            <strong>30 dias</strong>, respeitando as obrigações legais de
            retenção (LGPD Art. 16).
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <strong>Protocolo:</strong>{' '}
          <code className="bg-muted px-1 rounded text-xs">{dsr_request_id}</code>
        </p>
        <p className="text-xs text-muted-foreground">
          Você receberá um e-mail de confirmação em breve. Guarde o número
          de protocolo para referência futura.
        </p>
      </CardContent>
    </Card>
  );
}
