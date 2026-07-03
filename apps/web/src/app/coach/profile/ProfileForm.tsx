'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, Card, TextField } from '@/components/console';

export interface CoachProfile {
  displayName: string;
  bio: string;
  acceptingClients: boolean;
  replyWindowHours: number;
  isActive: boolean;
}

const MAX_BIO = 2000;
const MIN_REPLY_HOURS = 1;
const MAX_REPLY_HOURS = 168;

/**
 * Editor for the signed-in coach's own coach_profiles row. Dirty-tracked
 * against the server-provided `initial`, PATCHes /api/coach/profile, then
 * router.refresh() so the server component re-reads the saved values. The
 * console guards this route server-side; the API re-guards + audits.
 */
export function ProfileForm({
  initial,
  email,
}: {
  initial: CoachProfile;
  email: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [bio, setBio] = useState(initial.bio);
  const [acceptingClients, setAcceptingClients] = useState(initial.acceptingClients);
  const [replyWindowHours, setReplyWindowHours] = useState(initial.replyWindowHours);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = useMemo(
    () =>
      displayName.trim() !== initial.displayName ||
      bio !== initial.bio ||
      acceptingClients !== initial.acceptingClients ||
      replyWindowHours !== initial.replyWindowHours,
    [displayName, bio, acceptingClients, replyWindowHours, initial],
  );

  const replyValid =
    Number.isInteger(replyWindowHours) &&
    replyWindowHours >= MIN_REPLY_HOURS &&
    replyWindowHours <= MAX_REPLY_HOURS;
  const bioValid = bio.length <= MAX_BIO;
  const canSave = dirty && replyValid && bioValid && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/coach/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          bio,
          acceptingClients,
          replyWindowHours,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? `Save failed (${res.status})`);
        return;
      }
      setSavedAt(Date.now());
      // Server component re-reads and re-seeds `initial`, clearing dirty.
      router.refresh();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <TextField
            label="Display name"
            value={displayName}
            maxLength={80}
            placeholder="e.g. Coach Priya"
            onChange={(e) => setDisplayName(e.target.value)}
            hint="Shown on your public coach card. Leave blank to fall back to your account name."
          />

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span
              style={{
                fontSize: 12,
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                color: 'var(--gt-text-dim)',
                fontFamily: 'var(--font-heading)',
              }}
            >
              Bio
            </span>
            <textarea
              className="gt-input"
              value={bio}
              rows={5}
              maxLength={MAX_BIO}
              placeholder="Tell clients about your coaching style, specialties, and background."
              onChange={(e) => setBio(e.target.value)}
              style={{ resize: 'vertical', minHeight: 96, lineHeight: 1.5 }}
            />
            <span
              className="gt-numeric"
              style={{
                fontSize: 12,
                color: bioValid ? 'var(--gt-text-dim)' : '#ff8178',
                alignSelf: 'flex-end',
              }}
            >
              {bio.length} / {MAX_BIO}
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
              checked={acceptingClients}
              onChange={setAcceptingClients}
              label="Accepting new clients"
            />
          </div>

          <div style={{ borderTop: '1px solid var(--gt-border)', paddingTop: 18 }}>
            <TextField
              label="Reply window (hours)"
              type="number"
              inputMode="numeric"
              min={MIN_REPLY_HOURS}
              max={MAX_REPLY_HOURS}
              value={Number.isNaN(replyWindowHours) ? '' : String(replyWindowHours)}
              onChange={(e) => setReplyWindowHours(Number.parseInt(e.target.value, 10))}
              style={{ maxWidth: 160 }}
              hint={
                replyValid ? (
                  'The response time clients can expect from you.'
                ) : (
                  <span style={{ color: '#ff8178' }}>
                    Enter a whole number between {MIN_REPLY_HOURS} and {MAX_REPLY_HOURS}.
                  </span>
                )
              }
            />
          </div>
        </div>
      </Card>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <Button variant="primary" onClick={save} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {error ? (
          <span style={{ fontSize: 13, color: '#ff8178' }}>{error}</span>
        ) : dirty ? (
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>Unsaved changes</span>
        ) : savedAt ? (
          <span style={{ fontSize: 13, color: '#4cc264' }}>Saved</span>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}>
            Signed in as {email}
          </span>
        )}
      </div>
    </div>
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
