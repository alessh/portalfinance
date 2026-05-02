/**
 * Re-auth Required email template — Plan 02-05 (D-34, D-35).
 *
 * Sent when a Pluggy item enters LOGIN_ERROR / WAITING_USER_INPUT state and
 * the 24h debounce window has expired (D-34).
 *
 * PII contract (P4 / D-35):
 *   - `institution_name` is safe to include (public bank name, not user PII).
 *   - `reconnect_url` contains only the internal `pluggy_items.id` UUID —
 *     NEVER the raw Pluggy item ID (Pitfall P4).
 *   - No CPF, email, or other user-identifiable data in the email body.
 *
 * Plaintext alternate (D-35 + Phase 1 plan 01-05 lockdown):
 *   `renderReAuthRequiredText()` produces the text/plain body. Callers MUST
 *   pass this as `plaintext` to `sendEmail()`.
 *
 * Visual contract mirrors PasswordReset.tsx (PATTERNS.md):
 *   - Container: max-width 600px, white bg, rounded-8px
 *   - Heading: 20px/600/#1e2e2e
 *   - CTA button: teal #0d7f7a bg, white text
 *   - Date format: toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
 *   - <Html lang="pt-BR">
 */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReAuthRequiredProps {
  institution_name: string;
  last_synced_at: Date;
  /**
   * Absolute reconnect URL. Contains only the internal item UUID as a query
   * param (`/connect?reconnect={uuid}`) — the raw Pluggy item ID is NEVER
   * included (P4 / D-35).
   */
  reconnect_url: string;
}

// ---------------------------------------------------------------------------
// React Email component (HTML render)
// ---------------------------------------------------------------------------

export function ReAuthRequired(props: ReAuthRequiredProps) {
  const synced = props.last_synced_at.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>{`Reconecte sua conta ${props.institution_name}`}</Preview>
      <Body style={{ backgroundColor: '#f8fafa', fontFamily: 'Arial, sans-serif' }}>
        <Container
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            backgroundColor: '#ffffff',
            padding: '32px',
            borderRadius: '8px',
          }}
        >
          <Heading style={{ fontSize: '20px', fontWeight: '600', color: '#1e2e2e' }}>
            {`Sua conexão com ${props.institution_name} precisa ser renovada`}
          </Heading>

          <Text style={{ fontSize: '14px', color: '#334848', lineHeight: '1.5' }}>
            {`Última sincronização bem-sucedida: ${synced}. Para continuar recebendo atualizações automáticas das suas transações, reconecte sua conta.`}
          </Text>

          <Section style={{ textAlign: 'center', margin: '24px 0' }}>
            <Button
              href={props.reconnect_url}
              style={{
                backgroundColor: '#0d7f7a',
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '6px',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Reconectar agora
            </Button>
          </Section>

          <Hr style={{ borderColor: '#e2e8e8', margin: '24px 0' }} />

          <Text style={{ fontSize: '12px', color: '#9aabab', lineHeight: '1.5' }}>
            Responda este e-mail para obter suporte. Este e-mail foi enviado por Portal Finance.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default ReAuthRequired;

// ---------------------------------------------------------------------------
// Plaintext alternate (D-35 + Phase 1 plan 01-05 lockdown)
// ---------------------------------------------------------------------------

/**
 * Render the re-auth email as a plaintext string for the text/plain MIME part.
 *
 * Must be passed as `plaintext` to `sendEmail()` alongside the React template.
 * Keeps the same content as the HTML render, stripped of markup.
 */
export function renderReAuthRequiredText(props: ReAuthRequiredProps): string {
  const synced = props.last_synced_at.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return [
    `Sua conexão com ${props.institution_name} precisa ser renovada`,
    '',
    `Última sincronização bem-sucedida: ${synced}.`,
    'Para continuar recebendo atualizações automáticas das suas transações, reconecte sua conta:',
    '',
    props.reconnect_url,
    '',
    'Responda este e-mail para obter suporte. Este e-mail foi enviado por Portal Finance.',
  ].join('\n');
}
