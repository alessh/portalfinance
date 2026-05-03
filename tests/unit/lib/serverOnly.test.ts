/**
 * Plan 02-10 — unit tests for `assertServerOnly()`.
 *
 * The vitest unit project runs under `environment: 'happy-dom'`, which
 * provides `globalThis.window` AND `globalThis.window.document`. By the
 * helper's contract, calling `assertServerOnly()` from the unit-test
 * environment SHOULD throw — that is the bug we are guarding against
 * (someone accidentally importing a server-only module from a client test).
 *
 * Each test below saves and restores `globalThis.window` so the cases are
 * independent regardless of vitest's environment default.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertServerOnly } from '@/lib/serverOnly';

describe('assertServerOnly', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let savedWindow: any;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    savedWindow = (globalThis as any).window;
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = savedWindow;
  });

  it('throws when window AND window.document are defined (browser-shaped)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = { document: {} };
    expect(() => assertServerOnly()).toThrow(/server-only/i);
  });

  it('does NOT throw when window is undefined (Node / tsx / worker context)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window;
    expect(() => assertServerOnly()).not.toThrow();
  });

  it('does NOT throw when window is defined but lacks document (SSR-shim polyfill)', () => {
    // Some libraries set `globalThis.window = {}` for SSR shims without
    // a Document. The helper must NOT trip on those cases.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {};
    expect(() => assertServerOnly()).not.toThrow();
  });

  it('error message names the module and gives recovery guidance', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = { document: {} };
    expect(() => assertServerOnly()).toThrow(/Client Component|browser bundle|happy-dom/);
  });
});
