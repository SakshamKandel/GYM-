/** Client-side field checks mirroring the server's 400 {error:'invalid'} rules. */

export const PASSWORD_MIN = 8;

// Deliberately loose — the server is the real judge; this just catches typos.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Enter your email';
  if (!EMAIL_RE.test(trimmed)) return "That doesn't look like an email";
  return null;
}

/** Sign-up: enforce the server's minimum length up front. */
export function newPasswordError(password: string): string | null {
  if (!password) return 'Choose a password';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  return null;
}

/** Sign-in: only require something — never hint at length rules. */
export function passwordError(password: string): string | null {
  if (!password) return 'Enter your password';
  return null;
}

export function nameError(name: string): string | null {
  if (!name.trim()) return 'Enter your name';
  return null;
}
