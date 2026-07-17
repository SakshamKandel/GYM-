import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { allowedGoogleClientIds, verifyGoogleIdToken } from './google.ts';

const originalClientId = process.env.GOOGLE_CLIENT_ID;
const originalClientIds = process.env.GOOGLE_CLIENT_IDS;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = originalClientId;
  if (originalClientIds === undefined) delete process.env.GOOGLE_CLIENT_IDS;
  else process.env.GOOGLE_CLIENT_IDS = originalClientIds;
  globalThis.fetch = originalFetch;
});

describe('allowedGoogleClientIds', () => {
  test('combines, trims, and de-duplicates both supported environment variables', () => {
    process.env.GOOGLE_CLIENT_ID = 'web.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_IDS =
      ' web.apps.googleusercontent.com, android.apps.googleusercontent.com ';

    assert.deepEqual(allowedGoogleClientIds(), [
      'web.apps.googleusercontent.com',
      'android.apps.googleusercontent.com',
    ]);
  });

  test('fails closed when neither server audience is configured', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_IDS;
    assert.deepEqual(allowedGoogleClientIds(), []);
  });
});

describe('verifyGoogleIdToken', () => {
  test('accepts a current, verified token for an allowed audience', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          aud: 'web.apps.googleusercontent.com',
          sub: 'google-user-1',
          email: 'USER@EXAMPLE.COM',
          email_verified: 'true',
          exp: String(Math.floor(Date.now() / 1000) + 3_600),
          name: 'Gym User',
        }),
      );

    assert.deepEqual(
      await verifyGoogleIdToken('valid-token', ['web.apps.googleusercontent.com']),
      {
        sub: 'google-user-1',
        email: 'user@example.com',
        displayName: 'Gym User',
      },
    );
  });

  test('rejects wrong audiences, unverified email, and expired tokens', async () => {
    const base = {
      aud: 'other.apps.googleusercontent.com',
      sub: 'google-user-1',
      email: 'user@example.com',
      email_verified: 'true',
      exp: String(Math.floor(Date.now() / 1000) + 3_600),
    };
    globalThis.fetch = async () => new Response(JSON.stringify(base));
    assert.equal(
      await verifyGoogleIdToken('wrong-audience', ['web.apps.googleusercontent.com']),
      null,
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ...base, aud: 'web.apps.googleusercontent.com', email_verified: 'false' }));
    assert.equal(
      await verifyGoogleIdToken('unverified-email', ['web.apps.googleusercontent.com']),
      null,
    );

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ...base,
          aud: 'web.apps.googleusercontent.com',
          exp: String(Math.floor(Date.now() / 1000) - 1),
        }),
      );
    assert.equal(
      await verifyGoogleIdToken('expired-token', ['web.apps.googleusercontent.com']),
      null,
    );
  });
});
