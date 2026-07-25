'use client';

import { COACH_SPECIALTIES } from '@gym/shared';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, TextField } from '@/components/console';
import { tierLabel } from '@/app/admin/_lib/tierLabel';

/** One certification line on the public portfolio (shape of the jsonb column). */
export interface CoachCertification {
  title: string;
  issuer: string;
  year: number | null;
}

/** Seniority badge — NOT a billing tier. */
export type CoachTier = 'silver' | 'gold' | 'elite';

export interface CoachProfile {
  displayName: string;
  bio: string;
  acceptingClients: boolean;
  replyWindowHours: number;
  isActive: boolean;
  avatarUrl: string | null;
  coachTier: CoachTier;
  headline: string;
  specialties: string[];
  certifications: CoachCertification[];
  achievements: string[];
  yearsExperience: number;
  capacity: number;
}

// Caps mirror the server (PATCH /api/coach/profile) so a typo fails one field
// here instead of rejecting the whole save.
const MAX_BIO = 2000;
const MAX_HEADLINE = 120;
const MIN_REPLY_HOURS = 1;
const MAX_REPLY_HOURS = 168;
const MAX_SPECIALTIES = 6;
const MAX_ACHIEVEMENTS = 10;
const MAX_ACHIEVEMENT_LEN = 120;
const MAX_CERTS = 10;
const MAX_CERT_FIELD = 80;
const MIN_CERT_YEAR = 1950;
const MAX_CERT_YEAR = 2100;
const MIN_YEARS = 0;
const MAX_YEARS = 60;
const MIN_CAPACITY = 1;
const MAX_CAPACITY = 200;
const MAX_UPGRADE_NOTE = 500;
/** Refuse absurd originals before the bytes leave the browser. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const DANGER = 'var(--gt-danger)';

/**
 * Plain words for a save the server turned down.
 *
 * PATCH /api/coach/profile answers with machine codes ('displayName_too_long',
 * 'replyWindowHours_out_of_range', …). Those are for logs, not for a coach
 * staring at a form, so every one is translated here into what went wrong and
 * what to do about it. Unknown codes fall back to a sentence that still tells
 * the coach their work is safe and retryable.
 */
function saveErrorMessage(code: string | undefined, status: number): string {
  switch (code) {
    case 'invalid':
    case 'invalid_body':
      return 'Some of these details could not be saved. Check the fields above and save again.';
    case 'displayName_must_be_string':
      return 'Your display name needs to be text. Retype it and save again.';
    case 'displayName_too_long':
      return 'Your display name is too long. Shorten it and save again.';
    case 'bio_must_be_string':
      return 'Your bio needs to be text. Retype it and save again.';
    case 'bio_too_long':
      return `Your bio is too long. Trim it to ${MAX_BIO} characters and save again.`;
    case 'acceptingClients_must_be_boolean':
      return 'The "accepting clients" setting did not save. Switch it again and save.';
    case 'replyWindowHours_must_be_integer':
      return 'Your reply time needs to be a whole number of hours.';
    case 'replyWindowHours_out_of_range':
      return `Your reply time has to be between ${MIN_REPLY_HOURS} and ${MAX_REPLY_HOURS} hours.`;
    case 'no_editable_fields':
      return 'Nothing here has changed yet, so there was nothing to save.';
    case 'not_found':
      return 'Your coach profile could not be found. Reload the page and try again.';
    default:
      return status === 403
        ? 'Your account is not allowed to edit this profile.'
        : 'Your profile could not be saved just now. Nothing was lost, so try saving again.';
  }
}

/** Tiers ABOVE `current` a coach may request — matches the server's rank check. */
function upgradeTargetsFor(current: CoachTier): CoachTier[] {
  if (current === 'silver') return ['gold', 'elite'];
  if (current === 'gold') return ['elite'];
  return [];
}

