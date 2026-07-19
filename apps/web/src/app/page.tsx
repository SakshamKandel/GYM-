import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/customer/MarketingShell';
import styles from '@/components/customer/marketing.module.css';

export const metadata: Metadata = {
  title: 'The GM Method | Train with a plan that adapts',
  description:
    'Training, food, progress, and real coaching in one accessible fitness app built for consistency.',
};

const FEATURES = [
  {
    number: '01',
    title: 'Train with intent',
    body: 'Follow a structured plan, log every set in Gym Mode, time your rest, and see personal records the moment they happen.',
  },
  {
    number: '02',
    title: 'Eat with clarity',
    body: 'Track calories, macros, water, and regional foods without turning every meal into a spreadsheet.',
  },
  {
    number: '03',
    title: 'See the trend',
    body: 'Weight smoothing, measurements, strength analytics, and check-ins show the direction—not one noisy day.',
  },
  {
    number: '04',
    title: 'Get human support',
    body: 'Coach-assigned training, diet plans, form review, and support live beside the work you are already doing.',
  },
] as const;

export default function Home() {
  return (
    <MarketingShell>
      <section className={styles.hero}>
        <div className={styles.heroCopyBlock}>
          <p className={styles.eyebrow}>THE GM METHOD · BUILT FOR CONSISTENCY</p>
          <h1 className={styles.heroTitle}>A plan that gets stronger with you.</h1>
          <p className={styles.heroCopy}>
            Training, food, progress, and real coaching—one calm system for the days motivation
            is not enough.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryLink} href="/pricing">
              Compare plans
            </Link>
            <a className={styles.secondaryLink} href="#how-it-works">
              See how it works
            </a>
          </div>
        </div>

        <div className={styles.heroPanel} aria-label="Product highlights">
          <div className={styles.heroPanelTop}>
            <span className={styles.liveDot} aria-hidden="true" />
            <span>YOUR NEXT SESSION</span>
          </div>
          <p className={styles.workoutName}>Push · Strength</p>
          <p className={styles.workoutMeta}>6 exercises · 52 min · progression ready</p>
          <div className={styles.panelGrid}>
            <div className={styles.panelStat}>
              <strong className={styles.panelStatValue}>3</strong>
              <span>week streak</span>
            </div>
            <div className={styles.panelStat}>
              <strong className={styles.panelStatValue}>92%</strong>
              <span>protein target</span>
            </div>
            <div className={styles.panelStat}>
              <strong className={styles.panelStatValue}>+2</strong>
              <span>recent PRs</span>
            </div>
          </div>
          <div className={styles.progressTrack} aria-hidden="true">
            <span />
          </div>
          <p className={styles.panelNote}>Offline-first logging keeps working in the basement.</p>
        </div>
      </section>

      <section className={styles.proofStrip} aria-label="Platform capabilities">
        <span>iOS + Android</span>
        <span>Offline-first</span>
        <span>Coach connected</span>
        <span>Accessible by design</span>
      </section>

      <section className={styles.section} id="features">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>ONE SYSTEM, NOT FIVE APPS</p>
            <h2 className={styles.sectionTitle}>Everything required to keep showing up.</h2>
          </div>
          <p className={styles.sectionCopy}>
            The important signal stays visible. The detailed tools are there exactly when you
            need them.
          </p>
        </div>
        <div className={styles.featureGrid}>
          {FEATURES.map((feature) => (
            <article className={styles.featureCard} key={feature.number}>
              <span className={styles.featureIndex}>{feature.number}</span>
              <h3 className={styles.featureTitle}>{feature.title}</h3>
              <p className={styles.featureText}>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section} id="how-it-works">
        <div className={styles.sectionHead}>
          <div>
            <p className={styles.eyebrow}>HOW IT WORKS</p>
            <h2 className={styles.sectionTitle}>Start simple. Adapt from real data.</h2>
          </div>
        </div>
        <div className={styles.stepGrid}>
          <article className={styles.stepCard}>
            <span>1</span>
            <h3>Tell us the goal</h3>
            <p>A short onboarding builds realistic calorie, macro, step, and training targets.</p>
          </article>
          <article className={styles.stepCard}>
            <span>2</span>
            <h3>Do today’s work</h3>
            <p>Log workouts and food quickly, even without a connection.</p>
          </article>
          <article className={styles.stepCard}>
            <span>3</span>
            <h3>Adjust the plan</h3>
            <p>Trends, progression, and coach input turn the log into the next useful action.</p>
          </article>
        </div>
      </section>

      <section className={styles.ctaBand} id="download">
        <div>
          <p className={styles.eyebrow}>READY WHEN YOU ARE</p>
          <h2>Build a routine you can keep.</h2>
          <p>Choose the support level that matches where you are now.</p>
        </div>
        <div className={styles.ctaBandActions}>
          <Link className={styles.lightLink} href="/pricing">
            View membership
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}
