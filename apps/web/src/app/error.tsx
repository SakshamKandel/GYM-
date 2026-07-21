'use client';

/**
 * Route error boundary — standalone full-screen "Iron & Ember" mood (a calmer
 * sibling to the animated 404): near-black canvas, red aurora + film grain,
 * giant Oswald statement, and a retry wired to Next.js's reset().
 */
import Link from 'next/link';
import { useEffect } from 'react';
import { Reveal } from '@/components/marketing/motion';
import { ArrowLink, Display, Lead, LogoMark, PillLink, Wordmark } from '@/components/marketing/ui';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Web route failed', {
      digest: error.digest,
      message: error.message,
    });
  }, [error]);

  return (
    <div className="mkt mkt-noise mkt-aurora relative flex min-h-screen flex-col overflow-hidden bg-ink font-sans text-snow">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: 'radial-gradient(58% 100% at 50% 100%, rgb(255 59 48 / 0.12), transparent 72%)',
        }}
      />

      {/* Minimal chrome — mark home, no full nav */}
      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Home">
          <LogoMark size={42} />
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-16">
        <div className="mx-auto max-w-[760px] text-center">
          <Reveal delay={100}>
            <Display as="h1" size="xl" className="mt-7">
              <span className="mkt-text-steel">Something</span>
              <br />
              <span className="mkt-text-ember">tore.</span>
            </Display>
          </Reveal>
          <Reveal delay={180}>
            <Lead className="mx-auto mt-7">
              Your data wasn&rsquo;t changed. Try the request again, or head back home if the issue
              sticks around.
            </Lead>
          </Reveal>
          <Reveal delay={260} className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="mkt-shine inline-flex h-14 items-center justify-center gap-2 rounded-full bg-red px-8 font-sans text-[15px] font-semibold text-ink shadow-ember transition-all duration-200 hover:bg-red-glow hover:shadow-ember-lg active:scale-[0.97]"
            >
              Try again
            </button>
            <PillLink href="/" variant="ghost">
              Return home
            </PillLink>
          </Reveal>
          <Reveal delay={340} className="mt-8">
            <ArrowLink href="/contact" className="text-dim">
              Still stuck? Get support
            </ArrowLink>
          </Reveal>
        </div>
      </main>
    </div>
  );
}
