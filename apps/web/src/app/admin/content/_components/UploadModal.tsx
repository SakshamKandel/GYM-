'use client';

import { type FormEvent, useRef, useState } from 'react';
import { Button, Modal, TextField } from '@/components/console';
import { type Tier, TIERS, type VideoDetail } from './types';

type Phase = 'idle' | 'creating' | 'uploading' | 'confirming';

/**
 * Modal owner of the new-video upload flow. Two guarded server round-trips plus
 * one direct upload to the configured video host (bytes never pass through our
 * API — dodges the Vercel body limit):
 *
 *   1. POST /api/admin/videos { title, description?, exerciseId?, planId?,
 *      tierRequired } → { video, upload }. Reserves a direct-creator-upload slot
 *      and inserts the row in status='processing'. `upload = { url, fields? }`.
 *   2. POST the picked file STRAIGHT to upload.url. If upload.fields is present
 *      (Cloudinary signed upload) we send multipart/form-data with those signed
 *      fields plus the `file` blob; otherwise (Cloudflare Stream one-time URL) we
 *      POST just the `file` blob.
 *   3. PATCH /api/admin/videos/[id] { status: 'ready' } to confirm.
 *
 * A 503 { error: 'video_not_configured' } on step 1 means the host keys are
 * absent — we surface that up to the parent (onNotConfigured) so it can show the
 * hosting banner instead of a generic error, and the modal closes.
 */
export function UploadModal({
  open,
  onClose,
  onUploaded,
  onNotConfigured,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (v: VideoDetail) => void;
  onNotConfigured: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [exerciseId, setExerciseId] = useState('');
  const [planId, setPlanId] = useState('');
  const [tier, setTier] = useState<Tier>('gold');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const busy = phase !== 'idle';
  const canSubmit = title.trim().length > 0 && file != null && !busy;

  function reset() {
    setTitle('');
    setDescription('');
    setExerciseId('');
    setPlanId('');
    setTier('gold');
    setFile(null);
    setError(null);
    setPhase('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function close() {
    if (busy) return; // don't abandon an in-flight upload
    reset();
    onClose();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setError(null);

    // 1. Reserve the upload slot + create the row.
    setPhase('creating');
    let video: VideoDetail;
    let upload: { url: string; fields?: Record<string, string> };
    try {
      const res = await fetch('/api/admin/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          exerciseId: exerciseId.trim() || undefined,
          planId: planId.trim() || undefined,
          tierRequired: tier,
        }),
      });
      if (res.status === 503) {
        setPhase('idle');
        onNotConfigured();
        reset();
        onClose();
        return;
      }
      if (!res.ok) {
        setError(
          res.status === 400
            ? 'Please check the form fields.'
            : 'Could not start the upload.',
        );
        setPhase('idle');
        return;
      }
      const data = (await res.json()) as {
        video: VideoDetail;
        upload: { url: string; fields?: Record<string, string> };
      };
      video = data.video;
      upload = data.upload;
    } catch {
      setError('Network error while starting the upload.');
      setPhase('idle');
      return;
    }

    // 2. Upload the file straight to the host (direct-creator-upload). Both
    //    Cloudinary and Cloudflare Stream take a multipart POST with a `file`
    //    field. For Cloudinary we also attach the signed fields the server
    //    minted; for Cloudflare's one-time URL there are none.
    setPhase('uploading');
    try {
      const form = new FormData();
      if (upload.fields) {
        for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
      }
      form.append('file', file);
      const up = await fetch(upload.url, { method: 'POST', body: form });
      if (!up.ok) {
        setError('The file upload to the video host failed.');
        setPhase('idle');
        return;
      }
      // Drain the host's JSON so the connection closes cleanly. We persist
      // nothing from it: thumbnailUrl/durationSec are owned by the server, and
      // the confirm below only flips status. Ignore parse errors — a 2xx is all
      // the confirm needs.
      await up.json().catch(() => null);
    } catch {
      setError('Network error while uploading the file.');
      setPhase('idle');
      return;
    }

    // 3. Confirm — flip the row to 'ready'.
    setPhase('confirming');
    try {
      const res = await fetch(
        `/api/admin/videos/${encodeURIComponent(video.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'ready' }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as { video: VideoDetail };
        onUploaded(data.video);
      } else {
        // The file uploaded but the confirm failed — surface it; the row is
        // still 'processing' and will show up on the next list refresh.
        onUploaded(video);
      }
    } catch {
      onUploaded(video);
    } finally {
      reset();
      onClose();
    }
  }

  const phaseLabel =
    phase === 'creating'
      ? 'Preparing…'
      : phase === 'uploading'
        ? 'Uploading…'
        : phase === 'confirming'
          ? 'Finishing…'
          : 'Upload video';

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a video"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              // Modal footer sits outside <form>, so submit programmatically.
              formRef.current?.requestSubmit();
            }}
            disabled={!canSubmit}
          >
            {phaseLabel}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={onSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="e.g. Barbell back squat — form check"
          disabled={busy}
        />

        <TextField
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          placeholder="What this video demonstrates"
          disabled={busy}
        />

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 180px' }}>
            <TextField
              label="Exercise ID (optional)"
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
              placeholder="exercise id"
              disabled={busy}
            />
          </div>
          <div style={{ flex: '1 1 180px' }}>
            <TextField
              label="Plan ID (optional)"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              placeholder="plan id"
              disabled={busy}
            />
          </div>
        </div>

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
            Required tier
          </span>
          <select
            className="gt-input"
            value={tier}
            onChange={(e) => setTier(e.target.value as Tier)}
            disabled={busy}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

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
            Video file
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            style={{ fontSize: 13, color: 'var(--gt-text-dim)' }}
          />
        </label>

        {error ? (
          <div style={{ color: 'var(--gt-danger)', fontSize: 13 }}>{error}</div>
        ) : null}
      </form>
    </Modal>
  );
}
