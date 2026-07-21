import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isAllowedDevOrigin } from './cors.ts';

describe('isAllowedDevOrigin', () => {
  test('allows arbitrary localhost and IPv4 loopback dev-server ports', () => {
    for (const origin of [
      'http://localhost:8718',
      'http://localhost:49152',
      'http://127.0.0.1:8081',
      'https://127.0.0.1:4443',
    ]) {
      assert.equal(isAllowedDevOrigin(origin), true, origin);
    }
  });

  test('rejects non-loopback and lookalike hosts', () => {
    for (const origin of [
      'https://evil.example',
      'http://localhost.evil.example:8718',
      'http://127.0.0.1.evil.example:8718',
      'http://user@localhost:8718',
      'http://[::1]:8718',
    ]) {
      assert.equal(isAllowedDevOrigin(origin), false, origin);
    }
  });

  test('rejects malformed origin values', () => {
    for (const origin of [
      '',
      'localhost:8718',
      'http://localhost',
      'http://localhost:not-a-port',
      'http://localhost:8718/path',
      'http://localhost:8718?query=yes',
      'http://localhost:8718#fragment',
    ]) {
      assert.equal(isAllowedDevOrigin(origin), false, origin);
    }
  });
});
