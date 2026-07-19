import { useCardDesign } from '../../../state/cardDesign';
import { CARD_DESIGNS, type CardFaceProps } from './cardDesigns';

/**
 * Renders whichever card face the member has picked (state/cardDesign.ts),
 * defaulting to Brushed Metal. Drop-in replacement for importing a specific
 * `MembershipCard*` component directly — every call site should use this
 * instead so the picker in Settings actually takes effect everywhere.
 */
export function MembershipCardAny(props: CardFaceProps) {
  const designId = useCardDesign((s) => s.designId);
  const Component = CARD_DESIGNS[designId].Component;
  return <Component {...props} />;
}
