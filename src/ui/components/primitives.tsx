// Layout and text primitives shared by every screen.
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from '../icons';
import { color, font, minTouch, radius, space, type } from '../tokens';

export function Screen({ children, gap = 18, footer }: { children: ReactNode; gap?: number; footer?: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={[styles.scroll, { gap }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer}
    </SafeAreaView>
  );
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[type.sectionLabel, style]} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Meta({ children, style, numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  return (
    <Text style={[type.meta, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

/** Back chevron + title row (44pt tall). */
export function ScreenHeader({ title, titleStyle, right, onBack, backLabel = 'Back' }: {
  title?: string;
  titleStyle?: StyleProp<TextStyle>;
  right?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <IconButton label={backLabel} onPress={onBack ?? goBack} style={{ marginLeft: -10 }}>
          <ChevronLeft size={22} />
        </IconButton>
        {title ? <Text style={[type.title, titleStyle]}>{title}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function IconButton({ label, onPress, children, disabled, style }: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, style]}
    >
      {children}
    </Pressable>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export function Button({ label, onPress, variant = 'secondary', icon, disabled, height, style, textStyle }: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: ReactNode;
  disabled?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const v = buttonVariants[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, v.box, { height: height ?? (variant === 'primary' ? 54 : 48) }, disabled && styles.disabled, pressed && styles.pressed, style]}
    >
      {icon}
      <Text style={[styles.buttonText, v.text, textStyle]}>{label}</Text>
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { box: ViewStyle; text: TextStyle }> = {
  primary: { box: { backgroundColor: color.ink, borderRadius: radius.input }, text: { color: '#FFFFFF', fontFamily: font.bodySemibold, fontSize: 16 } },
  secondary: { box: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.borderStrong }, text: { color: color.ink } },
  ghost: { box: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.borderStrong }, text: { color: color.inkSecondary } },
};

/** White rounded card with hairline border. */
export function Card({ children, style, dashed, muted }: { children: ReactNode; style?: StyleProp<ViewStyle>; dashed?: boolean; muted?: boolean }) {
  return <View style={[styles.card, dashed && styles.dashed, muted && styles.mutedCard, style]}>{children}</View>;
}

/** Grouped list container with row dividers. */
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.group, style]}>{children}</View>;
}

export function Row({ children, style, last }: { children: ReactNode; style?: StyleProp<ViewStyle>; last?: boolean }) {
  return <View style={[styles.row, !last && styles.rowDivider, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.bg },
  scroll: { paddingTop: 16, paddingHorizontal: space.screenX, paddingBottom: 28 },
  header: { height: minTouch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton: { width: minTouch, height: minTouch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.button },
  button: { borderRadius: radius.button, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  buttonText: { fontFamily: font.bodyMedium, fontSize: 14.5, color: color.ink },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card, padding: space.cardPad, gap: 10 },
  dashed: { borderStyle: 'dashed', borderColor: color.borderStrong },
  mutedCard: { backgroundColor: color.surfaceFaded },
  group: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.input, overflow: 'hidden' },
  row: { paddingVertical: 12, paddingHorizontal: space.cardPad, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: color.divider },
});
