import { z } from 'zod';

/**
 * Server-issued nonce used to bind one native Apple authorization to one
 * backend sign-in attempt. The value is opaque to the mobile client.
 */
export const appleAuthNonceSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const appleAuthNonceResponseSchema = z
  .object({
    nonce: appleAuthNonceSchema,
  })
  .strict();

/**
 * Mobile -> API Sign in with Apple boundary. Authentication comes only from
 * the signed identity token; displayName is optional profile metadata Apple
 * supplies to the app once and is sanitised again by the server.
 */
export const appleAuthRequestSchema = z
  .object({
    identityToken: z.string().min(1).max(16_384),
    nonce: appleAuthNonceSchema,
    displayName: z.string().trim().min(1).max(80).optional(),
    /** Only present when linking to an existing password account. */
    password: z.string().min(1).max(1_024).optional(),
  })
  .strict();

export type AppleAuthRequest = z.infer<typeof appleAuthRequestSchema>;