/** The editable slice of the profile — everything saved by the one Save button. */
interface FormState {
  displayName: string;
  bio: string;
  acceptingClients: boolean;
  replyWindowHours: number;
  headline: string;
  specialties: string[];
  certifications: CoachCertification[];
  achievements: string[];
  yearsExperience: number;
  capacity: number;
}

function toForm(p: CoachProfile): FormState {
  return {
    displayName: p.displayName,
    bio: p.bio,
    acceptingClients: p.acceptingClients,
    replyWindowHours: p.replyWindowHours,
    headline: p.headline,
    specialties: [...p.specialties],
    certifications: p.certifications.map((c) => ({ ...c })),
    achievements: [...p.achievements],
    yearsExperience: p.yearsExperience,
    capacity: p.capacity,
  };
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameCerts(a: CoachCertification[], b: CoachCertification[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => c.title === b[i].title && c.issuer === b[i].issuer && c.year === b[i].year)
  );
}

function isDirty(a: FormState, b: FormState): boolean {
  return (
    a.displayName.trim() !== b.displayName.trim() ||
    a.bio !== b.bio ||
    a.acceptingClients !== b.acceptingClients ||
    a.replyWindowHours !== b.replyWindowHours ||
    a.headline.trim() !== b.headline.trim() ||
    a.yearsExperience !== b.yearsExperience ||
    a.capacity !== b.capacity ||
    !sameStrings(a.specialties, b.specialties) ||
    !sameStrings(a.achievements, b.achievements) ||
    !sameCerts(a.certifications, b.certifications)
  );
}

