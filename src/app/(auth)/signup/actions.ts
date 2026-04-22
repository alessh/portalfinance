'use server';
/**
 * Signup server action — exposed as a React Server Action so the form
 * can call it directly from a client component.
 *
 * Per Next 16 / React Server Actions contract, files with `'use server'`
 * may export ONLY async functions (no `runtime`, no constants, no type
 * re-exports). The actual implementation (which is also reused by the
 * JSON wrapper at /api/auth/signup and integration tests) lives in
 * `./signupCore.ts`.
 */
import { signup as signupCore } from './signupCore';

export async function signup(
  input: Parameters<typeof signupCore>[0],
): ReturnType<typeof signupCore> {
  return signupCore(input);
}

export async function signupAction(
  input: Parameters<typeof signupCore>[0],
): ReturnType<typeof signupCore> {
  return signupCore(input);
}
