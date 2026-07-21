'use client';

/**
 * Home closing v3 — testimonials on paper, then the dark cinematic CTA band:
 * full-bleed barbell photo with a slow scroll parallax and a masked headline.
 */
import { motion, useScroll, useTransform } from 'motion/react';
import { useRef } from 'react';
import { Magnetic, Reveal, Stagger, StaggerItem, WordStagger } from '../motion';
import { Container, Display, Eyebrow, PillLink, Section } from '../ui';

const QUOTES = [
  {
    quote:
      'The rest timer starting by itself sounds tiny until you realise you never touch your phone between sets anymore.',
    name: 'Prakash',
    meta: 'Member · Lalitpur',
  },
  {
    quote:
      'My coach adjusted my plan the same evening I flagged a shoulder niggle. That’s the difference between an app and a coach.',
    name: 'Sneha',
    meta: 'Gold member · Kathmandu',
  },
  {
    quote:
      'I stopped guessing dinner. Macro-counted dal bhat shows up, I log nothing, the rings just fill.',
    name: 'Dawa',
    meta: 'Meals subscriber · Bhaktapur',
  },
] as const;

export function Testimonials() {
  return (
    <Section tone="paper" id="reviews">
      <Container wide>
        <Reveal>
          <Eyebrow tone="light">From the floor</Eyebrow>
          <Display className="mt-4">People keep showing up.</Display>
        </Reveal>
        <Stagger className="mt-14 grid gap-4 md:grid-cols-3" gap={0.1}>
          {QUOTES.map((q) => (
            <StaggerItem key={q.name}>
              <figure className="mkt-card-light mkt-card-light-hover flex min-h-[260px] flex-col justify-between rounded-block p-7">
                <div>
                  <span aria-hidden className="font-display text-5xl leading-none text-red">
                    &ldquo;
                  </span>
                  <blockquote className="mt-3 text-[16px] leading-relaxed text-ink">
                    {q.quote}
                  </blockquote>
                </div>
                <figcaption className="mt-8 flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-red font-display text-[16px] font-medium text-ink">
                    {q.name[0]}
                  </span>
                  <span>
                    <span className="block text-[14px] font-semibold text-ink">{q.name}</span>
                    <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-gravel-faint">
                      {q.meta}
                    </span>
                  </span>
                </figcaption>
              </figure>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </Section>
  );
}

export function CtaBand() {
  const ref = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  // Slow photo drift — the band feels alive without distracting from the CTA.
  const photoY = useTransform(scrollYProgress, [0, 1], ['-8%', '8%']);

  return (
    <section ref={ref} className="mkt-noise relative overflow-hidden bg-ink">
      <motion.div style={{ y: photoY }} className="absolute inset-[-10%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/stock/hero-barbell.jpg"
          alt=""
          className="size-full object-cover"
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
