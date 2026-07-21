/**
 * /partners closing CTA — compact coal band under a loud aurora. Glowing
 * primary to /contact, glass ghost to the partner portal sign-in.
 */
import { Reveal } from '../motion';
import { ArrowLink, Container, Display, Eyebrow, PillLink, Section } from '../ui';

export function PartnersClosing() {
  return (
    <Section tone="coal" ambient="aurora" grid pad="py-24 sm:py-28">
      <Container className="text-center">
        <Reveal>
          <Eyebrow>Kathmandu valley · Onboarding by the GM team</Eyebrow>
        </Reveal>
        <Reveal delay={80}>
          <Display size="lg" flavor="steel" className="mx-auto mt-4 max-w-3xl">
            Put your <span className="mkt-text-ember">kitchen</span>
            <br />
            in the app.
          </Display>
        </Reveal>
        <Reveal delay={160}>
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-dim">
            Members are already planning their week of meals. Talk to the GM team and get your
            menu in front of them.
          </p>
        </Reveal>
        <Reveal delay={240} className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <PillLink href="/contact">Become a partner</PillLink>
          <PillLink href="/partner/login" variant="ghost">
            Partner sign-in
          </PillLink>
        </Reveal>
        <Reveal delay={320} className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <ArrowLink href="/meals" className="text-dim hover:text-snow">
            GM Meals for members
          </ArrowLink>
          <ArrowLink href="/for-coaches" className="text-dim hover:text-snow">
            Coach with us instead
          </ArrowLink>
        </Reveal>
      </Container>
    </Section>
  );
}
