# Política de Privacidade — Portal Finance

**Versão:** 1.0 (Rascunho — revisão jurídica pendente)
**Data de vigência:** a definir após revisão jurídica

> **TODO: legal review pending (Phase 6 gate)**
> Este documento é um rascunho inicial para fins de desenvolvimento.
> NÃO deve ser publicado ou apresentado a usuários antes de revisão
> completa por advogado especializado em direito digital e LGPD.

---

## 1. Controlador de Dados

**Controlador:** Portal Finance Ltda.
**CNPJ:** [TODO: inserir CNPJ após constituição da empresa]
**Endereço:** [TODO: inserir endereço]
**E-mail:** privacidade@portalfinance.app

**Encarregado de Dados (DPO):**
Nome: [TODO: designar formalmente conforme Art. 41 da LGPD]
E-mail: dpo@portalfinance.app

---

## 2. Dados Coletados

### 2.1 Fase 1 — Criação de Conta (atual)

| Dado | Finalidade | Base Legal (LGPD) |
|------|-----------|-------------------|
| Endereço de e-mail | Login, comunicações transacionais | Art. 7º, I (consentimento) |
| Senha (hash argon2id) | Autenticação — nunca armazenada em texto puro | Art. 7º, I (consentimento) |
| Dados de sessão (token, IP, user-agent) | Segurança e autenticação | Art. 7º, I (consentimento) |
| Registro de auditoria de eventos auth | Segurança e rastreabilidade | Art. 7º, II (obrigação legal) |

### 2.2 Fase 2 — Conexão Bancária (futura — Open Finance)

| Dado | Finalidade | Base Legal (LGPD) |
|------|-----------|-------------------|
| CPF (criptografado AES-256-GCM) | Identificação única no Open Finance; validação de titularidade | Art. 7º, I (consentimento explícito antes de conectar) |
| Dados de transações bancárias | Categorização e dashboard financeiro | Art. 7º, I (consentimento explícito) |
| Saldos e informações de conta | Dashboard financeiro | Art. 7º, I (consentimento explícito) |
| pluggy_item_id (criptografado) | Manter conexão com instituição financeira | Art. 7º, I (consentimento explícito) |

> **TODO (legal):** Confirmar se CPF para fins de verificação bancária pode ser tratado sob Art. 7º, I exclusivamente, ou se há necessidade de base alternativa.

### 2.3 Dados NÃO coletados

O Portal Finance NÃO coleta:

- Número completo de cartão de crédito (apenas últimos 4 dígitos, via Pluggy);
- Senhas bancárias (o Open Finance usa autenticação delegada via OAuth);
- Dados biométricos;
- Localização geográfica em tempo real.

---

## 3. Finalidades do Tratamento

Os dados pessoais são tratados exclusivamente para:

1. **Prestação do serviço:** autenticação, acesso ao dashboard, sincronização de transações;
2. **Segurança:** detecção de acesso não autorizado, prevenção de fraude, registro de auditoria;
3. **Comunicação transacional:** e-mails de redefinição de senha, notificações de segurança, avisos de conta;
4. **Cumprimento de obrigações legais:** LGPD, legislação fiscal, ordens judiciais;
5. **Melhoria do serviço:** logs de erro anonimizados (Sentry EU — ver seção Suboperadores).

---

## 4. Retenção de Dados

| Categoria | Período de Retenção | Fundamento |
|-----------|---------------------|------------|
| Dados de conta ativa | Enquanto a conta estiver ativa | Prestação do serviço |
| Dados de transações (Open Finance) | Enquanto a conta estiver ativa; mínimo 5 anos | Legislação fiscal/contábil |
| Logs de auditoria de segurança | 30 (trinta) dias | Segurança operacional |
| Dados após encerramento de conta | Até 30 (trinta) dias para exclusão definitiva; dados fiscais até 5 anos | LGPD Art. 16 + legislação aplicável |
| Backups | Sobrescritos em ciclos de 30 dias | Segurança operacional |

> **TODO (legal):** Verificar exigências do Banco Central (Open Finance) e BACEN sobre retenção de dados financeiros. Confirmar prazos com base na legislação fiscal brasileira.

---

## 5. Compartilhamento de Dados

### 5.1 Não Vendemos Dados

O Portal Finance não vende, aluga ou comercializa dados pessoais para terceiros.

### 5.2 Suboperadores Autorizados

Compartilhamos dados com os seguintes suboperadores, nos limites estritamente necessários:

| Suboperador | Finalidade | País dos Dados | Base Legal |
|------------|-----------|---------------|------------|
| Pluggy (Open Finance) | Conexão com instituições financeiras via Open Finance | Brasil | Consentimento explícito do usuário |
| Amazon Web Services (SES) | Envio de e-mails transacionais | Brasil (sa-east-1) | Art. 7º, II + Art. 33, I |
| Amazon Web Services (EC2/RDS via Railway) | Hospedagem da aplicação e banco de dados | Brasil (sa-east-1) | Art. 7º, II + Art. 33, I |
| Sentry (subprocessador de telemetria) | Rastreamento de erros — dados de PII são removidos antes do envio | União Europeia (GDPR adequacy) | Art. 33, I (jurisdição adequada) |
| ASAAS | Processamento de pagamentos | Brasil | Art. 7º, II + Art. 33, I |

