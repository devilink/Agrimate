/** Plain, large-target building blocks. System fonts and no images, so the app stays small. */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNav } from './nav';
import { useNet } from './net';

export const colors = {
  bg: '#F4F5F0', card: '#FFFFFF', text: '#1B2A1F', muted: '#566359', primary: '#1F6F43', border: '#C5CEC6', danger: '#B3261E', skeleton: '#E2E6E1',
  warn: '#7A4F00', warnBg: '#FFF3D6', errBg: '#FCE8E6', okBg: '#E2F3E7', ok: '#14522F', infoBg: '#E6EEF8', info: '#1D4E89',
};
const TAP = 56;

export function Screen({ title, children, onRefresh, refreshing, footer, back = true }: { title: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; footer?: ReactNode; back?: boolean }) {
  const nav = useNav();
  const showBack = back && nav.depth > 1;
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        {showBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={nav.pop} style={styles.backButton}><Text style={styles.backText}>{'←'} Back</Text></Pressable> : null}
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>{title}</Text>
      </View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

export const Heading = ({ children }: { children: ReactNode }) => <Text style={styles.heading} accessibilityRole="header">{children}</Text>;
export const Body = ({ children }: { children: ReactNode }) => <Text style={styles.body}>{children}</Text>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={styles.muted}>{children}</Text>;

export function Button({ label, onPress, disabled, busy, kind = 'primary' }: { label: string; onPress?: () => void; disabled?: boolean; busy?: boolean; kind?: 'primary' | 'secondary' | 'danger' }) {
  const off = disabled || busy;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!busy }} disabled={off} onPress={onPress}
      style={({ pressed }) => [styles.button, kind === 'primary' && styles.buttonPrimary, kind === 'secondary' && styles.buttonSecondary, kind === 'danger' && styles.buttonDanger, off && styles.buttonOff, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : colors.primary} /> : null}
      <Text style={[styles.buttonText, kind === 'secondary' && { color: colors.primary }, kind === 'danger' && { color: colors.danger }, off && kind === 'primary' && { color: '#F4F5F0' }]}>{label}</Text>
    </Pressable>
  );
}

export const LinkButton = ({ label, url }: { label: string; url: string }) => <Button kind="secondary" label={label} onPress={() => { Linking.openURL(url).catch(() => undefined); }} />;

