import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Chip, Heading, ScreenLayout, TaskRow, tokens } from "./design-system";

export type ShellTab = "home" | "find" | "calendar" | "me";

interface AppShellProps {
  readonly tab: ShellTab;
  readonly onTabChange: (tab: ShellTab) => void;
  readonly onCapture: () => void;
  readonly children: ReactNode;
}

export function AppShell({ tab, onTabChange, onCapture, children }: AppShellProps) {
  const insets = useSafeAreaInsets();
  return <SafeAreaView style={styles.safeArea} edges={["top"]}><ScreenLayout><View style={styles.content}>{children}</View><View style={[styles.navigation, { height: 68 + insets.bottom, paddingBottom: insets.bottom }]} accessibilityLabel="Primary navigation">
    {navItem("home", "Home", tab, onTabChange)}
    {navItem("find", "Find", tab, onTabChange)}
    <Pressable accessibilityRole="button" accessibilityLabel="Start a voice Capture" onPress={onCapture} style={styles.capture}><SchematicMic /></Pressable>
    {navItem("calendar", "Calendar", tab, onTabChange)}
    {navItem("me", "Me", tab, onTabChange)}
  </View></ScreenLayout></SafeAreaView>;
}

function SchematicMic() {
  return <View style={styles.micMark} accessibilityElementsHidden><View style={styles.micBody} /><View style={styles.micStem} /><View style={styles.micBase} /></View>;
}

