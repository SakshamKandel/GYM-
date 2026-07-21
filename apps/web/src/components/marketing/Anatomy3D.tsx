'use client';

/**
 * The REAL app 3D anatomy viewer, embedded on the marketing site.
 *
 * /anatomy/viewer.html is the exact self-contained document the app ships
 * (Three.js + Draco + licensed Z-Anatomy derivative, zero network calls) —
 * exported by apps/mobile/scripts/anatomy/export_web_viewer.ts. This wrapper
 * lazy-mounts it when scrolled near, then drives the same postMessage bridge
 * the app uses: cycling heat-map highlights (front/back camera turns
 * included) until the visitor takes over by dragging or tapping muscles.
 */
import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from './motion';

const TOUR: { muscle: string; side: 'front' | 'back'; label: string; hint: string }[] = [
  { muscle: 'chest', side: 'front', label: 'Chest', hint: 'Pectoralis major' },
  { muscle: 'quadriceps', side: 'front', label: 'Quadriceps', hint: 'Front of thigh' },
  { muscle: 'shoulders', side: 'front', label: 'Shoulders', hint: 'Deltoids' },
  { muscle: 'abdominals', side: 'front', label: 'Abdominals', hint: 'Core wall' },
  { muscle: 'lats', side: 'back', label: 'Lats', hint: 'Latissimus dorsi' },
  { muscle: 'glutes', side: 'back', label: 'Glutes', hint: 'Gluteus maximus' },
  { muscle: 'hamstrings', side: 'back', label: 'Hamstrings', hint: 'Back of thigh' },
  { muscle: 'calves', side: 'back', label: 'Calves', hint: 'Gastrocnemius' },
];

export function Anatomy3D({ className = '' }: { className?: string }) {
  const [hostRef, near] = useInView<HTMLDivElement>('300px');
  const reduced = useReducedMotion();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [userMuscle, setUserMuscle] = useState<string | null>(null);
  const pausedUntil = useRef(0);

  // Viewer → site bridge.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (iframeRef.current && ev.source !== iframeRef.current.contentWindow) return;
      let data: unknown = ev.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      const msg = data as { type?: string; muscle?: string };
      if (msg?.type === 'ready') setReady(true);
      if (msg?.type === 'select' && msg.muscle) {
        // Visitor tapped a muscle — show it and hold the tour for a while.
        setUserMuscle(msg.muscle);
        pausedUntil.current = Date.now() + 12000;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Site → viewer: guided highlight tour.
  useEffect(() => {
    if (!ready) return;
    const post = (payload: object) =>
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify(payload), '*');

    if (reduced) {
      post({ type: 'highlight', muscle: 'quadriceps', side: 'front' });
      return;
    }
    // First stop after the intro spin.
    post({ type: 'highlight', muscle: TOUR[0].muscle, side: TOUR[0].side });
    const id = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      setUserMuscle(null);
      setTourIndex((i) => {
        const next = (i + 1) % TOUR.length;
        post({ type: 'highlight', muscle: TOUR[next].muscle, side: TOUR[next].side });
        return next;
      });
    }, 3200);
    return () => clearInterval(id);
  }, [ready, reduced]);

  const active = userMuscle
    ? { label: userMuscle[0].toUpperCase() + userMuscle.slice(1), hint: 'Tap another muscle' }
    : TOUR[tourIndex];

  return (
    <div ref={hostRef} className={`relative ${className}`}>
      <div className="mkt-glass-deep relative overflow-hidden rounded-block">
        <div className="relative aspect-[3/4] w-full sm:aspect-[4/5]">
          {near ? (
            <iframe
              ref={iframeRef}
              src="/anatomy/viewer.html"
              title="Interactive 3D muscle anatomy — drag to orbit, tap a muscle"
              className="absolute inset-0 size-full border-0"
            />
          ) : null}
          {!ready ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
                Loading 3D body…
              </span>
            </div>
          ) : null}
        </div>

        {/* Live label — mirrors the app's selection card */}
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-center justify-between rounded-[18px] bg-ink/80 px-5 py-3.5 backdrop-blur-md">
          <span>
            <span className="block text-[15px] font-bold text-snow">{active.label}</span>
            <span className="block text-[12px] text-dim">{active.hint}</span>
          </span>
          <span className="size-2.5 rounded-full bg-red shadow-ember" />
        </div>
      </div>

      <p className="mt-3 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
        <span>Drag to orbit · tap a muscle · front / back</span>
        <span>Z-Anatomy · CC BY-SA</span>
      </p>
    </div>
  );
}
