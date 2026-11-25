import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const C = {
  bg: '#FFF8F1',
  card: '#FFFFFF',
  ink: '#2B1B17',
  soft: '#7A6560',
  line: '#EADFD6',
  brand: '#B0303C', // wedding red
  brandSoft: '#FBE9EA',
  gold: '#C9952B',
  helper: '#EEF3FF', // the helper's own bubble colour
  helperInk: '#2F4A8A',
  ok: '#2E7D4F',
};

export function Screen({ title, onBack, children, right, scroll = true }: {
  title?: string; onBack?: () => void; children: React.ReactNode; right?: React.ReactNode; scroll?: boolean;
}) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={{ flex: 1 }}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
      {(title || onBack) && (
        <View style={s.header}>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12} style={{ paddingRight: 12 }}>
              <Text style={{ fontSize: 17, color: C.brand }}>‹ Back</Text>
            </Pressable>
          ) : null}
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          <View style={{ marginLeft: 'auto' }}>{right}</View>
        </View>
      )}
      {body}
    </SafeAreaView>
  );
}

export function H({ children }: { children: React.ReactNode }) {
  return <Text style={s.h}>{children}</Text>;
}

export function P({ children, soft, style }: { children: React.ReactNode; soft?: boolean; style?: any }) {
  return <Text style={[s.p, soft && { color: C.soft }, style]}>{children}</Text>;
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.7 }]}>
        {children}
      </Pressable>
    );
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({ title, onPress, kind = 'primary', busy, disabled, small }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; busy?: boolean; disabled?: boolean; small?: boolean;
}) {
  const bg = kind === 'primary' ? C.brand : kind === 'danger' ? '#fff' : 'transparent';
  const fg = kind === 'primary' ? '#fff' : C.brand;
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        small && { paddingVertical: 8, paddingHorizontal: 12, marginVertical: 4 },
        { backgroundColor: bg, borderColor: C.brand, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 17 }}>{title}</Text>}
    </Pressable>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginVertical: 6 }}>
      {props.label ? <Text style={s.label}>{props.label}</Text> : null}
      <TextInput placeholderTextColor="#B4A39C" {...props} style={[s.input, props.style]} />
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[s.chip, value === o.value && { backgroundColor: C.brand, borderColor: C.brand }]}
        >
          <Text style={{ color: value === o.value ? '#fff' : C.ink, fontSize: 16 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** "Couple can't see this" badge, shown on every guest room. */
export function WallBadge() {
  return (
    <View style={s.badge}>
      <Text style={{ color: C.ok, fontWeight: '600' }}>🔒 Couple can't see this</Text>
    </View>
  );
}

export function ErrorText({ text }: { text?: string | null }) {
  if (!text) return null;
  return <Text style={{ color: C.brand, marginVertical: 6 }}>{text}</Text>;
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line },
  title: { fontSize: 18, fontWeight: '700', color: C.ink, flexShrink: 1 },
  h: { fontSize: 20, fontWeight: '700', color: C.ink, marginTop: 16, marginBottom: 8 },
  p: { fontSize: 16, color: C.ink, lineHeight: 22 },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, marginVertical: 6, borderWidth: 1, borderColor: C.line },
  btn: { borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', marginVertical: 6 },
  label: { fontSize: 14, color: C.soft, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 17, color: C.ink },
  chip: { borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#E8F5EC', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 8 },
});
