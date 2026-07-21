'use client';

/**
 * Interactive Phone component — wraps PhoneFrame and mounts an interactive replica
 * of the Expo mobile app's 6 tab screens (Home, Train, Food, Meals, Gyms, Progress).
 * Allows switching tabs either directly inside the phone UI or via parent controls.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { PhoneFrame } from './PhoneFrame';
import { type TabName } from './screens/appkit';
import { GymListScreen } from './screens/GymListScreen';
import { MacroScreen } from './screens/MacroScreen';
import { MealSubscriptionScreen } from './screens/MealSubscriptionScreen';
import { MeasurementsScreen } from './screens/MeasurementsScreen';
import { TodayScreen } from './screens/TodayScreen';
import { WorkoutLoggerScreen } from './screens/WorkoutLoggerScreen';

interface InteractivePhoneProps {
  initialTab?: TabName;
  activeTab?: TabName;
  onTabChange?: (tab: TabName) => void;
  scale?: number;
  tilt?: 'none' | 'left' | 'right' | 'up';
  priority?: boolean;
  className?: string;
}

export function InteractivePhone({
  initialTab = 'home',
  activeTab: controlledTab,
  onTabChange,
  scale = 0.94,
  tilt = 'none',
  priority = false,
  className = '',
}: InteractivePhoneProps) {
  const [internalTab, setInternalTab] = useState<TabName>(initialTab);

  const currentTab = controlledTab ?? internalTab;

  useEffect(() => {
    if (controlledTab && controlledTab !== internalTab) {
      setInternalTab(controlledTab);
    }
  }, [controlledTab, internalTab]);

  const handleTabChange = (nextTab: TabName) => {
    setInternalTab(nextTab);
    onTabChange?.(nextTab);
  };

  const renderScreen = (tab: TabName) => {
    switch (tab) {
      case 'home':
        return <TodayScreen onTabChange={handleTabChange} />;
      case 'train':
        return <WorkoutLoggerScreen onTabChange={handleTabChange} />;
      case 'food':
        return <MacroScreen onTabChange={handleTabChange} />;
      case 'meals':
        return <MealSubscriptionScreen onTabChange={handleTabChange} />;
      case 'gyms':
        return <GymListScreen onTabChange={handleTabChange} />;
      case 'progress':
        return <MeasurementsScreen onTabChange={handleTabChange} />;
      default:
        return <TodayScreen onTabChange={handleTabChange} />;
    }
  };

  return (
    <PhoneFrame scale={scale} tilt={tilt} priority={priority} className={className}>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentTab}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="size-full"
        >
          {renderScreen(currentTab)}
        </motion.div>
      </AnimatePresence>
    </PhoneFrame>
  );
}
