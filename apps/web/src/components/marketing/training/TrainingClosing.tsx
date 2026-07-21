'use client';

/**
 * /training closing run v3: photo interlude on paper-2, "keep exploring"
 * cross-links on paper, and the dark cinematic CTA band — full-bleed pull-up
 * photo with a slow scroll parallax, scrim, and a masked headline.
 */
import { motion, useScroll, useTransform } from 'motion/react';
import Link from 'next/link';
import { useRef } from 'react';
import { Magnetic, Parallax, Reveal, Stagger, StaggerItem, WordStagger } from '../motion';
import { Container, Display, Eyebrow, PhotoBlock, PillLink, Section } from '../ui';

export function TrainingPhotoInterlude() {
  return (
    <Section tone="paper-2" pad="py-20 sm:py-24">
      <Container wide>
        <Reveal>
          <Parallax range={40}>
            <PhotoBlock
              src="/stock/deadlift-dark.jpg"
              alt="Lifter setting up for a heavy deadlift in a dark gym"
              caption="Set 4 · 80 kg on the bar · rest starts itself"
              className="aspect-[4/3] w-full sm:aspect-[16/7]"
            />
          </Parallax>
        </Reveal>
      </Container>
    </Section>
  );
}

const LINKS = [
  {
    n: '01',
    title: 'Food',
    href: '/nutrition',
    blurb: 'Macros without the math — barcode scans, Nepali + global databases, water and Nutri-Score.',
  },
  {
    n: '02',
    title: 'Progress',
    href: '/progress',
    blurb: 'Smoothed weight trends, measurements and streaks. Proof that the training is working.',
  },
  {
    n: '03',
    title: 'Pricing',
    href: '/pricing',
    blurb: 'Priced for Nepal and the world — two currencies, real coaching tiers, no ads ever.',
  },
] as const;

export function TrainingCrossLinks() {
  return (
    <Section tone="paper">
      <Container wide>
        <Reveal>
          <Eyebrow tone="light">Keep exploring</Eyebrow>
          <Display size="md" className="mt-4">
            Training is a third of the story.
          </Display>
        </Reveal>
        <Stagger className="mt-12 grid gap-4 sm:grid-cols-3" gap={0.08}>
          {LINKS.map((l) => (
            <StaggerItem key={l.n}>
              <Link
                href={l.href}
                className="mkt-card-light mkt-card-light-hover group flex min-h-[210px] flex-col justify-between rounded-block p-7"
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-[12px] tracking-[0.2em] text-gravel-faint">
                    {l.n}
                  </span>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full border border-mist text-[15px] text-gravel transition-all duration-300 group-hover:border-red group-hover:bg-red group-hover:text-ink group-hover:shadow-ember"
                  >
                    →
                  </span>
                </div>
                <div>
                  <h3 className="font-display text-2xl font-medium uppercase text-ink">
                    {l.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-gravel">{l.blurb}</p>
                </div>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </Section>
  );
}

export function TrainingCta() {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  // Slow photo drift — the band feels alive without distracting from the CTA.
  const photoY = useTransform(scrollYProgress, [0, 1], ['-8%', '8%']);

  return (
    <section ref={ref} className="mkt-noise relative overflow-hidden bg-ink">
      <motion.div style={{ y: photoY }} className="absolute inset-[-10%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/stock/pullups-bw.jpg" alt="" className="size-full object-cover" />
      </motion.div>
      <div className="absolute inset-0 bg-black/70" />
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
            Train with The GM Method
          </Eyebrow>
        </Reveal>
        <h2 className="mx-auto mt-5 font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
          <WordStagger text="Your next PR" className="mkt-text-steel block" />
          <WordStagger text="starts tonight." className="mkt-text-ember block" delay={180} />
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
            <PillLink href="/pricing" variant="ghost">
              See pricing
            </PillLink>
          </Magnetic>
        </Reveal>
        <Reveal delay={440}>
          <p className="mt-8 font-mono text-[11.5px] uppercase tracking-[0.2em] text-faint">
            iOS · Android · Offline-first · No ads
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
