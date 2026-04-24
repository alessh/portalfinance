/**
 * Password Reset email template — Plan 01-03.
 *
 * Sent when a user requests a password reset. Contains a time-limited
 * reset link and a "wasn't me" CTA per CONTEXT.md Specific Ideas (D-06).
 *
 * PII contract: The reset_link is an opaque token URL — no user PII
 * in the email body beyond what the recipient's own address implies.
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

export interface PasswordResetProps {
  /** Full reset URL including the one-time token */
  reset_link: string;
  /** When the link expires (1-hour TTL) */
  expires_at: Date;
}

export function PasswordReset({ reset_link, expires_at }: PasswordResetProps) {
  const expires_formatted = expires_at.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>Redefinição de senha — Portal Finance</Preview>
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
            Redefinição de senha
          </Heading>

          <Text style={{ fontSize: '15px', color: '#334848', lineHeight: '1.6' }}>
            Recebemos uma solicitação para redefinir a senha da sua conta no Portal
            Finance. Clique no botão abaixo para criar uma nova senha.
          </Text>

          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button
              href={reset_link}
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
              Redefinir senha
            </Button>
          </Section>

          <Text style={{ fontSize: '13px', color: '#6b8080', lineHeight: '1.5' }}>
            Este link expira em: <strong>{expires_formatted}</strong> (horário de Brasília).
            Após esse prazo, você precisará solicitar um novo link.
          </Text>

          <Hr style={{ borderColor: '#e2e8e8', margin: '24px 0' }} />

          <Section
            style={{
              backgroundColor: '#fef3c7',
              borderRadius: '6px',
              padding: '16px',
            }}
          >
            <Text
              style={{
                fontSize: '14px',
                color: '#b45309',
                margin: '0',
                lineHeight: '1.5',
              }}
            >
              <strong>Não fui eu.</strong> Se você não solicitou a redefinição de
              senha, ignore este e-mail. Sua senha permanece inalterada. Se você
              suspeitar de acesso não autorizado, entre em contato imediatamente:{' '}
              <strong>suporte@portalfinance.app</strong>
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

export default PasswordReset;
