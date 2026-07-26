'use client';

/**
 * Home closing — the dark cinematic CTA band: full-bleed barbell photo with a
 * slow scroll parallax and a masked headline.
 *
 * There is no testimonials section here on purpose: we don't have real,
 * attributable member quotes yet, and made-up ones are not an option. When
 * members give us quotes we can name, this is where they go.
 */
import { motion, useScroll, useTransform } from 'motion/react';
import Image from 'next/image';
import { useRef } from 'react';
import { Magnetic, Reveal, WordStagger } from '../motion';
import { Container, Eyebrow, PillLink } from '../ui';

export function CtaBand() {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  // Slow photo drift — the band feels alive without distracting from the CTA.
  const photoY = useTransform(scrollYProgress, [0, 1], ['-8%', '8%']);

  return (
    <section ref={ref} className="mkt-noise relative overflow-hidden bg-ink">
      <motion.div style={{ y: photoY }} className="absolute inset-[-10%]">
        {/* Last band on the page, so it stays lazy: the browser fetches it as
            the reader approaches, not while the hero is still loading. */}
        <Image
          src="/stock/hero-barbell.jpg"
          alt=""
          fill
          sizes="120vw"
          className="object-cover"
        />
      </motion.div>
      <div className="absolute inset-0 bg-black/72" />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(52% 60% at 50% 100%, rgb(255 59 48 / 0.22), transparent 70%)',
        }}
      />
      <Container className="relative py-32 text-center sm:py-40">
        <Reveal>
          <Eyebrow tone="dark" className="justify-center text-center !text-snow/60">
            No ads · No selling your data · Cancel anytime
          </Eyebrow>
        </Reveal>
        <h2 className="mx-auto mt-5 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
          <WordStagger text="Start" className="mkt-text-steel" />
          <WordStagger text="tonight." className="mkt-text-ember" delay={180} />
        </h2>
        <Reveal delay={260}>
          <p className="mx-auto mt-6 max-w-md text-[17px] leading-relaxed text-snow/80">
            Download the app, pick a plan, and log your first workout before the motivation
            wears off.
          </p>
        </Reveal>
        <Reveal delay={360} className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Magnetic>
            <PillLink href="/download">Get the app</PillLink>
          </Magnetic>
          <Magnetic strength={0.22}>
            <PillLink href="/contact" variant="ghost">
              Talk to us
            </PillLink>
          </Magnetic>
        </Reveal>
      </Container>
    </section>
  );
}
