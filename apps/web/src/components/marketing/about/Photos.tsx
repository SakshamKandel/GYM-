'use client';

/**
 * Photos band — two framed shots (a blue-lit runners silhouette + a yoga hold)
 * with a short editorial line. Movement is movement, whatever the discipline.
 */
import { Reveal } from '../motion';
import { Container, Display, Eyebrow, PhotoBlock, Section } from '../ui';

export function AboutPhotos() {
  return (
    <Section tone="coal">
      <Container wide>
        <Reveal>
          <Eyebrow>Who it&rsquo;s for</Eyebrow>
          <Display size="lg" className="mt-4 max-w-3xl">
            Lifters, runners,<br />
            everyone in between.
          </Display>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          <Reveal delay={100}>
            <PhotoBlock
              src="/stock/runners-silhouette-blue.jpg"
              alt="Silhouettes of runners against a deep blue evening sky"
              caption="Endurance, tracked the same way"
              className="aspect-[4/3] w-full"
            />
          </Reveal>
          <Reveal delay={180}>
            <PhotoBlock
              src="/stock/yoga.jpg"
              alt="A person holding a controlled yoga pose on a mat"
              caption="Mobility counts as training"
              className="aspect-[4/3] w-full"
            />
          </Reveal>
        </div>

        <Reveal delay={240}>
          <p className="mt-10 max-w-2xl text-[16px] leading-relaxed text-dim">
            You don&rsquo;t have to be a powerlifter to belong here. The plan bends to what you
            do — barbells, trail runs, or a mat on the floor — and the method stays the same.
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}
