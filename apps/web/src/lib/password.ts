import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Async scrypt on the libuv threadpool. The previous scryptSync blocked the
 * event loop ~50-100ms per call, serializing EVERY concurrent request on the
 * instance during login/register bursts. Same parameters (N=16384, 32-byte
 * key, 16-byte salt) and the same 'scrypt$<saltHex>$<hashHex>' format, so all
 * previously stored hashes keep verifying unchanged.
 */
function scryptAsync(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: SCRYPT_N }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** Returns 'scrypt$<saltHex>$<hashHex>' — format unchanged from the sync version. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}
