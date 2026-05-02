/**
 * PluggyService unit tests — plan 02-02 Tests 1-4.
 *
 * Tests:
 *   1. createConnectToken (initial flow) — calls SDK once, returns token, logs hashed user_id
 *   2. createConnectToken (reconnect mode) — decrypts enc buffer, calls SDK with plaintext itemId
 *   3. deleteItem — logs item_id_hashed; plaintext NEVER in any log payload (T-02-A)
 *   4. Error path — SDK error message MUST NOT contain plaintext itemId (T-02-B)
 *
 * Mocking strategy:
 *   - pluggy-sdk is mocked with vi.mock so NO real HTTP calls are made.
 *   - @sentry/nextjs Sentry.startSpan is mocked to be a passthrough (calls the callback).
 *   - logger.info is spied on so we can inspect captured log objects.
 *   - src/lib/pluggyEnv is mocked to return deterministic creds.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encryptCPF } from '@/lib/crypto';

// ---- Mock pluggy-sdk BEFORE any service imports ----
const mockCreateConnectToken = vi.fn();
const mockDeleteItem = vi.fn();

vi.mock('pluggy-sdk', () => ({
  PluggyClient: vi.fn().mockImplementation(() => ({
    createConnectToken: mockCreateConnectToken,
    fetchItem: vi.fn(),
    fetchAccounts: vi.fn(),
    fetchTransactionsCursor: vi.fn(),
    deleteItem: mockDeleteItem,
  })),
}));

// ---- Mock Sentry as a passthrough ----
vi.mock('@sentry/nextjs', () => ({
  startSpan: vi.fn().mockImplementation((_ctx: unknown, fn: () => Promise<unknown>) => fn()),
}));

// ---- Mock pluggyEnv to provide deterministic creds ----
vi.mock('@/lib/pluggyEnv', () => ({
  getPluggyEnvLabel: () => 'sandbox',
  getPluggyClientId: () => 'test-client-id',
  getPluggyClientSecret: () => 'test-client-secret',
}));

// ---- Import after mocks are registered ----
import { logger } from '@/lib/logger';
import { PluggyService, PluggyError } from '@/services/PluggyService';

describe('PluggyService', () => {
  let service: PluggyService;
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton so each test gets a fresh instance.
    vi.resetModules();
    service = new PluggyService();
    loggerInfoSpy = vi.spyOn(logger, 'info');
  });

  afterEach(() => {
    loggerInfoSpy.mockRestore();
  });

  // --------------------------------------------------------------------------
  // Test 1: createConnectToken — initial flow (no reconnect)
  // --------------------------------------------------------------------------
  it('Test 1: createConnectToken (initial) — calls SDK once with no itemId, returns token, logs hashed user_id', async () => {
    // SDK createConnectToken returns { accessToken: string } only — no expiresAt in SDK types.
    const mockToken = { accessToken: 'tok_abc' };
    mockCreateConnectToken.mockResolvedValueOnce(mockToken);

    const user_id = 'user-uuid-001';
    const result = await service.createConnectToken({ user_id });

    // Returns the correct shape
    expect(result.connect_token).toBe('tok_abc');

    // SDK was called exactly once
    expect(mockCreateConnectToken).toHaveBeenCalledTimes(1);
    // No itemId passed in initial mode (undefined)
    expect(mockCreateConnectToken).toHaveBeenCalledWith(undefined);

    // Log was emitted with event name and hashed user_id (NOT plaintext)
    expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
    const logCall = loggerInfoSpy.mock.calls[0];
    const logMeta = logCall[0] as Record<string, unknown>;
    expect(logMeta.event).toBe('pluggy_connect_token_created');
    // Must NOT contain plaintext user_id
    expect(JSON.stringify(logMeta)).not.toContain(user_id);
    // reconnect field must be false
    expect(logMeta.reconnect).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 2: createConnectToken — reconnect mode
  // --------------------------------------------------------------------------
  it('Test 2: createConnectToken (reconnect) — decrypts enc buffer, passes plaintext to SDK, logs reconnect:true', async () => {
    const plaintextItemId = 'item-real-id-12345';
    const reconnect_item_id_enc = encryptCPF(plaintextItemId);

    const mockToken = { accessToken: 'tok_reconnect' };
    mockCreateConnectToken.mockResolvedValueOnce(mockToken);

    const user_id = 'user-uuid-002';
    const result = await service.createConnectToken({ user_id, reconnect_item_id_enc });

    // Returns token
    expect(result.connect_token).toBe('tok_reconnect');

    // SDK was called with the decrypted plaintext itemId
    expect(mockCreateConnectToken).toHaveBeenCalledWith(plaintextItemId);

    // Log contains reconnect: true
    const logMeta = loggerInfoSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(logMeta.reconnect).toBe(true);
    // user_id NOT plaintext in log
    expect(JSON.stringify(logMeta)).not.toContain(user_id);
  });

  // --------------------------------------------------------------------------
  // Test 3: deleteItem — plaintext NEVER in log payloads
  // --------------------------------------------------------------------------
  it('Test 3: deleteItem — logs item_id_hashed; plaintext NEVER in any captured log payload', async () => {
    const plaintextItemId = 'item-secret-pluggy-id-xyz';
    const item_id_enc = encryptCPF(plaintextItemId);

    mockDeleteItem.mockResolvedValueOnce(undefined);

    const user_id = 'user-uuid-003';
    await service.deleteItem({ user_id, item_id_enc });

    // Log was emitted
    expect(loggerInfoSpy).toHaveBeenCalledTimes(1);
    const logMeta = loggerInfoSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(logMeta.event).toBe('pluggy_item_deleted');

    // item_id_hashed MUST be present (hashed, not raw)
    expect(logMeta.item_id_hashed).toBeDefined();

    // Search ALL captured log calls for plaintext itemId — MUST be zero matches.
    const allLogPayloads = loggerInfoSpy.mock.calls
      .flatMap((callArgs) => callArgs)
      .map((arg) => JSON.stringify(arg));
    const plaintextFound = allLogPayloads.some((payload) => payload.includes(plaintextItemId));
    expect(plaintextFound).toBe(false);

    // Also verify plaintext user_id is not in logs
    const userIdFound = allLogPayloads.some((payload) => payload.includes(user_id));
    expect(userIdFound).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Test 4: Error path — SDK error MUST NOT contain plaintext itemId
  // --------------------------------------------------------------------------
  it('Test 4: error path — SDK error message does not contain plaintext itemId', async () => {
    const plaintextItemId = 'item-error-case-9999';
    const item_id_enc = encryptCPF(plaintextItemId);

    // SDK throws an error that includes the plaintext itemId in the message
    mockDeleteItem.mockRejectedValueOnce(
      new Error(`Pluggy API error: item ${plaintextItemId} not found`),
    );

    const user_id = 'user-uuid-004';
    let thrownError: unknown;
    try {
      await service.deleteItem({ user_id, item_id_enc });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(PluggyError);
    // The error message MUST NOT contain the plaintext itemId
    expect((thrownError as PluggyError).message).not.toContain(plaintextItemId);
    // It should contain the redaction token instead
    expect((thrownError as PluggyError).message).toContain('[redacted-pluggy-item-id]');
  });
});

// --------------------------------------------------------------------------
// Test 5: consentVersions — getConsentVersionHash('pluggy_connect_v1') via module
// --------------------------------------------------------------------------
describe('consentVersions.getPluggyConsentVersionHash', () => {
  it('Test 5: returns a 64-char lowercase hex string and is deterministic across calls', async () => {
    const { getPluggyConsentVersionHash } = await import('@/lib/consentVersions');
    const hash1 = getPluggyConsentVersionHash();
    const hash2 = getPluggyConsentVersionHash();
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1).toBe(hash2);
  });
});

// --------------------------------------------------------------------------
// Test 6: consentScopes — PLUGGY_CONNECT_PENDING config shape
// --------------------------------------------------------------------------
describe('consentScopes.PLUGGY_CONNECT_PENDING', () => {
  it('Test 6: title matches UI-SPEC § 3.2 verbatim and dataPoints has length 3', async () => {
    const { consentScopes, getScopeConfig } = await import('@/lib/consentScopes');
    expect(consentScopes.PLUGGY_CONNECT_PENDING.title).toBe('Conectar sua conta bancária');
    expect(consentScopes.PLUGGY_CONNECT_PENDING.dataPoints).toHaveLength(3);
    // getScopeConfig routes correctly
    const cfg = getScopeConfig('PLUGGY_CONNECT_PENDING');
    expect(cfg.title).toBe('Conectar sua conta bancária');
  });

  it('PLUGGY_CONNECTOR:xxx routes to PLUGGY_CONNECT_PENDING config', async () => {
    const { getScopeConfig } = await import('@/lib/consentScopes');
    const cfg = getScopeConfig('PLUGGY_CONNECTOR:123');
    expect(cfg.title).toBe('Conectar sua conta bancária');
  });
});
