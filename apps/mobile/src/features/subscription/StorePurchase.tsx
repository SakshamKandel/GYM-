import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Tier } from '@gym/shared';
import { colors, radius, spacing } from '@gym/ui-tokens';
import {
  AppText,
  Button,
  OptionCard,
  SectionLabel,
  Sheet,
  enterFade,
} from '../../components/ui';
import { periodLabel, type StorePackage } from '../../lib/billing';
import { tierName } from '../../lib/tier';
import type { StoreBilling, StoreNotice, StoreNoticeTone } from './storeBilling';

/**
 * The paywall's store surfaces: the sheet a member buys a membership in, and
 * the restore row for a membership they already paid for.
 *
 * Both render nothing at all unless a real purchase can be completed right now
 * (see useStoreBilling), so neither can ever be a dead button. Prices come
 * straight from the store, in the store's own wording, because that is the
 * amount the member is charged.
 */

function noticeColor(tone: StoreNoticeTone): string {
  if (tone === 'good') return colors.success;
  if (tone === 'bad') return colors.error;
  return colors.textDim;
}

function NoticeLine({ notice }: { notice: StoreNotice }) {
  return (
    <Animated.View entering={enterFade()}>
      <AppText variant="caption" color={noticeColor(notice.tone)}>
        {notice.message}
      </AppText>
    </Animated.View>
  );
}

/**
 * "I already paid" — the way back to a membership bought on another phone, or
 * one whose confirmation never arrived. Apple requires this to be reachable
 * without buying anything first.
 */
export function StoreRestoreCard({ store }: { store: StoreBilling }) {
  if (!store.available) return null;
  const busy = store.activity !== 'idle';
  const notice = store.notice?.from === 'restore' ? store.notice : null;

  return (
    <Animated.View entering={enterFade()} style={styles.restoreWrap}>
      <SectionLabel>Already bought a membership?</SectionLabel>
      <AppText variant="caption" color={colors.textDim}>
        If you paid on another phone, or reinstalled the app, bring your membership back here.
      </AppText>
      <Button
        label={store.activity === 'restoring' ? 'Looking…' : 'Restore purchases'}
        variant="secondary"
        loading={store.activity === 'restoring'}
        disabled={busy}
        onPress={store.restore}
      />
      {notice ? <NoticeLine notice={notice} /> : null}
    </Animated.View>
  );
}

/**
 * Pick a length, pay in the store. `tier` is controlled: null closes the sheet,
 * and the last one is kept so the content stays put through the exit animation.
 */
export function StorePurchaseSheet({
  store,
  tier,
  onClose,
}: {
  store: StoreBilling;
  tier: Tier | null;
  onClose: () => void;
}) {
  const lastRef = useRef<Tier | null>(tier);
  if (tier) lastRef.current = tier;
  const shown = tier ?? lastRef.current;

  return (
    <Sheet
      visible={tier !== null}
      onClose={onClose}
      title={shown ? `${tierName(shown)} membership` : undefined}
    >
      {shown ? <Body store={store} tier={shown} /> : null}
    </Sheet>
  );
}

function Body({ store, tier }: { store: StoreBilling; tier: Tier }) {
  const packages = store.packagesFor(tier);
  const [picked, setPicked] = useState<string | null>(null);
  // Derive rather than store: the offerings can refresh underneath an open
  // sheet, and a selection that no longer exists must never be purchasable.
  const selected: StorePackage | null =
    packages.find((pkg) => pkg.key === picked) ?? packages[0] ?? null;
  const busy = store.activity !== 'idle';
  const notice = store.notice;

  if (packages.length === 0) {
    return (
      <AppText variant="caption" color={colors.textDim}>
        This membership is not on sale in your store right now. Please check back soon.
      </AppText>
    );
  }

  const ctaLabel =
    store.activity === 'buying'
      ? `Opening ${store.storeLabel}…`
      : store.activity === 'confirming'
        ? 'Confirming…'
        : 'Continue';

  return (
    <View style={styles.sheetBody}>
      <AppText variant="caption" color={colors.textDim}>
        Choose how long you want, then confirm the payment in {store.storeLabel}.
      </AppText>

      <View style={styles.options}>
        {packages.map((pkg) => (
          <OptionCard
            key={pkg.key}
            title={periodLabel(pkg.period)}
            subtitle={pkg.priceLabel}
            selected={selected?.key === pkg.key}
            onPress={() => !busy && setPicked(pkg.key)}
          />
        ))}
      </View>

      {notice ? <NoticeLine notice={notice} /> : null}

      <Button
        label={ctaLabel}
        loading={busy && store.activity !== 'restoring'}
        disabled={busy || selected === null}
        onPress={() => selected && store.buy(selected, tier)}
      />

      <Button
        label="Restore purchases"
        variant="ghost"
        loading={store.activity === 'restoring'}
        disabled={busy}
        onPress={store.restore}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  restoreWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.block,
    padding: spacing.gutter,
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  sheetBody: { gap: spacing.md },
  options: { gap: spacing.sm },
});
