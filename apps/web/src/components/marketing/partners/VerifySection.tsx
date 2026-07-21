/**
 * /partners verify-member section — the page's single red band. The in-
 * restaurant member-discount moment, with the Verify Member tool on a light
 * card and privacy guarantees as red-tone check items.
 */
import { Reveal } from '../motion';
import { CheckItem, Container, Display, Eyebrow, Lead, Section } from '../ui';
import { VerifyMemberMock } from './VerifyMemberMock';

export function VerifySection() {
  return (
    <Section tone="red">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <Reveal>
              <Eyebrow tone="red">At the counter</Eyebrow>
            </Reveal>
            <Reveal delay={80}>
              <Display size="lg" className="mt-4">
                Verify the card.
                <br />
                Apply the discount.
              </Display>
            </Reveal>
            <Reveal delay={160}>
              <Lead tone="red" className="mt-6">
                GM members carry a member code in their app. When one walks into your restaurant,
                type the code into the portal — you get exactly three facts, enough to honor the
                member discount and nothing more.
              </Lead>
            </Reveal>
            <Reveal delay={240}>
              <ul className="mt-8 flex flex-col gap-3.5">
                <CheckItem tone="red">First name, tier and validity — nothing else</CheckItem>
                <CheckItem tone="red">
                  Uniform &ldquo;not found&rdquo; reply, so codes can&rsquo;t be fished
                </CheckItem>
                <CheckItem tone="red">Rate-limited server-side — 30 checks a minute, max</CheckItem>
              </ul>
            </Reveal>
          </div>
          <Reveal delay={200}>
            <div className="mx-auto w-full max-w-[440px] rounded-block bg-white p-6 shadow-pop sm:p-7">
              <VerifyMemberMock />
            </div>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
