import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, type } from '@gym/ui-tokens';
import { AppText, Tag } from '../../../components/ui';
import type { CoachTier } from '../api';
import { CoachAvatar } from './CoachAvatar';
import { CoachTierBadge, VerifiedMark } from './CoachTierBadge';

/**
 * Public coach profile hero.
 *
 * With a photo: a full-width `radius.block` photo block with a bottom-anchored
 * dark scrim (same approved gradient use as PhotoCard — legibility, not decor)
 * carrying tier badge + verified mark, the display-type name and the headline.
 *
 * Without a photo: the screen's ONE red block — big initials tile, onBlock
 * chips, black ink on red per the block language.
 *
 * `rating`/`reviewCount` are optional: the server withholds a coach's star
 * average until enough real members have reviewed them, and older servers
 * don't send the fields at all. Anything that isn't a real number renders no
 * star pill — never "0.0", which would read as a terrible coach.
 */
interface Props {
  name: string;
  headline: string;
  photoUrl: string | null;
  tier: CoachTier;
  /** Member star average, 0-5. Null/undefined = not enough reviews yet. */
  rating?: number | null;
  /** How many members that average is built from. */
  reviewCount?: number | null;
}

const HERO_HEIGHT = 300;

/**
 * Near-black floor into deep black. Unlike PhotoCard/PhotoHero, this photo is
 * a coach's own upload — brightness is NOT constrained to the curated dark
 * stock set, so (unlike the transparent-topped scrims elsewhere) the top stop
 * carries a 0.35 floor: even a bright/white-background photo keeps white ink
 * ≥4.5:1 across the whole badge/name/headline block, not just near the very
 * bottom of the frame.
 */
const SCRIM = ['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.88)'] as const;

const COACH_TIER_LABEL: Record<CoachTier, string> = {
  elite: 'Elite',
  gold: 'Gold',
  silver: 'Silver',
};

const styles = StyleSheet.create({
  photoHero: {
    height: HERO_HEIGHT,
    borderRadius: radius.block,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '72%',
  },
  photoContent: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.gutter,
    gap: spacing.sm,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: {
    fontSize: type.size.display,
    lineHeight: 46,
    textTransform: 'uppercase',
  },
  headlineOnPhoto: { opacity: 0.85 },
  // ── Red fallback block ──
  redHero: {
    backgroundColor: colors.blockRed,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.md,
  },
  redTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  redBadges: { flex: 1, gap: spacing.sm, alignItems: 'flex-start' },
  headlineOnRed: { opacity: 0.75 },
});

/**
 * Star + average + count, tinted for the surface it sits on. Rendered only
 * when a real average exists — the caller decides, this just draws it.
 */
function RatingLine({
  rating,
  reviewCount,
  tone,
}: {
  rating: number;
  reviewCount: number | null;
  tone: 'onPhoto' | 'onBlock';
}) {
  const ink = tone === 'onBlock' ? colors.onBlock : colors.text;
  return (
    <View
      style={styles.ratingRow}
      accessible
      accessibilityLabel={`Rated ${rating.toFixed(1)} out of 5${
        reviewCount !== null ? ` from ${reviewCount} member review${reviewCount === 1 ? '' : 's'}` : ''
      }`}
    >
      <Ionicons name="star" size={14} color={tone === 'onBlock' ? colors.onBlock : colors.accent} />
      <AppText variant="caption" color={ink}>
        {rating.toFixed(1)}
        {reviewCount !== null ? ` · ${reviewCount} review${reviewCount === 1 ? '' : 's'}` : ''}
      </AppText>
    </View>
  );
}

export function CoachHero({ name, headline, photoUrl, tier, rating, reviewCount }: Props) {
  const hasHeadline = headline.trim().length > 0;
  // Optional AND nullable on the wire — only a real number is a rating.
  const stars = typeof rating === 'number' ? rating : null;
  const reviews = typeof reviewCount === 'number' ? reviewCount : null;

  if (photoUrl !== null) {
    return (
      <View style={styles.photoHero}>
        <Image
          source={{ uri: photoUrl }}
          style={styles.photo}
          contentFit="cover"
          transition={150}
          accessibilityElementsHidden
        />
        <LinearGradient colors={[...SCRIM]} style={styles.scrim} />
        <View style={styles.photoContent}>
          <View style={styles.badgeRow}>
            <CoachTierBadge tier={tier} />
            <VerifiedMark />
            {stars !== null ? (
              <RatingLine rating={stars} reviewCount={reviews} tone="onPhoto" />
            ) : null}
          </View>
          <AppText
            variant="display"
            style={styles.name}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {name}
          </AppText>
          {hasHeadline ? (
            <AppText variant="body" numberOfLines={2} style={styles.headlineOnPhoto}>
              {headline}
            </AppText>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.redHero}>
      <View style={styles.redTop}>
        <CoachAvatar name={name} url={null} size={72} tone="onBlock" />
        <View style={styles.redBadges}>
          <Tag label={COACH_TIER_LABEL[tier]} variant="onBlock" />
          <VerifiedMark tone="onBlock" />
          {stars !== null ? (
            <RatingLine rating={stars} reviewCount={reviews} tone="onBlock" />
          ) : null}
        </View>
      </View>
      <AppText
        variant="display"
        color={colors.onBlock}
        style={styles.name}
        numberOfLines={2}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {name}
      </AppText>
      {hasHeadline ? (
        <AppText variant="body" color={colors.onBlock} numberOfLines={2} style={styles.headlineOnRed}>
          {headline}
        </AppText>
      ) : null}
    </View>
  );
}
