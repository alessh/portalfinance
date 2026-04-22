/**
 * PII Scrubber — rule-based pipeline for stripping personal data.
 *
 * Plan 01-03 — D-18. Consumed from:
 *   - Phase 1: audit_log INSERT (auditLog.ts)
 *   - Phase 1 (01-04): Sentry beforeSend, structured logger (pino hooks)
 *   - Phase 3: LLM prompt builder before text is sent to Gemini
 *
 * Security notes:
 *   - Input length is capped at 10_000 chars before regex evaluation
 *     to prevent ReDoS on adversarially crafted strings.
 *   - scrubObject uses a WeakSet to detect circular references.
 *   - Key-based redaction always wins over string-rule redaction for
 *     matching keys — the whole value is replaced with '[REDACTED]'.
 */

// ---------------------------------------------------------------------------
// Rule type
// ---------------------------------------------------------------------------

export type Rule<T> = (input: T) => T;

// ---------------------------------------------------------------------------
// Regex constants (exported for test assertion)
// ---------------------------------------------------------------------------

/** Formatted CPF: 000.000.000-00 */
export const CPF_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;

/** Raw 11-digit CPF not adjacent to more digits */
export const CPF_RAW_REGEX = /(?<!\d)\d{11}(?!\d)/g;

/** E-mail address */
export const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/** Brazilian phone: +55 (11) 98765-4321 and variants */
export const PHONE_BR_REGEX = /\+?(?:55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[- ]?\d{4}/g;

/** BR bank account: agência-conta digit e.g. 12345-6 */
export const ACCOUNT_REGEX = /\b\d{4,6}-\d\b/g;

/** Token-like strings: base64-url or similar, 24+ chars */
export const TOKEN_LIKE_REGEX = /\b[A-Za-z0-9_-]{24,}\b/g;

// ---------------------------------------------------------------------------
// String rules
// ---------------------------------------------------------------------------

const STRING_RULES: Rule<string>[] = [
  (s) => s.replace(CPF_REGEX, '[CPF]'),
  (s) => s.replace(CPF_RAW_REGEX, '[CPF]'),
  (s) => s.replace(EMAIL_REGEX, '[EMAIL]'),
  (s) => s.replace(PHONE_BR_REGEX, '[PHONE]'),
  (s) => s.replace(ACCOUNT_REGEX, '[ACCOUNT]'),
  (s) => s.replace(TOKEN_LIKE_REGEX, '[TOKEN]'),
];

// ---------------------------------------------------------------------------
// scrubString
// ---------------------------------------------------------------------------

/**
 * Apply all string-level PII rules to a string.
 *
 * Input is capped at 10_000 chars to guard against ReDoS.
 */
export function scrubString(input: string): string {
  let s = input;
  if (s.length > 10_000) {
    s = s.slice(0, 10_000) + '...[TRUNCATED]';
  }
  return STRING_RULES.reduce((acc, rule) => rule(acc), s);
}

// ---------------------------------------------------------------------------
// Key-based redaction set
// ---------------------------------------------------------------------------

/**
 * Object keys whose values are ALWAYS redacted entirely, regardless of
 * whether the string-based rules would have caught them.
 *
 * 'description' and 'descriptionRaw' are included because Pluggy returns
 * free-text transaction descriptions that can contain PIX participant names.
 */
const PII_KEYS = new Set([
  'cpf',
  'cpf_plain',
  'email',
  'email_lower',
  'password',
  'password_hash',
  'description',
  'descriptionraw',
  'account_number',
  'phone',
  'pluggy_item_id',
  'token',
  'access_token',
  'refresh_token',
]);

// ---------------------------------------------------------------------------
// scrubObject
// ---------------------------------------------------------------------------

/**
 * Recursively scrub PII from a plain-object / array / primitive value.
 *
 * - Object keys in PII_KEYS → value replaced with '[REDACTED]'
 * - String leaf values → passed through scrubString
 * - Arrays → each element recursively scrubbed
 * - Circular references → detected via WeakSet, replaced with '[CIRCULAR]'
 * - Non-serialisable values (functions, symbols) → replaced with '[REDACTED]'
 */
export function scrubObject<T>(obj: T, _seen: WeakSet<object> = new WeakSet()): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return scrubString(obj) as unknown as T;
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (typeof obj === 'function' || typeof obj === 'symbol') {
    return '[REDACTED]' as unknown as T;
  }

  if (Array.isArray(obj)) {
    if (_seen.has(obj)) return '[CIRCULAR]' as unknown as T;
    _seen.add(obj);
    return obj.map((item) => scrubObject(item, _seen)) as unknown as T;
  }

  if (typeof obj === 'object') {
    if (_seen.has(obj)) return '[CIRCULAR]' as unknown as T;
    _seen.add(obj);

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (PII_KEYS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = scrubObject(value, _seen);
      }
    }
    return result as unknown as T;
  }

  return obj;
}
