import { accounts } from '@gym/db';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminRoleOf,
  auditIp,
  logAudit,
  requireOutranks,
  requirePermission,
  requireStaff,
} from '@/lib/authz';
import { getDb } from '@/lib/db';
import { json, preflight, readJson } from '@/lib/http';
import { mintPasswordResetToken, passwordResetUrl } from '@/lib/passwordReset';

export const runtime = 'nodejs';

/**
 * Admin credential tools for a single member (P1-7, gated
 * `members.manage_credentials`, super/main only per the role presets).
 *
 *  - POST  → mint a single-use, 1-hour password-reset token (mintPasswordResetToken
 *            in @/lib/passwordReset — the SAME mint the self-serve
 *            POST /api/auth/forgot-password route uses, so both produce tokens
 *            one redemption path understands). Only the SHA-256 HASH is stored
 *            (mirrors the sessions table); the plaintext token is returned ONCE
 *            to the admin, who relays the link out of band — email delivery is
 *            still unwired, so the console says so explicitly. Any older
 *            outstanding (unused) token for the account is invalidated so at
 *            most one live token exists. The member redeems via the public
 *            POST /api/auth/reset-password route.
 *
 *  - PATCH {email?, displayName?} → correct login identity. Email is
 *            lowercased + uniqueness-checked; each changed field is audited with
 *            old→new in meta.
 *
 * Both verbs rank-guard staff targets (a lower-ranked staffer can't reset or
 * rename a peer/higher admin's account — requireOutranks). Neither leaks a
 * member-id existence oracle to a caller lacking the permission: the permission
 * check runs before the account lookup.
 */

export function OPTIONS() {
  return preflight();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(req, 'members.manage_credentials');
  if (actor instanceof Response) return actor;

  const { id } = await ctx.params;
  const db = getDb();

  // Rank guard: a lower-ranked staffer must not be able to mint a reset token
  // for a peer/higher admin's account (that would be a credential takeover).
  const targetRole = await adminRoleOf(id);
  const rankBlock = requireOutranks(actor, targetRole);
  if (rankBlock) return rankBlock;

  const rows = await db
    .select({ id: accounts.id, email: accounts.email })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  const account = rows[0];
  if (!account) return json({ error: 'not_found' }, 404);

  // Shared mint: invalidates any prior outstanding token for this account (only
  // ONE live reset link may exist), then stores the SHA-256 hash with a 1-hour
  // expiry. `actor.id` records which admin issued it.
  const { token, expiresAt } = await mintPasswordResetToken(db, id, actor.id);

  await logAudit(
    actor,
    'member.password_reset_issue',
    'account',
    id,
    { email: account.email },
    auditIp(req),
  );

  // The "link" for the member to open. No email is sent — the admin copies this
  // and hands it over. It points at the public /reset-password page, which reads
  // the `token` query param and posts it to POST /api/auth/reset-password.
  const origin = new URL(req.url).origin;
  const resetUrl = passwordResetUrl(origin, token);

  return json(
    {
      token,
      resetUrl,
      expiresAt: expiresAt.toISOString(),
    },
    201,
  );
}

const patchSchema = z
  .object({
    email: z.string().email().max(254).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.email !== undefined || v.displayName !== undefined, {
    message: 'no_fields',
  });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission(req, 'members.manage_credentials');
  if (actor instanceof Response) return actor;

  const { id } = await ctx.params;

  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const db = getDb();
  const ip = auditIp(req);

  // Rank guard: renaming/re-emailing a peer/higher admin's account is a staff
  // identity change the caller may not outrank.
  const targetRole = await adminRoleOf(id);
  const rankBlock = requireOutranks(actor, targetRole);
  if (rankBlock) return rankBlock;

  const rows = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      displayName: accounts.displayName,
    })
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  const account = rows[0];
  if (!account) return json({ error: 'not_found' }, 404);

  const nextEmail = parsed.data.email?.toLowerCase();
  const nextDisplayName = parsed.data.displayName?.trim();

  const set: { email?: string; displayName?: string } = {};
  const meta: Record<string, unknown> = {};

  if (nextEmail !== undefined && nextEmail !== account.email) {
    // Uniqueness: no OTHER account may already hold the new email.
    const clash = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.email, nextEmail), ne(accounts.id, id)))
      .limit(1);
    if (clash.length > 0) return json({ error: 'email_taken' }, 409);
    set.email = nextEmail;
    meta.emailFrom = account.email;
    meta.emailTo = nextEmail;
  }

  if (nextDisplayName !== undefined && nextDisplayName !== account.displayName) {
    set.displayName = nextDisplayName;
    meta.displayNameFrom = account.displayName;
    meta.displayNameTo = nextDisplayName;
  }

  // Nothing actually changed — report success without a spurious audit row.
  if (Object.keys(set).length === 0) {
    return json(
      { member: { id: account.id, email: account.email, displayName: account.displayName } },
      200,
    );
  }

  try {
    await db.update(accounts).set(set).where(eq(accounts.id, id));
  } catch {
    // Unique-constraint race on the email between the check and the update.
    return json({ error: 'email_taken' }, 409);
  }

  await logAudit(actor, 'member.identity_update', 'account', id, meta, ip);

  return json(
    {
      member: {
        id: account.id,
        email: set.email ?? account.email,
        displayName: set.displayName ?? account.displayName,
      },
    },
    200,
  );
}
