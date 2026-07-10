import { Redirect, Tabs } from 'expo-router';
import { colors } from '@gym/ui-tokens';
import { FloatingTabBar } from '../../components/ui/FloatingTabBar';
import { AppStartupScreen } from '../../components/experience/AppStartupScreen';
import { useStoresHydrated } from '../../state/hydration';
import { useProfile } from '../../state/profile';

/**
 * Bottom tabs. Gate: new users land on the character welcome first
 * (login is OPTIONAL — it unlocks sync, buddies and paid tiers, and is
 * always one tap away from Welcome and Settings).
 */
export default function TabsLayout() {
  const hydrated = useStoresHydrated();
  const onboarded = useProfile((s) => s.onboarded);

  if (!hydrated) return <AppStartupScreen message="Loading your plan" />;
  if (!onboarded) return <Redirect href="/welcome" />;

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="train" options={{ title: 'Train' }} />
      <Tabs.Screen name="food" options={{ title: 'Food' }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      <Tabs.Screen name="buddy" options={{ title: 'Buddy' }} />
    </Tabs>
  );
}