function intInRange(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

/**
 * Editor for the signed-in coach's own coach_profiles row — the whole
 * member-visible card, not just the basics: photo, seniority tier, display
 * name, headline, bio, availability, reply window, years of experience, roster
 * capacity, specialties, achievements and certifications.
 *
 * One save flow: everything in FormState PATCHes /api/coach/profile together
 * and the response re-seeds the baseline (the server masks PII on write, so the
 * saved value can differ from what was typed — trusting the response keeps the
 * form from looking dirty right after a successful save). The photo and the
 * tier request act on their own, immediately, exactly like the mobile screen.
 *
 * The console guards this route server-side; the API re-guards + audits.
 */
export function ProfileForm({
  initial,
  email,
}: {
  initial: CoachProfile;
  email: string;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState<FormState>(() => toForm(initial));
  const [form, setForm] = useState<FormState>(() => toForm(initial));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Draft state for the list editors — entries join the form only once added.
  const [achievementDraft, setAchievementDraft] = useState('');
  const [certDraft, setCertDraft] = useState({ title: '', issuer: '', year: '' });
  const [specialtyNote, setSpecialtyNote] = useState(false);

  const dirty = useMemo(() => isDirty(form, baseline), [form, baseline]);

  const replyValid = intInRange(form.replyWindowHours, MIN_REPLY_HOURS, MAX_REPLY_HOURS);
  const yearsValid = intInRange(form.yearsExperience, MIN_YEARS, MAX_YEARS);
  const capacityValid = intInRange(form.capacity, MIN_CAPACITY, MAX_CAPACITY);
  const bioValid = form.bio.length <= MAX_BIO;
  const canSave = dirty && replyValid && yearsValid && capacityValid && bioValid && !saving;

  function patch(next: Partial<FormState>): void {
    setSavedAt(null);
    setError(null);
    setForm((f) => ({ ...f, ...next }));
  }

  /** Toggle a specialty chip; taps past the cap are ignored with a note. */
  function toggleSpecialty(s: string): void {
    if (form.specialties.includes(s)) {
      setSpecialtyNote(false);
      patch({ specialties: form.specialties.filter((v) => v !== s) });
    } else if (form.specialties.length >= MAX_SPECIALTIES) {
      setSpecialtyNote(true);
    } else {
      setSpecialtyNote(false);
      patch({ specialties: [...form.specialties, s] });
    }
  }

  function addAchievement(): void {
    const text = achievementDraft.trim().slice(0, MAX_ACHIEVEMENT_LEN);
    if (!text || form.achievements.length >= MAX_ACHIEVEMENTS) return;
    patch({ achievements: [...form.achievements, text] });
    setAchievementDraft('');
  }

  /** Year is optional; when given it must be plausible — mirrors the server. */
  function certYear(): { valid: boolean; year: number | null } {
    const text = certDraft.year.trim();
    if (!text) return { valid: true, year: null };
    const year = Number.parseInt(text, 10);
    if (!Number.isInteger(year) || year < MIN_CERT_YEAR || year > MAX_CERT_YEAR) {
      return { valid: false, year: null };
    }
    return { valid: true, year };
  }

  function addCertification(): void {
    if (form.certifications.length >= MAX_CERTS) return;
    const title = certDraft.title.trim();
    const { valid, year } = certYear();
    if (!title || !valid) return;
    patch({
      certifications: [
        ...form.certifications,
        { title, issuer: certDraft.issuer.trim(), year },
      ],
    });
    setCertDraft({ title: '', issuer: '', year: '' });
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/coach/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          bio: form.bio,
          acceptingClients: form.acceptingClients,
          replyWindowHours: form.replyWindowHours,
          headline: form.headline.trim(),
          specialties: form.specialties,
          certifications: form.certifications,
          achievements: form.achievements,
          yearsExperience: form.yearsExperience,
          capacity: form.capacity,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(saveErrorMessage(data?.error, res.status));
        return;
      }
      // The server masks contact details on write, so the saved row is the only
      // trustworthy baseline — re-seed from it rather than from what was typed.
      const data = (await res.json().catch(() => null)) as { profile?: CoachProfile } | null;
      if (data?.profile) {
        const fresh = toForm(data.profile);
        setBaseline(fresh);
        setForm(fresh);
        setAvatarUrl(data.profile.avatarUrl);
      } else {
        setBaseline(form);
      }
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const certYearState = certYear();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PhotoCard
        avatarUrl={avatarUrl}
        onChange={(next) => {
          setAvatarUrl(next);
          router.refresh();
        }}
      />

      <TierCard coachTier={initial.coachTier} />

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <TextField
            label="Display name"
            value={form.displayName}
            maxLength={80}
            placeholder="e.g. Coach Priya"
            onChange={(e) => patch({ displayName: e.target.value })}
            hint="Shown on your public coach card. Leave blank to fall back to your account name."
          />

          <TextField
            label="Headline"
            value={form.headline}
            maxLength={MAX_HEADLINE}
            placeholder="e.g. Strength coach for busy lifters"
            onChange={(e) => patch({ headline: e.target.value })}
            hint="One line members read first, under your name."
          />

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <FieldLabel>Bio</FieldLabel>
            <textarea
              className="gt-input"
              value={form.bio}
              rows={5}
              maxLength={MAX_BIO}
              placeholder="Tell members about your coaching style, specialties, and background."
              onChange={(e) => patch({ bio: e.target.value })}
              style={{ resize: 'vertical', minHeight: 96, lineHeight: 1.5 }}
            />
            <span
              className="gt-numeric"
              style={{
                fontSize: 12,
                color: bioValid ? 'var(--gt-text-dim)' : DANGER,
                alignSelf: 'flex-end',
              }}
            >
              {form.bio.length} / {MAX_BIO}
            </span>
          </label>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                Accepting new clients
              </div>
              <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 2 }}>
                Turn off to stop appearing as available for new assignments.
              </div>
            </div>
            <Toggle
              checked={form.acceptingClients}
              onChange={(next) => patch({ acceptingClients: next })}
              label="Accepting new clients"
            />
          </div>

          <div
            style={{
              borderTop: '1px solid var(--gt-border)',
              paddingTop: 18,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <TextField
              label="Reply window (hours)"
              type="number"
              inputMode="numeric"
              min={MIN_REPLY_HOURS}
              max={MAX_REPLY_HOURS}
              value={Number.isNaN(form.replyWindowHours) ? '' : String(form.replyWindowHours)}
              onChange={(e) =>
                patch({ replyWindowHours: Number.parseInt(e.target.value, 10) })
              }
              style={{ maxWidth: 160 }}
              hint={
                replyValid ? (
                  'The response time clients can expect from you.'
                ) : (
                  <span style={{ color: DANGER }}>
                    Enter a whole number between {MIN_REPLY_HOURS} and {MAX_REPLY_HOURS}.
                  </span>
                )
              }
            />

            <TextField
              label="Years coaching"
              type="number"
              inputMode="numeric"
              min={MIN_YEARS}
              max={MAX_YEARS}
              value={Number.isNaN(form.yearsExperience) ? '' : String(form.yearsExperience)}
              onChange={(e) =>
                patch({ yearsExperience: Number.parseInt(e.target.value, 10) })
              }
              style={{ maxWidth: 160 }}
              hint={
                yearsValid ? (
                  'Shown on your coach card.'
                ) : (
                  <span style={{ color: DANGER }}>
                    Enter a whole number between {MIN_YEARS} and {MAX_YEARS}.
                  </span>
                )
              }
            />

            <TextField
              label="Roster capacity"
              type="number"
              inputMode="numeric"
              min={MIN_CAPACITY}
              max={MAX_CAPACITY}
              value={Number.isNaN(form.capacity) ? '' : String(form.capacity)}
              onChange={(e) => patch({ capacity: Number.parseInt(e.target.value, 10) })}
              style={{ maxWidth: 160 }}
              hint={
                capacityValid ? (
                  'The most active clients you can take on at once.'
                ) : (
                  <span style={{ color: DANGER }}>
                    Enter a whole number between {MIN_CAPACITY} and {MAX_CAPACITY}.
                  </span>
                )
              }
            />
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FieldLabel>Specialties</FieldLabel>
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Pick up to {MAX_SPECIALTIES}. Members filter coaches by these.
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {COACH_SPECIALTIES.map((s) => {
              const on = form.specialties.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSpecialty(s)}
                  style={{
                    appearance: 'none',
                    cursor: 'pointer',
                    minHeight: 36,
                    padding: '7px 14px',
                    borderRadius: 999,
                    fontSize: 13,
                    fontFamily: 'var(--font-heading)',
                    fontWeight: 600,
                    background: on ? 'var(--gt-accent-weak)' : 'var(--gt-surface)',
                    color: on ? 'var(--gt-accent-strong)' : 'var(--gt-text-dim)',
                    border: `1px solid ${
                      on
                        ? 'color-mix(in srgb, var(--gt-accent) 38%, transparent)'
                        : 'var(--gt-border-strong)'
                    }`,
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
          {specialtyNote ? (
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              That&apos;s the limit of {MAX_SPECIALTIES}. Unpick one to swap it.
            </span>
          ) : null}
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldLabel>Achievements</FieldLabel>
          {form.achievements.length === 0 ? (
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              Results worth showing off: competition places, client wins, milestones.
            </span>
          ) : null}
          {form.achievements.map((a, i) => (
            <ListRow
              key={`${i}-${a}`}
              removeLabel={`Remove achievement: ${a}`}
              onRemove={() =>
                patch({ achievements: form.achievements.filter((_, n) => n !== i) })
              }
            >
              <span style={{ fontSize: 14 }}>{a}</span>
            </ListRow>
          ))}
          {form.achievements.length < MAX_ACHIEVEMENTS ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <TextField
                  label="Add an achievement"
                  value={achievementDraft}
                  maxLength={MAX_ACHIEVEMENT_LEN}
                  placeholder="e.g. Coached 3 national qualifiers"
                  onChange={(e) => setAchievementDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addAchievement();
                    }
                  }}
                />
              </div>
              <Button size="sm" onClick={addAchievement} disabled={!achievementDraft.trim()}>
                Add
              </Button>
            </div>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              Max {MAX_ACHIEVEMENTS} achievements. Remove one to add another.
            </span>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldLabel>Certifications</FieldLabel>
          {form.certifications.map((c, i) => (
            <ListRow
              key={`${i}-${c.title}`}
              removeLabel={`Remove certification: ${c.title}`}
              onRemove={() =>
                patch({ certifications: form.certifications.filter((_, n) => n !== i) })
              }
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</span>
              {c.issuer || c.year !== null ? (
                <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
                  {[c.issuer, c.year !== null ? String(c.year) : ''].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </ListRow>
          ))}
          {form.certifications.length < MAX_CERTS ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <TextField
                    label="Certification"
                    value={certDraft.title}
                    maxLength={MAX_CERT_FIELD}
                    placeholder="e.g. CSCS"
                    onChange={(e) => setCertDraft((d) => ({ ...d, title: e.target.value }))}
                  />
                </div>
                <div style={{ flex: 2, minWidth: 160 }}>
                  <TextField
                    label="Issuer"
                    value={certDraft.issuer}
                    maxLength={MAX_CERT_FIELD}
                    placeholder="e.g. NSCA"
                    onChange={(e) => setCertDraft((d) => ({ ...d, issuer: e.target.value }))}
                  />
                </div>
                <div style={{ width: 110 }}>
                  <TextField
                    label="Year"
                    inputMode="numeric"
                    value={certDraft.year}
                    maxLength={4}
                    placeholder="2021"
                    onChange={(e) =>
                      setCertDraft((d) => ({
                        ...d,
                        year: e.target.value.replace(/[^0-9]/g, '').slice(0, 4),
                      }))
                    }
                  />
                </div>
              </div>
              {!certYearState.valid ? (
                <span style={{ fontSize: 13, color: DANGER }}>
                  Year must be between {MIN_CERT_YEAR} and {MAX_CERT_YEAR}.
                </span>
              ) : null}
              <div>
                <Button
                  size="sm"
                  onClick={addCertification}
                  disabled={!certDraft.title.trim() || !certYearState.valid}
                >
                  Add certification
                </Button>
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              Max {MAX_CERTS} certifications. Remove one to add another.
            </span>
          )}
        </div>
      </Card>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          position: 'sticky',
          bottom: 0,
          background: 'var(--gt-bg)',
          padding: '12px 0',
        }}
      >
        <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {error ? (
          <span style={{ fontSize: 13, color: DANGER }} role="alert">
            {error}
          </span>
        ) : dirty ? (
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Unsaved changes</span>
        ) : savedAt ? (
          <span style={{ fontSize: 13, color: 'var(--gt-success)' }}>Saved</span>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Signed in as {email}
          </span>
        )}
      </div>
    </div>
  );
}

/** Small uppercase caption matching TextField's label treatment. */
function FieldLabel({ children }: { children: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        color: 'var(--gt-text-dim)',
        fontFamily: 'var(--font-heading)',
      }}
    >
      {children}
    </span>
  );
}

/** One removable entry in the achievements / certifications editors. */
function ListRow({
  children,
  removeLabel,
  onRemove,
}: {
  children: ReactNode;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid var(--gt-border)',
        minHeight: 48,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </div>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        style={{
          appearance: 'none',
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: 8,
          border: '1px solid var(--gt-border)',
          background: 'transparent',
          color: 'var(--gt-text-dim)',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Profile photo. Reserves an upload slot (/api/uploads/image, kind
 * 'coach_avatar'), pushes the bytes straight to the image host, then PATCHes
 * avatarUrl — saving immediately, independent of the Save button, exactly like
 * the mobile screen. Removing PATCHes avatarUrl: null.
 */
function PhotoCard({
  avatarUrl,
  onChange,
}: {
  avatarUrl: string | null;
  onChange: (next: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patchAvatar(next: string | null): Promise<boolean> {
    const res = await fetch('/api/coach/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatarUrl: next }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(
        data?.error === 'avatarUrl_invalid'
          ? 'That photo could not be attached. Try uploading it again.'
          : res.status === 403
            ? 'Your account cannot change the coach photo.'
            : 'Could not update your photo. Try again.',
      );
      return false;
    }
    return true;
  }

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_PHOTO_BYTES) {
      setError('That photo is too large. Pick one under 10 MB.');
      return;
    }
    setBusy(true);
    try {
      const reserveRes = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kind: 'coach_avatar' }),
      });
      if (!reserveRes.ok) {
        setError(
          reserveRes.status === 503
            ? 'Photo uploads are not set up yet.'
            : reserveRes.status === 403
              ? 'Your account cannot upload a coach photo.'
              : reserveRes.status === 429
                ? 'Too many uploads just now. Try again in a little while.'
                : 'Could not start the photo upload. Try again.',
        );
        return;
      }
      const reservation = (await reserveRes.json()) as {
        uploadUrl: string;
        fields: Record<string, string>;
        deliveryUrl?: string;
      };
      if (!reservation.deliveryUrl) {
        setError('Photo uploads are not fully set up yet. Ask an admin to finish enabling them.');
        return;
      }
      const fd = new FormData();
      for (const [k, v] of Object.entries(reservation.fields)) fd.append(k, v);
      fd.append('file', file);
      const cloudRes = await fetch(reservation.uploadUrl, { method: 'POST', body: fd });
      if (!cloudRes.ok) {
        setError('Photo upload failed. Try again.');
        return;
      }
      if (await patchAvatar(reservation.deliveryUrl)) onChange(reservation.deliveryUrl);
    } catch {
      setError('Could not reach us just now, so the photo did not upload. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!avatarUrl || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await patchAvatar(null)) onChange(null);
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote image host, no loader configured
          <img
            src={avatarUrl}
            alt="Your coach photo"
            width={72}
            height={72}
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              objectFit: 'cover',
              flexShrink: 0,
              background: 'var(--gt-bg)',
            }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: 72,
              height: 72,
              flexShrink: 0,
              borderRadius: '50%',
              background: 'var(--gt-bg)',
              border: '1px solid var(--gt-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--gt-text-dim)',
              fontSize: 22,
            }}
          >
            ☺
          </div>
        )}

        <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Working…' : avatarUrl ? 'Change photo' : 'Add photo'}
            </Button>
            {avatarUrl ? (
              <Button size="sm" disabled={busy} onClick={() => void remove()}>
                Remove photo
              </Button>
            ) : null}
          </div>
          {error ? (
            <span style={{ fontSize: 13, color: DANGER }} role="alert">
              {error}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
              Members see this on your coach card. Saves as soon as it uploads.
            </span>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear first so re-picking the same file still fires onChange.
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
    </Card>
  );
}

