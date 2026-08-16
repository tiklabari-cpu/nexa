/**
 * The root screen every tab's stack renders today — content is `13.7-f`…`-j`'s
 * job, not this one's (§6.1.6 KAPSAM DIŞI). What this proves in the meantime is
 * that the shell wires a real screen component through a real stack through a
 * real tab, styled from the token module rather than a literal colour.
 */
import { StyleSheet, Text, View } from 'react-native';

import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

interface PlaceholderScreenProps {
  title: string;
  description: string;
}

export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING[6],
    gap: SPACING[2],
  },
  title: {
    fontSize: FONT_SIZE.xl.size,
    lineHeight: FONT_SIZE.xl.lineHeight,
    fontWeight: FONT_SIZE.xl.weight,
    textAlign: 'center',
  },
  description: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
    textAlign: 'center',
  },
});