export function Field({ label, value, onChangeText, hint, error, keyboardType, maxLength, placeholder, autoCapitalize, secure, trailing }: { label: string; value: string; onChangeText: (t: string) => void; hint?: string; error?: string | null; keyboardType?: KeyboardTypeOptions; maxLength?: number; placeholder?: string; autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences'; secure?: boolean; trailing?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput accessibilityLabel={label} style={[styles.input, !!error && { borderColor: colors.danger }]} value={value} onChangeText={onChangeText} keyboardType={keyboardType} maxLength={maxLength} placeholder={placeholder} placeholderTextColor={colors.muted} autoCapitalize={autoCapitalize} secureTextEntry={secure} />
        {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
      </View>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const TONES = {
  info: { backgroundColor: colors.infoBg, color: colors.info },
  warn: { backgroundColor: colors.warnBg, color: colors.warn },
  error: { backgroundColor: colors.errBg, color: colors.danger },
  ok: { backgroundColor: colors.okBg, color: colors.ok },
};
export function Notice({ tone = 'info', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  const t = TONES[tone];
  return <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: t.backgroundColor }]}><Text style={[styles.noticeText, { color: t.color }]}>{children}</Text></View>;
}

export const Card = ({ children, onPress }: { children: ReactNode; onPress?: () => void }) => onPress
  ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>{children}</Pressable>
  : <View style={styles.card}>{children}</View>;

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>;
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={styles.checkRow}>
      <View style={[styles.checkBox, checked && styles.checkBoxOn]}>{checked ? <Text style={styles.checkMark}>{'✓'}</Text> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

export function RadioGroup<T extends string>({ value, options, onChange }: { value: T | null; options: { value: T; label: string; note?: string; disabled?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.field}>
      {options.map((o) => (
        <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: value === o.value, disabled: !!o.disabled }} disabled={o.disabled} onPress={() => onChange(o.value)} style={[styles.radio, value === o.value && styles.radioOn, o.disabled && styles.buttonOff]}>
          <Text style={styles.body}>{o.label}</Text>
          {o.note ? <Text style={styles.muted}>{o.note}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** A dropdown: one large row that opens a full-height list. */
export function Select<T extends string>({ label, value, options, onChange, placeholder = 'Choose one' }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const current = options.find((o) => o.value === value);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? placeholder}`} onPress={() => setOpen(true)} style={styles.select}>
        <Text style={current ? styles.body : styles.muted}>{current?.label ?? placeholder}</Text><Text style={styles.body}>{'▾'}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.flex, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12, paddingHorizontal: 16, backgroundColor: colors.bg }]}>
          <Text style={styles.title}>{label}</Text>
          <FlatList data={options} keyExtractor={(o) => o.value} renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => { onChange(item.value); setOpen(false); }} style={[styles.radio, item.value === value && styles.radioOn]}><Text style={styles.body}>{item.label}</Text></Pressable>
          )} />
          <Button kind="secondary" label="Close" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

/** Text placeholders for slow networks. There is no animation, since nothing here should waste the battery. */
export function Skeleton({ lines = 3, label = 'Loading...' }: { lines?: number; label?: string }) {
  return (
    <View accessibilityLabel={label} style={styles.card}>
      <Text style={styles.muted}>{label}</Text>
      {Array.from({ length: lines }, (_, i) => <View key={i} style={[styles.skeletonLine, { width: `${90 - i * 15}%` }]} />)}
    </View>
  );
}

export function OfflineBanner() {
  const { online, weak } = useNet();
  if (online && !weak) return null;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: online ? colors.warnBg : colors.danger }]}>
      <Text style={{ color: online ? colors.warn : '#fff', fontSize: 15, fontWeight: '600' }}>{online ? 'Weak connection. Some actions may be slow.' : 'You are offline. Showing saved information.'}</Text>
    </View>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; badge?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <View style={styles.tabs}>
      {tabs.map((t) => (
        <Pressable key={t.key} accessibilityRole="tab" accessibilityState={{ selected: t.key === active }} onPress={() => onChange(t.key)} style={[styles.tab, t.key === active && styles.tabOn]}>
          <Text numberOfLines={1} style={[styles.tabText, t.key === active && styles.tabTextOn]}>{t.label}{t.badge ? ` (${t.badge})` : ''}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 24 },
  backText: { fontSize: 17, color: colors.primary, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, paddingVertical: 4 },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  footer: { padding: 12, gap: 8, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 },
  body: { fontSize: 17, color: colors.text, lineHeight: 24 },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  errorText: { fontSize: 15, color: colors.danger, lineHeight: 21, fontWeight: '600' },
  button: { minHeight: TAP, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.primary },
  buttonDanger: { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.danger },
  buttonOff: { opacity: 0.5 },
  buttonText: { fontSize: 17, fontWeight: '700', color: '#fff', textAlign: 'center' },
  pressed: { opacity: 0.75 },
  field: { gap: 6 },
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: TAP, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.card, paddingHorizontal: 12, fontSize: 18, color: colors.text },
  trailing: { fontSize: 16, color: colors.muted, minWidth: 28 },
  notice: { borderRadius: 10, padding: 12 },
  noticeText: { fontSize: 16, lineHeight: 23, fontWeight: '500' },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  rowLabel: { fontSize: 15, color: colors.muted, flexShrink: 0 },
  rowValue: { fontSize: 16, color: colors.text, flexShrink: 1, textAlign: 'right', fontWeight: '500' },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: TAP, paddingVertical: 8 },
  checkBox: { width: 32, height: 32, borderRadius: 6, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  checkBoxOn: { backgroundColor: colors.primary },
  checkMark: { color: '#fff', fontSize: 20, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 16, lineHeight: 23, color: colors.text },
  radio: { minHeight: TAP, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, backgroundColor: colors.card, marginBottom: 8 },
  radioOn: { borderColor: colors.primary, borderWidth: 3 },
  select: { minHeight: TAP, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.card },
  skeletonLine: { height: 14, borderRadius: 4, backgroundColor: colors.skeleton, marginTop: 6 },
  banner: { paddingHorizontal: 16, paddingVertical: 8 },
  tabs: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, minHeight: TAP, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderTopWidth: 3, borderTopColor: 'transparent' },
  tabOn: { borderTopColor: colors.primary },
  tabText: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  tabTextOn: { color: colors.primary },
});