> **TODO (legal):** Verificar se Railway está configurado em região `sa-east-1` e se há DPAs adequados com todos os suboperadores listados. Confirmar se o enquadramento do Sentry como suboperador EU está correto para fins da LGPD.

### 5.3 Transferência Internacional

Os dados processados pelo Sentry são enviados para servidores na União Europeia (região de.sentry.io), que possui nível de proteção adequado à LGPD. Antes do envio, todos os dados de PII (CPF, e-mail, números de telefone, descrições de PIX) são automaticamente removidos pelos filtros `beforeSend` do SDK do Sentry.

### 5.4 Compartilhamento por Obrigação Legal

Podemos compartilhar dados quando exigido por ordem judicial, autoridade governamental competente, ou para cumprir obrigações legais aplicáveis.

---

## 6. Segurança

O Portal Finance implementa as seguintes medidas técnicas e organizacionais de segurança:

- **Criptografia em trânsito:** TLS 1.2+ em todas as comunicações;
- **Criptografia em repouso:** CPF e identificadores de conexão bancária criptografados com AES-256-GCM;
- **Senhas:** Armazenadas como hash argon2id (parâmetros OWASP 2025) — nunca em texto puro;
- **Controle de acesso:** Autenticação por sessão com expiração automática; invalidação imediata no logout;
- **Rate limiting:** Limitação de tentativas de login para prevenção de força bruta;
- **Auditoria:** Registro de eventos de autenticação e acesso com metadados anonimizados;
- **PII Scrubbing:** Filtros automáticos removem CPF, e-mail e dados bancários de logs de erro antes do envio para Sentry.

---

## 7. Direitos dos Titulares (LGPD Art. 18)

Como titular de dados pessoais, você tem os seguintes direitos garantidos pela LGPD:

| Direito | Como Exercer | Prazo de Resposta |
|---------|-------------|------------------|
| **Confirmação e Acesso** — saber quais dados possuímos e acessá-los | Configurações > Privacidade > Exportar meus dados | 15 dias úteis (Art. 19 LGPD) |
| **Correção** — corrigir dados incompletos ou desatualizados | Configurações de conta ou e-mail para dpo@portalfinance.app | 15 dias |
| **Eliminação** — solicitar exclusão dos dados | Configurações > Privacidade > Excluir minha conta | 30 dias |
| **Portabilidade** — receber seus dados em formato estruturado | Configurações > Privacidade > Exportar meus dados | 15 dias |
| **Revogação do consentimento** — revogar consentimentos previamente dados | Configurações de conta | Imediato |
| **Oposição** — opor-se a tratamentos com base em legítimo interesse | E-mail para dpo@portalfinance.app | 15 dias |
| **Informação sobre compartilhamento** — saber com quem compartilhamos seus dados | Esta Política de Privacidade | Imediato |

Para exercer qualquer direito, entre em contato com nosso DPO: **dpo@portalfinance.app**

---

## 8. Consentimento e Revogação

### 8.1 Coleta do Consentimento

Ao criar uma conta, você consente explicitamente com o tratamento dos seus dados conforme descrito nesta Política, por meio de marcação de checkbox na tela de cadastro. Registramos: data/hora do consentimento, versão do documento aceito, endereço IP e user-agent do dispositivo.

### 8.2 Revogação

Você pode revogar seu consentimento a qualquer momento. A revogação não afeta a licitude do tratamento realizado antes da revogação. Após a revogação, não poderemos continuar prestando o serviço, pois o consentimento é a base legal principal do tratamento.

---

## 9. Cookies e Tecnologias de Rastreamento

O Portal Finance utiliza apenas cookies de sessão estritamente necessários para o funcionamento da autenticação. Não utilizamos:

- Cookies de rastreamento publicitário;
- Pixels de terceiros;
- Ferramentas de analytics de comportamento (ex.: Google Analytics, Hotjar).

> **TODO (legal):** Se ferramentas de analytics forem adicionadas no futuro, atualizar esta seção e obter consentimento específico conforme exigências do LGPD e recomendações da ANPD.

---

## 10. Menores de Idade

O Serviço é destinado exclusivamente a pessoas maiores de 18 (dezoito) anos. Não coletamos intencionalmente dados de menores. Se identificarmos que dados de menores foram coletados, os excluiremos imediatamente.

---

## 11. Alterações nesta Política

Podemos atualizar esta Política periodicamente. Notificaremos você com antecedência mínima de 30 (trinta) dias sobre alterações materiais. A versão vigente sempre estará disponível em [URL da política].

---

## 12. Autoridade Nacional de Proteção de Dados (ANPD)

Se você acreditar que seus direitos não foram atendidos, pode registrar reclamação junto à ANPD:

**Site:** www.gov.br/anpd
**E-mail:** anpd@anpd.gov.br

---

## 13. Contato

**Encarregado de Dados (DPO):**
E-mail: dpo@portalfinance.app

**Para solicitações de titulares (DSR):**
E-mail: privacidade@portalfinance.app
Prazo de resposta: até 15 dias úteis

> **TODO (legal):** Após designação formal do DPO conforme Art. 41 da LGPD, atualizar com nome completo e registrar na ANPD se aplicável.

---

*Última atualização: 2026-04-22 (rascunho)*
*Este documento está sujeito a revisão jurídica completa antes de entrar em vigor.*
