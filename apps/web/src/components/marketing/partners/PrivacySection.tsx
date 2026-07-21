/**
 * /partners privacy section — short ink band: PII-minimal order projections.
 * Two glass lists: what an order card shows vs what never reaches the portal.
 */
import type { ReactNode } from 'react';
import { Reveal } from '../motion';
import { Card, CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

function CrossItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[15px] leading-relaxed text-dim">
      <span
        aria-hidden
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-faint"
      >
        ✕
      </span>
      <span>{children}</span>
    </li>
  );
}

export function PrivacySection() {
  return (
    <Section tone="ink">
      <Container>
        <div className="max-w-2xl">
          <Reveal>
            <Eyebrow>Privacy by design</Eyebrow>
          </Reveal>
          <Reveal delay={80}>
            <Display size="lg" flavor="steel" className="mt-4">
              You see what to cook.
              <br />
              Nothing else.
            </Display>
          </Reveal>
          <Reveal delay={160}>
            <Lead className="mt-6">
              The portal shows PII-minimal projections of each order — what to make, where it
              goes, how it&rsquo;s paid. Member profiles, training data and chat never reach the
              kitchen.
            </Lead>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          <Reveal delay={100}>
            <Card raised className="h-full">
              <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.2em] text-dim">
                On every order card
              </p>
              <ul className="mt-5 flex flex-col gap-3.5">
                <CheckItem>Dishes and quantities to prepare</CheckItem>
                <CheckItem>Delivery address and window</CheckItem>
                <CheckItem>Payment type — prepaid or COD</CheckItem>
                <CheckItem>The order code, for handoff and support</CheckItem>
              </ul>
            </Card>
          </Reveal>
          <Reveal delay={200}>
            <Card className="h-full">
              <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.2em] text-dim">
                Never in the portal
              </p>
              <ul className="mt-5 flex flex-col gap-3.5">
                <CrossItem>Member profiles, photos or body stats</CrossItem>
                <CrossItem>Training and nutrition history</CrossItem>
                <CrossItem>Contact details beyond the delivery itself</CrossItem>
                <CrossItem>Other kitchens&rsquo; orders or menus</CrossItem>
              </ul>
            </Card>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
