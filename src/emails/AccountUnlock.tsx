/**
 * Account Unlock email template — Plan 01-03.
 *
 * Sent when a user's account is locked after 5 failed login attempts (D-06).
 * Includes a single-use unlock link and a "wasn't me" CTA per CONTEXT.md
 * Specific Ideas (shared visual template with password-reset).
 *
 * PII contract: The unlock_link is an opaque token URL. No user PII
 * in the email body.
 */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
} from '@react-email/components';
import * as React from 'react';

export interface AccountUnlockProps {
  /** Full unlock URL including the one-time token */
  unlock_link: string;
  /** When the unlock link expires */
  expires_at: Date;
}

export function AccountUnlock({ unlock_link, expires_at }: AccountUnlockProps) {
  const expires_formatted = expires_at.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>Desbloqueie sua conta — Portal Finance</Preview>
      <Body style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f8fafa' }}>
        <Container
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            backgroundColor: '#ffffff',
            padding: '32px',
            borderRadius: '8px',
          }}
        >
          <Heading
            style={{ fontSize: '20px', fontWeight: '600', color: '#1e2e2e' }}
          >
            Sua conta foi temporariamente bloqueada
          </Heading>

          <Text style={{ fontSize: '15px', color: '#334848', lineHeight: '1.6' }}>
            Por segurança, bloqueamos temporariamente o acesso à sua conta após
            múltiplas tentativas de login incorretas. Clique no botão abaixo para
            desbloquear sua conta.
          </Text>

          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button
              href={unlock_link}
              style={{
                backgroundColor: '#0d7f7a',
                color: '#ffffff',
                padding: '12px 32px',
                borderRadius: '6px',
                fontSize: '15px',
                fontWeight: '600',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Desbloquear conta
            </Button>
          </Section>

          <Text style={{ fontSize: '13px', color: '#6b8080', lineHeight: '1.5' }}>
            Este link expira em: <strong>{expires_formatted}</strong> (horário de Brasília).
          </Text>

          <Hr style={{ borderColor: '#e2e8e8', margin: '24px 0' }} />

          <Section
            style={{
              backgroundColor: '#fee2e2',
              borderRadius: '6px',
              padding: '16px',
            }}
          >
            <Text
              style={{
                fontSize: '14px',
                color: '#b91c1c',
                margin: '0',
                lineHeight: '1.5',
              }}
            >
              <strong>Não fui eu.</strong> Se você não tentou acessar sua conta,
              sua senha pode ter sido comprometida. Entre em contato imediatamente
              com nosso suporte: <strong>suporte@portalfinance.app</strong>
            </Text>
          </Section>

          <Text style={{ fontSize: '12px', color: '#9aabab', lineHeight: '1.5', marginTop: '24px' }}>
            Portal Finance — Gestão Financeira Pessoal
            <br />
            Este e-mail é automático. Por favor, não responda a esta mensagem.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default AccountUnlock;