function navItem(tab: ShellTab, label: string, current: ShellTab, onTabChange: (tab: ShellTab) => void) {
  const active = current === tab;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label}`} accessibilityState={{ selected: active }} onPress={() => onTabChange(tab)} style={styles.navItem}>{tab === "home" ? <HomeIcon active={active} /> : tab === "find" ? <SearchIcon active={active} /> : tab === "calendar" ? <CalendarIcon active={active} /> : <ProfileIcon active={active} />}<Text style={[styles.navLabel, active && styles.navActive]}>{label}</Text></Pressable>;
}

function HomeIcon({ active }: { readonly active: boolean }) {
  return <View style={styles.homeIcon} accessibilityElementsHidden><View style={[styles.homeRoof, active && styles.iconBorderActive]} /><View style={[styles.homeBody, active && styles.iconBorderActive]} /></View>;
}

function SearchIcon({ active }: { readonly active: boolean }) {
  return <View style={styles.searchIconMark} accessibilityElementsHidden><View style={[styles.searchLens, active && styles.iconBorderActive]} /><View style={[styles.searchHandle, active && styles.iconActive]} /></View>;
}

function CalendarIcon({ active }: { readonly active: boolean }) {
  return <View style={styles.calendarIcon} accessibilityElementsHidden><View style={[styles.calendarFrame, active && styles.iconBorderActive]}><View style={[styles.calendarHeader, active && styles.iconActive]} /><View style={styles.calendarGrid}>{[0, 1, 2, 3].map((cell) => <View key={cell} style={[styles.calendarCell, active && styles.iconActive]} />)}</View></View></View>;
}

function ProfileIcon({ active }: { readonly active: boolean }) {
  return <View style={styles.profileIcon} accessibilityElementsHidden><View style={[styles.profileHead, active && styles.iconBorderActive]} /><View style={[styles.profileBody, active && styles.iconBorderActive]} /></View>;
}

export function FindSurface() {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Universal search">Find</Heading><View style={styles.search}><Text style={styles.searchIcon}>⌕</Text><Text style={styles.searchPlaceholder}>Search everything</Text></View><View style={styles.chips}><Chip>Tasks</Chip><Chip>Captures</Chip><Chip>Notes</Chip><Chip>Spaces</Chip></View><Card tone="blue"><Text style={styles.cardEyebrow}>TASK</Text><Text style={styles.cardTitle}>Book dentist appointment</Text><Text style={styles.cardDetail}>Personal › Health · next week</Text></Card><Card><Text style={styles.cardEyebrow}>CAPTURE</Text><Text style={styles.cardTitle}>I need to book a dentist appointment…</Text><Text style={styles.cardDetail}>Audio Capture · yesterday</Text></Card></ScrollView>;
}

export function CalendarSurface() {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Your scheduled work">Calendar</Heading><Card tone="blue"><Text style={styles.cardEyebrow}>UPCOMING</Text><Text style={styles.cardTitle}>See Tasks by date</Text><Text style={styles.cardDetail}>Scheduled work and undated items remain available from the full collection.</Text></Card><Text style={styles.sectionTitle}>Next up</Text><Card><TaskRow title="Book dentist appointment" detail="Today · 9:30 AM" /><View style={styles.divider} /><TaskRow title="Prepare Q2 planning" detail="Today · 1:00 PM" /></Card></ScrollView>;
}

export function MeSurface({ onOpenMaterials }: { readonly onOpenMaterials?: () => void } = {}) {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Your organization">Library</Heading>{onOpenMaterials ? <Pressable accessibilityRole="button" accessibilityLabel="Open Materials" onPress={onOpenMaterials} style={styles.materialsEntry}><Text style={styles.cardEyebrow}>COLLECTION</Text><Text style={styles.cardTitle}>Materials</Text><Text style={styles.cardDetail}>Browse Tasks and Notes without opening organization management.</Text></Pressable> : null}<Card tone="butter"><Text style={styles.cardTitle}>Spaces</Text><Text style={styles.cardDetail}>Home · Work · Personal › Health</Text></Card><Card tone="lavender"><Text style={styles.cardTitle}>Entities</Text><Text style={styles.cardDetail}>Dentist · Alex · Q2 Planning</Text></Card><Card tone="blue"><Text style={styles.cardTitle}>Tags</Text><Text style={styles.cardDetail}>urgent · errand · waiting</Text></Card></ScrollView>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: tokens.colors.background, flex: 1 },
  content: { flex: 1 },
  navigation: { alignItems: "center", backgroundColor: tokens.colors.surface, borderTopColor: "#F0EEE9", borderTopWidth: 1, flexDirection: "row", height: 76, justifyContent: "space-around", paddingHorizontal: 8, shadowColor: tokens.colors.ink, shadowOffset: { height: -2, width: 0 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  navItem: { alignItems: "center", gap: 3, minWidth: 64, paddingVertical: 4 },
  navLabel: { color: tokens.colors.muted, fontSize: 13, fontWeight: "600" },
  navActive: { color: tokens.colors.green, fontWeight: "800" },
  capture: { alignItems: "center", backgroundColor: tokens.colors.lime, borderColor: tokens.colors.green, borderRadius: 32, borderWidth: 2, elevation: 3, height: 64, justifyContent: "center", marginTop: -32, shadowColor: tokens.colors.ink, shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.12, shadowRadius: 8, width: 64 },
  micMark: { alignItems: "center", height: 37, justifyContent: "flex-start", width: 30 },
  micBody: { borderColor: tokens.colors.green, borderRadius: 9, borderWidth: 3, height: 22, width: 13 },
  micStem: { backgroundColor: tokens.colors.green, height: 8, width: 3 },
  micBase: { backgroundColor: tokens.colors.green, height: 3, marginTop: 1, width: 17 },
  iconActive: { backgroundColor: tokens.colors.green },
  iconBorderActive: { borderColor: tokens.colors.green },
  searchIconMark: { alignItems: "flex-start", height: 42, justifyContent: "center", paddingLeft: 3, width: 32 },
  homeIcon: { alignItems: "center", height: 42, justifyContent: "center", width: 32 },
  homeRoof: { borderColor: tokens.colors.muted, borderLeftWidth: 2, borderTopWidth: 2, height: 13, marginBottom: -5, transform: [{ rotate: "45deg" }], width: 13 },
  homeBody: { borderColor: tokens.colors.muted, borderRadius: 2, borderWidth: 2, height: 16, width: 21 },
  searchLens: { borderColor: tokens.colors.muted, borderRadius: 10, borderWidth: 2, height: 18, width: 18 },
  searchHandle: { backgroundColor: tokens.colors.muted, height: 2, left: 19, position: "absolute", top: 27, transform: [{ rotate: "45deg" }], width: 9 },
  calendarIcon: { alignItems: "center", height: 42, justifyContent: "center", width: 32 },
  calendarFrame: { borderColor: tokens.colors.muted, borderRadius: 3, borderWidth: 2, height: 25, padding: 3, width: 24 },
  calendarHeader: { backgroundColor: tokens.colors.muted, height: 3, marginBottom: 4, width: 14 },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 2, width: 14 },
  calendarCell: { backgroundColor: tokens.colors.muted, height: 3, width: 3 },
  divider: { backgroundColor: tokens.colors.border, height: 1, marginVertical: 16 },
  profileIcon: { alignItems: "center", height: 42, justifyContent: "center", width: 32 },
  profileHead: { borderColor: tokens.colors.muted, borderRadius: 7, borderWidth: 2, height: 14, marginBottom: 2, width: 14 },
  profileBody: { borderColor: tokens.colors.muted, borderRadius: 10, borderWidth: 2, height: 13, width: 25 },
  surface: { paddingBottom: tokens.spacing.lg },
  search: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, flexDirection: "row", marginHorizontal: tokens.spacing.lg, padding: tokens.spacing.md },
  searchIcon: { color: tokens.colors.ink, fontSize: 24, marginRight: 10 },
  searchPlaceholder: { color: tokens.colors.muted, fontSize: 16 },
  chips: { flexDirection: "row", gap: 8, padding: tokens.spacing.lg },
  cardEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  cardTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: "700", lineHeight: 25 },
  cardDetail: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  materialsEntry: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.green, borderRadius: tokens.radius.card, borderWidth: 2, marginHorizontal: tokens.spacing.lg, marginBottom: tokens.spacing.md, padding: tokens.spacing.lg },
  sectionTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "800", marginHorizontal: tokens.spacing.lg, marginVertical: 8 },
});
