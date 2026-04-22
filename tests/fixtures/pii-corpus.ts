/**
 * Fake-but-real-shaped PII used to exercise lib/piiScrubber (plan 01-03)
 * and any future redaction layer (Sentry beforeSend, LLM prompts).
 *
 * NEVER use these values in production logging or LLM payloads — they exist
 * solely so unit tests can assert that scrubbing leaves NO original byte intact.
 */
export const piiCorpus = {
  cpfs: {
    formatted: ['123.456.789-00', '987.654.321-99', '111.222.333-44'],
    raw: ['12345678900', '98765432199', '11122233344'],
    spaced: ['123 456 789 00'],
  },
  emails: [
    'user@example.com',
    'suporte+tag@portalfinance.com.br',
    'a.b.c@test.co',
  ],
  phonesBr: ['+55 11 98765-4321', '(11) 98765-4321', '11 987654321'],
  accounts: ['12345-6', '0001-2'],
  pixDescriptions: [
    'PIX JOAO DA SILVA PAGAMENTO 123.456.789-00',
    'TED MARIA APARECIDA SANTOS',
  ],
  tokens: [
    'abc123def456ghi789jkl012mno345',
    'eyJhbGciOiJIUzI1NiJ9.aaa.bbb',
  ],
} as const;