interface TierRequest {
  id: string;
  requestedTier: CoachTier;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt: string | null;
  createdAt: string;
}

/**
 * Seniority tier + the upgrade-request form (GET/POST /api/coach/tier-requests).
 * A badge, not money — an admin reviews every request and only one may be
 * pending at a time, which is exactly what the 409 from the route means.
 *
 * The route is coach-role only, so a top admin browsing this console gets a 403
 * on the history read; that collapses the card to the current tier rather than
 * showing an error for something they were never meant to use.
 */
function TierCard({ coachTier }: { coachTier: CoachTier }) {
  const [requests, setRequests] = useState<TierRequest[]>([]);
  const [available, setAvailable] = useState(true);
  const [choice, setChoice] = useState<CoachTier | null>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => upgradeTargetsFor(coachTier), [coachTier]);
  const pending = requests.find((r) => r.status === 'pending') ?? null;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/coach/tier-requests', {
        headers: { Accept: 'application/json' },
      });
      if (res.status === 403) {
        setAvailable(false);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { requests: TierRequest[] };
      setRequests(data.requests);
    } catch {
      // History is a convenience — a load failure just leaves the form usable.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/coach/tier-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedTier: choice,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (data?.error === 'already_pending') {
          setError('You already have a request waiting for review.');
          void load();
        } else if (data?.error === 'not_an_upgrade') {
          setError('That tier is not higher than the one you have now.');
        } else if (res.status === 403) {
          setError('Only coach accounts can request a tier.');
        } else {
          setError('Could not send that request. Try again.');
        }
        return;
      }
      const data = (await res.json()) as { id: string };
      setRequests((prev) => [
        {
          id: data.id,
          requestedTier: choice,
          note: note.trim(),
          status: 'pending',
          decidedAt: null,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setOpen(false);
      setNote('');
    } catch {
      setError('Could not reach us just now. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              Coach tier
              <Badge tone={coachTier === 'elite' ? 'positive' : 'info'}>
                {tierLabel(coachTier)}
              </Badge>
            </div>
            <div style={{ fontSize: 13, color: 'var(--gt-text-dim)', marginTop: 2 }}>
              Your standing with us. An admin reviews every upgrade request.
            </div>
          </div>

          {available && options.length > 0 && !pending && !open ? (
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                setChoice(options[0] ?? null);
                setOpen(true);
              }}
            >
              Request an upgrade
            </Button>
          ) : null}
        </div>

        {pending ? (
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Your {tierLabel(pending.requestedTier)} request is waiting for review. You can have
            one request open at a time.
          </div>
        ) : null}

        {available && options.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            You are at the highest tier.
          </div>
        ) : null}

        {open && !pending ? (
          <div
            style={{
              borderTop: '1px solid var(--gt-border)',
              paddingTop: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FieldLabel>Tier you want</FieldLabel>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {options.map((t) => {
                  const on = choice === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setChoice(t)}
                      style={{
                        appearance: 'none',
                        cursor: 'pointer',
                        minHeight: 36,
                        padding: '7px 16px',
                        borderRadius: 999,
                        fontSize: 13,
                        fontFamily: 'var(--font-heading)',
                        fontWeight: 600,
                        background: on ? 'var(--gt-accent-weak)' : 'var(--gt-surface)',
                        color: on ? 'var(--gt-accent-strong)' : 'var(--gt-text-dim)',
                        border: `1px solid ${
                          on
                            ? 'color-mix(in srgb, var(--gt-accent) 38%, transparent)'
                            : 'var(--gt-border-strong)'
                        }`,
                      }}
                    >
                      {tierLabel(t)}
                    </button>
                  );
                })}
              </div>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <FieldLabel>Why (optional)</FieldLabel>
              <textarea
                className="gt-input"
                value={note}
                rows={3}
                maxLength={MAX_UPGRADE_NOTE}
                placeholder="Anything that helps the review: results, client load, certifications."
                onChange={(e) => setNote(e.target.value)}
                style={{ resize: 'vertical', minHeight: 72, lineHeight: 1.5 }}
              />
            </label>

            {error ? (
              <span style={{ fontSize: 13, color: DANGER }} role="alert">
                {error}
              </span>
            ) : null}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                size="sm"
                disabled={!choice || busy}
                onClick={() => void submit()}
              >
                {busy ? 'Sending…' : 'Send request'}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {!open && error ? (
          <span style={{ fontSize: 13, color: DANGER }} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * Accessible on/off switch styled on the design tokens. Uses --gt-red for the
 * "on" track (an intentional primary-state affordance), hairline for "off". No
 * glow, no animation beyond a short color/transform transition.
 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 46,
        height: 26,
        flexShrink: 0,
        borderRadius: 999,
        border: '1px solid var(--gt-border)',
        background: checked ? 'var(--gt-red)' : 'transparent',
        cursor: 'pointer',
        padding: 0,
        transition: 'background 120ms',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: checked ? '#fff' : 'var(--gt-text-dim)',
          transition: 'left 120ms, background 120ms',
        }}
      />
    </button>
  );
}
