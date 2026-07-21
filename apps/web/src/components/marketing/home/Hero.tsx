'use client';

/**
 * Home hero v3 — dark cinematic opener: ember aurora over near-black,
 * blueprint grid, word-by-word headline reveal, magnetic CTAs, and an
 * interactive mobile phone replica with live tab switching matching the Expo mobile app.
 */
import { motion, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef, useState } from 'react';
import { InteractivePhone } from '../InteractivePhone';
import { CountUp, Float, Magnetic, Reveal, WordStagger } from '../motion';
import { type TabName } from '../screens/appkit';
import { Container, PillLink } from '../ui';

const STATS = [
  { value: 100, prefix: '', suffix: '%', caption: 'instant offline logging' },
  { value: 650, prefix: '', suffix: '+', caption: 'exercises in library' },
  { value: 17, prefix: '', suffix: '', caption: 'muscle zones in 3D anatomy' },
  { value: 2, prefix: '', suffix: '', caption: 'regional pricing · Nepal & Global' },
] as const;

const HERO_TABS: readonly { id: TabName; label: string }[] = [
  { id: 'home', label: 'Today' },
  { id: 'train', label: 'Train' },
  { id: 'food', label: 'Food' },
  { id: 'meals', label: 'Meals' },
  { id: 'gyms', label: 'Gyms' },
  { id: 'progress', label: 'Progress' },
] as const;

export function HomeHero() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabName>('home');

  const { scrollYProgress } = useScroll({
    target: stageRef,
    offset: ['start start', 'end start'],
  });
  // The phone drifts up + straightens as the hero scrolls away.
  const phoneY = useSpring(useTransform(scrollYProgress, [0, 1], [0, -110]), {
    stiffness: 80,
    damping: 22,
  });
  const phoneRotate = useSpring(useTransform(scrollYProgress, [0, 1], [0, -4]), {
    stiffness: 80,
    damping: 22,
  });
  const glowOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  return (
    <div ref={stageRef} className="mkt-noise mkt-aurora relative overflow-hidden bg-ink pt-[128px] sm:pt-[150px]">
      <div aria-hidden className="mkt-gridlines absolute inset-0" />

      <Container wide className="relative z-10">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h1 className="font-display text-[15vw] font-medium uppercase leading-[0.92] sm:text-7xl md:text-8xl">
              <WordStagger text="Every rep." className="mkt-text-steel block" />
              <WordStagger text="Every meal." className="mkt-text-steel block" />
              <WordStagger text="One app." className="mkt-text-ember block" />
            </h1>

            <Reveal delay={700}>
              <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim">
                Workouts, food, healthy meal delivery, gym discovery and real human coaching —
                in one calm, offline-first app. Log workouts instantly with no waiting, even
                with no signal in the basement gym.
              </p>
            </Reveal>

            {/* Interactive Tab Selector Chips */}
            <Reveal delay={780} className="mt-7 flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-wider text-dim w-full block mb-1">
                Explore Mobile App Tabs:
              </span>
              {HERO_TABS.map((t) => {
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition-all duration-200 ${
                      isActive
                        ? 'bg-red text-ink shadow-ember scale-105'
                        : 'bg-charcoal border border-line-strong text-dim hover:text-snow hover:bg-charcoal-2'
                    }`}
                  >
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </Reveal>

            <Reveal delay={840} className="mt-9 flex flex-wrap items-center gap-4">
              <Magnetic>
                <PillLink href="/download">Get the app</PillLink>
              </Magnetic>
              <Magnetic strength={0.22}>
                <PillLink href="/pricing" variant="ghost">
                  See pricing
                </PillLink>
              </Magnetic>
            </Reveal>

            <Reveal delay={920}>
              <p className="mt-8 font-sans text-[13px] text-faint">
                iOS · Android · Offline-first · No ads, ever
              </p>
            </Reveal>
          </div>

          <Reveal delay={420} y={40} className="flex justify-center lg:justify-end lg:pr-10">
            <motion.div style={{ y: phoneY, rotate: phoneRotate }}>
              <motion.div style={{ opacity: glowOpacity }}>
                <Float amplitude={10} duration={7}>
                  <InteractivePhone
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    tilt="right"
                    scale={0.94}
                    priority
                  />
                </Float>
              </motion.div>
            </motion.div>
          </Reveal>
        </div>

        {/* Stat band */}
        <div className="mkt-divider mt-24" />
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 py-14 md:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.caption} delay={i * 90}>
              <div className="mkt-text-steel font-display text-5xl font-medium sm:text-6xl">
                <CountUp to={s.value} prefix={s.prefix} suffix={s.suffix} />
              </div>
              <p className="mt-2.5 font-sans text-[13px] text-dim">
                {s.caption}
              </p>
            </Reveal>
          ))}
        </div>
      </Container>
    </div>
  );
}
