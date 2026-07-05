import type { ReactNode } from 'react';
import type { Tier } from '@gym/shared';
import { TierAvatarFrame } from './TierAvatarFrame';

/**
 * Web fallback for AnimatedTierRing — Skia's canvaskit isn't configured on
 * web, so premium surfaces get the static metallic frame instead. Metro
 * resolves this file on web; the native file (and its Skia import) never
 * loads there. Keep the props identical to AnimatedTierRing.tsx.
 */

interface Props {
  tier: Tier;
  /** Avatar diameter in px; children should fill this same square. */
  size: number;
  children: ReactNode;
}

export function AnimatedTierRing({ tier, size, children }: Props) {
  return (
    <TierAvatarFrame tier={tier} size={size}>
      {children}
    </TierAvatarFrame>
  );
}
