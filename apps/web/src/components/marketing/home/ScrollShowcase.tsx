'use client';

/**
 * Scroll showcase — centerpiece of the landing page.
 * A sticky, rock-solid mobile phone on the left stays fixed while feature steps
 * scroll on the right. As each step scrolls into view, the phone automatically updates
 * its active tab screen with smooth crossfades.
 */
import { motion, useInView } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { InteractivePhone } from '../InteractivePhone';
import { Reveal } from '../motion';
import { type TabName } from '../screens/appkit';
import { ArrowLink, Container, Display, Lead, Section } from '../ui';

const STEPS: {
  id: string;
  tab: TabName;
  stepNum: string;
  title: string;
  copy: string;
  href: string;
  link: string;
}[] = [
  {
    id: 'train',
    tab: 'train',
    stepNum: '01',
    title: 'Gym mode carries the session.',
    copy: 'A rest timer that starts itself, plate math done for you, last session’s numbers where you need them. You lift — the app keeps up.',
    href: '/training',
    link: 'Explore training',
  },
  {
    id: 'food',
    tab: 'food',
    stepNum: '02',
    title: 'Dinner logs itself, almost.',
    copy: 'Scan a barcode or search dal bhat — Nepali kitchens and global databases alike. Macros, water and Nutri-Score without the spreadsheet feeling.',
    href: '/nutrition',
    link: 'Explore food',
  },
  {
    id: 'meals',
    tab: 'meals',
    stepNum: '03',
    title: 'Protein shows up at the door.',
    copy: 'Macro-counted meals from vetted Kathmandu kitchens, tracked live through seven order states — and logged to your diary automatically.',
    href: '/meals',
    link: 'Explore meals',
  },
  {
    id: 'gyms',
    tab: 'gyms',
    stepNum: '04',
    title: 'Find verified gyms near you.',
    copy: 'Discover nearby gym hubs in Kathmandu valley. Check photos, working hours, day-pass rates, and location directions.',
    href: '/gyms',
    link: 'Explore gyms',
  },
  {
    id: 'progress',
    tab: 'progress',
    stepNum: '05',
    title: 'Exponential weight trend curve.',
    copy: 'Daily bodyweight fluctuates — EWMA trend smoothing filters out water noise to give you a true progress velocity curve.',
    href: '/progress',
    link: 'Explore progress',
  },
] as const;

function StepItem({
  index,
  active,
  onActive,
  step,
}: {
  index: number;
  active: boolean;
  onActive: (index: number) => void;
  step: (typeof STEPS)[number];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Trigger active state when 35% of the step is visible in viewport
  const isInView = useInView(ref, { amount: 0.35 });

  useEffect(() => {
    if (isInView) {
      onActive(index);
    }
  }, [isInView, index, onActive]);

  return (
    <motion.div
      ref={ref}
      animate={{ opacity: active ? 1 : 0.3, scale: active ? 1 : 0.98 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex min-h-[60vh] flex-col justify-center py-8"
    >
      <p className="font-display text-5xl font-medium text-mist-strong sm:text-7xl">
        {step.stepNum}
      </p>
      <h3 className="mt-4 font-display text-3xl font-medium uppercase leading-tight text-ink sm:text-5xl">
        {step.title}
      </h3>
      <p className="mt-4 max-w-md text-[16px] leading-relaxed text-gravel">{step.copy}</p>
      <ArrowLink href={step.href} className="mt-6 text-red-deep">
        {step.link}
      </ArrowLink>
    </motion.div>
  );
}

export function ScrollShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <Section tone="paper" pad="py-24 sm:py-32" overflowHidden={false}>
      <Container wide>
        <Reveal className="max-w-3xl">
          <Display size="lg">One app. Every session, meal and milestone.</Display>
          <Lead tone="light" className="mt-6">
            Scroll through a day with the GM Method — the phone keeps up with you.
          </Lead>
        </Reveal>

        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-2 lg:items-start lg:gap-16">
          {/* STABLE STICKY MOBILE PHONE STAGE */}
          <div className="lg:sticky lg:top-28 z-20 flex justify-center self-start">
            <div className="relative">
              <InteractivePhone
                activeTab={STEPS[activeIndex].tab}
                onTabChange={(tab) => {
                  const idx = STEPS.findIndex((s) => s.tab === tab);
                  if (idx !== -1) setActiveIndex(idx);
                }}
                tilt="none"
                scale={0.88}
              />

              {/* Step indicator dots */}
              <div className="absolute -right-14 top-1/2 hidden -translate-y-1/2 flex-col gap-3 lg:flex">
                {STEPS.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    title={s.title}
                    className={`h-9 w-1.5 rounded-full transition-all duration-300 ${
                      i === activeIndex
                        ? 'bg-red shadow-ember scale-110'
                        : 'bg-mist-strong hover:bg-gravel'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* SCROLLING RIGHT-SIDE DETAILS */}
          <div className="flex flex-col">
            {STEPS.map((s, i) => (
              <StepItem
                key={s.id}
                index={i}
                active={activeIndex === i}
                onActive={setActiveIndex}
                step={s}
              />
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}
