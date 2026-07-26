'use client';

/**
 * Brand Spotter Card — featuring official brand mark, premium metallic surface,
 * and high-converting copy.
 */
import Image from 'next/image';
import { Reveal } from '../motion';
import { Container, Section } from '../ui';

export function AboutMascot() {
  return (
    <Section tone="ink" pad="py-20 sm:py-24">
      <Container wide>
        <Reveal>
          <div className="rounded-[26px] bg-gradient-to-r from-charcoal to-charcoal-2 border border-line-strong/40 overflow-hidden shadow-pop">
            <div className="grid items-center gap-8 sm:grid-cols-[0.9fr_1.1fr]">
              <div className="relative flex items-center justify-center bg-black/40 p-10 min-h-[260px]">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      'radial-gradient(55% 55% at 50% 50%, rgb(255 59 48 / 0.25), transparent 75%)',
                  }}
                />
                {/* The master art is 2000 px square; this draws it at 180.
                    next/image serves a matching file instead of the original. */}
                <Image
                  src="/logo.png"
                  alt="Official Brand Logo"
                  width={180}
                  height={180}
                  sizes="180px"
                  className="relative h-[180px] w-auto object-contain drop-shadow-[0_20px_35px_rgba(255,59,48,0.3)] transition-transform duration-300 hover:scale-105"
                />
              </div>

              <div className="p-8 sm:p-12">
                <span className="font-sans text-[12px] font-bold uppercase tracking-wider text-red">
                  Built For Athletes
                </span>
                <p className="mt-3 font-display text-3xl sm:text-4xl font-bold uppercase leading-tight text-snow">
                  Your Workout Spotter.<br />
                  Every Single Rep.
                </p>
                <p className="mt-4 max-w-md text-[15px] leading-relaxed text-dim">
                  Shows up when you hit a personal record, maintain a training streak, or hit your daily macros. No ads, no clutter, just an app that keeps up with your progress.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}
