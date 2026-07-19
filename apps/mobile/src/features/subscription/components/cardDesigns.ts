import type { ComponentType } from 'react';
import type { Tier } from '@gym/shared';
import { MembershipCard } from './MembershipCard';
import { MembershipCardConceptB } from './MembershipCardConceptB';
import { MembershipCardMonogram } from './CardMonogram';
import { MembershipCardArtDeco } from './CardArtDeco';
import { MembershipCardCarbon } from './CardCarbon';
import { MembershipCardMarble } from './CardMarble';
import { MembershipCardBlueprint } from './CardBlueprint';
import { MembershipCardHolographic } from './CardHolographic';
import { MembershipCardMinimal } from './CardMinimal';
import { MembershipCardRacing } from './CardRacing';

/**
 * Registry of every selectable membership-card face (Pack — card design
 * picker). Each entry is a drop-in component sharing the exact same props
 * contract as the original `MembershipCard` — swapping `designId` swaps the
 * rendered face with no other call-site changes.
 */

export interface CardFaceProps {
  tier: Tier;
  holderName: string;
  memberId: string | null;
  signedIn: boolean;
  expiresAt?: string | null;
  onPress?: () => void;
}

export const CARD_DESIGN_IDS = [
  'brushed',
  'guilloche',
  'monogram',
  'artdeco',
  'carbon',
  'marble',
  'blueprint',
  'holographic',
  'minimal',
  'racing',
] as const;

export type CardDesignId = (typeof CARD_DESIGN_IDS)[number];

interface CardDesignMeta {
  id: CardDesignId;
  label: string;
  description: string;
  Component: ComponentType<CardFaceProps>;
}

export const CARD_DESIGNS: Record<CardDesignId, CardDesignMeta> = {
  brushed: {
    id: 'brushed',
    label: 'Brushed Metal',
    description: 'Matte per-tier metal with a fine brushed texture.',
    Component: MembershipCard,
  },
  guilloche: {
    id: 'guilloche',
    label: 'Guilloché Reserve',
    description: 'Engine-turned rosettes and an engraved numeral medallion.',
    Component: MembershipCardConceptB,
  },
  monogram: {
    id: 'monogram',
    label: 'Monogram',
    description: 'An oversized engraved initial, editorial and refined.',
    Component: MembershipCardMonogram,
  },
  artdeco: {
    id: 'artdeco',
    label: 'Art Deco',
    description: 'A symmetrical geometric sunburst in a stepped frame.',
    Component: MembershipCardArtDeco,
  },
  carbon: {
    id: 'carbon',
    label: 'Carbon Fiber',
    description: 'A woven technical weave with a sharp red accent.',
    Component: MembershipCardCarbon,
  },
  marble: {
    id: 'marble',
    label: 'Marble',
    description: 'Polished stone veining with foil highlights.',
    Component: MembershipCardMarble,
  },
  blueprint: {
    id: 'blueprint',
    label: 'Blueprint',
    description: 'Technical contour lines and engineered spec marks.',
    Component: MembershipCardBlueprint,
  },
  holographic: {
    id: 'holographic',
    label: 'Holographic',
    description: 'Iridescent diagonal foil bands, futuristic and bright.',
    Component: MembershipCardHolographic,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description: 'Flat color, huge name, maximum restraint.',
    Component: MembershipCardMinimal,
  },
  racing: {
    id: 'racing',
    label: 'Racing',
    description: 'Bold diagonal stripes and a bib-style tier badge.',
    Component: MembershipCardRacing,
  },
};

export const CARD_DESIGN_LIST: CardDesignMeta[] = CARD_DESIGN_IDS.map((id) => CARD_DESIGNS[id]);
