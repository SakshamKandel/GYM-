'use client';

/**
 * What you get, day one — the 6-point checklist, in a glass panel beside the
 * pitch copy. Product-truth only (17 zones, <100 ms, free Starter tier).
 */
import { Reveal } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';

const ITEMS = [
  'Coach-built workout plans and a gym mode that flows set to set.',
  'Macro tracking with a Nepali + global food database and barcode scan.',
  'Smoothed weight trends, measurements and progress photos — kept private.',
  '3D anatomy you can tap — 17 muscle zones, offline.',
  'Meal delivery, verified gyms and real human coaching when you want them.',
  'Every set logs in under 100 ms, online or off.',
] as const;

export function WhatYouGet() {
  return (
    <Section tone="ink">
      <Container wide>
        <div className="grid gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <Reveal>
            <Eyebrow>Day one</Eyebrow>
            <Display size="md" className="mt-4">
              Everything, out<br />
              of the box.
            </Display>
            <Lead className="mt-6">
              No trial timer, no locked core. The free Starter tier tracks training, food and
              body from the first night. Paid tiers add coaching, meal delivery and more.
            </Lead>
          </Reveal>

          <Reveal delay={140}>
            <div className="mkt-glass rounded-block p-8 sm:p-10">
              <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
                {ITEMS.map((item) => (
                  <CheckItem key={item}>{item}</CheckItem>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
