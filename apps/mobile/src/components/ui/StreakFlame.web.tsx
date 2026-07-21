import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@gym/ui-tokens';

interface Props {
  active: boolean;
  size?: number;
}

/** Static web fallback: avoids lottie's unsupported controlled-progress prop. */
export function StreakFlame({ active, size = 28 }: Props) {
  return (
    <View style={{ width: size, height: size, opacity: active ? 1 : 0.35 }}>
      <Ionicons name="flame" size={size} color={active ? colors.accent : colors.textDim} />
    </View>
  );
}
