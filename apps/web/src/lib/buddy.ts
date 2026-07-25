import { bearerToken, userForToken, type PublicUser } from './auth';

/**
 * NOTE ON THE FILE NAME: the Buddy feature was deleted end-to-end, and with it
 * every helper here that read the buddy tables. What survives is the generic
 * member-session resolver below, which ~24 unrelated routes (meals, payments,
 * promo, push, geo, subscription) already import from this path — so the file
 * stays put rather than churning all of them for a rename.
 */

/** Resolves the Bearer session to a user, or null → caller returns 401. */
export async function authedUser(req: Request): Promise<PublicUser | null> {
  const token = bearerToken(req);
  if (!token) return null;
  return userForToken(token);
}
