import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CloudinaryProvider } from './video/cloudinaryProvider.ts';

const originalFetch = globalThis.fetch;
const originalEnv = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME,
  apiKey: process.env.CLOUDINARY_API_KEY,
  apiSecret: process.env.CLOUDINARY_API_SECRET,
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('CloudinaryProvider.deleteImage', () => {
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'gm-test';
    process.env.CLOUDINARY_API_KEY = 'public-key';
    process.env.CLOUDINARY_API_SECRET = 'secret-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('CLOUDINARY_CLOUD_NAME', originalEnv.cloudName);
    restoreEnv('CLOUDINARY_API_KEY', originalEnv.apiKey);
    restoreEnv('CLOUDINARY_API_SECRET', originalEnv.apiSecret);
  });

  it('destroys an authenticated image with a signed admin request', async () => {
    let requestUrl = '';
    let requestBody = '';
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body ?? '');
      return Response.json({ result: 'ok' });
    };

    await new CloudinaryProvider().deleteImage(
      'progress_photo/member-photo',
      'authenticated',
    );

    assert.equal(
      requestUrl,
      'https://api.cloudinary.com/v1_1/gm-test/image/destroy',
    );
    const form = new URLSearchParams(requestBody);
    assert.equal(form.get('public_id'), 'progress_photo/member-photo');
    assert.equal(form.get('type'), 'authenticated');
    assert.equal(form.get('api_key'), 'public-key');
    assert.ok(form.get('timestamp'));
    assert.ok(form.get('signature'));
  });

  it('treats an already-missing image as a successful no-op', async () => {
    globalThis.fetch = async () =>
      Response.json({ result: 'not found' }, { status: 404 });

    await assert.doesNotReject(() =>
      new CloudinaryProvider().deleteImage('progress_photo/gone', 'authenticated'),
    );
  });
});
