/**
 * DSR Acknowledgment email template — Plan 01-03.
 *
 * Sent when a user submits a Data Subject Request (export or delete).
 * Mentions the LGPD statutory response windows:
 *   - EXPORT: 15-day statutory window (Art. 19 LGPD)
 *   - DELETE: 30-day retention window post-request
 *
 * CRITICAL — PII contract:
 *   Props are intentionally limited to `request_type` and `dsr_request_id`.
 *   This template MUST NOT receive or render: CPF, email body fields, PIX
 *   descriptions, account numbers, or any user-provided freetext.
 *   The recipient email is passed only to the `to:` destination, never
 *   rendered inside the HTML body. (T-PII-LEAK-EMAIL-TEMPLATE mitigation)
 */
import {
  Body,
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

export interface DSRAcknowledgmentProps {
  /** EXPORT or DELETE — determines copy and statutory window shown */
  request_type: 'EXPORT' | 'DELETE';
  /** The dsr_requests.id UUID — serves as the protocol reference */
  dsr_request_id: string;
}

export function DSRAcknowledgment({
  request_type,
  dsr_request_id,
}: DSRAcknowledgmentProps) {
  const is_export = request_type === 'EXPORT';

  const subject = is_export
    ? 'Solicitação de exportação de dados recebida'
    : 'Solicitação de exclusão de dados recebida';

  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>{subject} — Portal Finance</Preview>
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
            Portal Finance — {subject}
          </Heading>

          <Text style={{ fontSize: '15px', color: '#334848', lineHeight: '1.6' }}>
            Recebemos a sua solicitação e ela está sendo processada pela nossa equipe.
          </Text>

          <Section
            style={{
              backgroundColor: '#f0fafa',
              borderRadius: '6px',
              padding: '16px',
              marginBottom: '16px',
            }}
          >
            <Text style={{ fontSize: '13px', color: '#4a6060', margin: '0 0 4px 0' }}>
              <strong>Protocolo da solicitação:</strong>
            </Text>
            <Text
              style={{
                fontSize: '14px',
                color: '#0d7f7a',
                fontFamily: 'monospace',
                margin: '0',
              }}
            >
              {dsr_request_id}
            </Text>
          </Section>

          {is_export ? (
            <>
              <Text style={{ fontSize: '15px', color: '#334848', lineHeight: '1.6' }}>
                <strong>Prazo de resposta:</strong> De acordo com o Art. 19 da Lei Geral
                de Proteção de Dados (LGPD), o prazo máximo para resposta de
                solicitações de acesso é de <strong>15 (quinze) dias</strong> a partir
                do recebimento deste pedido.
              </Text>
              <Text style={{ fontSize: '15px', color: '#334848', lineHeight: '1.6' }}>
                Quando os seus dados estiverem prontos, você receberá um e-mail com
                as instruções para acessá-los em formato estruturado.
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: '15px', color: '#334848', lineHeight: '1.6' }}>
                <strong>Prazo de exclusão:</strong> Após a confirmação da sua
                solicitação de exclusão, seus dados serão removidos dos nossos sistemas
                em um prazo de até <strong>30 (trinta) dias</strong>, respeitando as
                obrigações legais de retenção previstas na legislação brasileira
                (LGPD Art. 16).
              </Text>
              <Text style={{ fontSize: '15px', color: '#334848', lineHeight: '1.6' }}>
                Durante este período, as conexões com suas instituições financeiras
                via Open Finance (Pluggy) também serão desconectadas e as credenciais
                associadas removidas.
              </Text>
            </>
          )}

          <Hr style={{ borderColor: '#e2e8e8', margin: '24px 0' }} />

          <Text style={{ fontSize: '13px', color: '#6b8080', lineHeight: '1.5' }}>
            Se você não realizou esta solicitação ou tem dúvidas, entre em contato
            com o nosso Encarregado de Dados (DPO):{' '}
            <strong>dpo@portalfinance.com.br</strong>
          </Text>

          <Text style={{ fontSize: '12px', color: '#9aabab', lineHeight: '1.5' }}>
            Portal Finance — Gestão Financeira Pessoal
            <br />
            Este e-mail é automático. Por favor, não responda a esta mensagem.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default DSRAcknowledgment;
