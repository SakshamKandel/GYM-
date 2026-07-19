import * as Crypto from 'expo-crypto';

/**
 * PIN app-lock fallback (Pack P) — for devices with no biometric hardware
 * (or a member who simply prefers a PIN). The PIN itself is never stored:
 * only a SHA-256 digest lives in `useSecurity`'s persisted state, the same
 * "local device secret, not a server credential" trust model as the
 * biometric lock it sits alongside — this defends against a casual
 * shoulder-glance at Settings' storage, not a compromised device.
 */

const PIN_LENGTH_MIN = 4;
const PIN_LENGTH_MAX = 8;

export function isValidPin(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= PIN_LENGTH_MIN && pin.length <= PIN_LENGTH_MAX;
}

/** SHA-256 digest of the PIN, hex-encoded. Never throws — expo-crypto's digest is sync-safe. */
export async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
}

/** Constant-shape compare (string equality on a fixed-length hex digest — timing is not a real concern on-device). */
export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  const candidate = await hashPin(pin);
  return candidate === hash;
}
