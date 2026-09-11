import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Chip, Heading, ScreenLayout, TaskRow, tokens } from "./design-system";

export type ShellTab = "home" | "find" | "digest" | "me";

interface AppShellProps {
  readonly tab: ShellTab;
  readonly onTabChange: (tab: ShellTab) => void;
  readonly onCapture: () => void;
  readonly children: ReactNode;
}

export function AppShell({ tab, onTabChange, onCapture, children }: AppShellProps) {
  return <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}><ScreenLayout><View style={styles.content}>{children}</View><View style={styles.navigation} accessibilityLabel="Primary navigation">
    {navItem("home", "Home", "⌂", tab, onTabChange)}
    {navItem("find", "Find", "⌕", tab, onTabChange)}
    <Pressable accessibilityRole="button" accessibilityLabel="Start a voice Capture" onPress={onCapture} style={styles.capture}><Text style={styles.captureIcon}>●</Text></Pressable>
    {navItem("digest", "Digest", "☼", tab, onTabChange)}
    {navItem("me", "Me", "◌", tab, onTabChange)}
  </View></ScreenLayout></SafeAreaView>;
}

function navItem(tab: ShellTab, label: string, icon: string, current: ShellTab, onTabChange: (tab: ShellTab) => void) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label}`} accessibilityState={{ selected: current === tab }} onPress={() => onTabChange(tab)} style={styles.navItem}><Text style={[styles.navIcon, current === tab && styles.navActive]}>{icon}</Text><Text style={[styles.navLabel, current === tab && styles.navActive]}>{label}</Text></Pressable>;
}

export function FindSurface() {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Universal search">Find</Heading><View style={styles.search}><Text style={styles.searchIcon}>⌕</Text><Text style={styles.searchPlaceholder}>Search everything</Text></View><View style={styles.chips}><Chip>Tasks</Chip><Chip>Captures</Chip><Chip>Notes</Chip><Chip>Spaces</Chip></View><Card tone="blue"><Text style={styles.cardEyebrow}>TASK</Text><Text style={styles.cardTitle}>Book dentist appointment</Text><Text style={styles.cardDetail}>Personal › Health · next week</Text></Card><Card><Text style={styles.cardEyebrow}>CAPTURE</Text><Text style={styles.cardTitle}>I need to book a dentist appointment…</Text><Text style={styles.cardDetail}>Audio Capture · yesterday</Text></Card></ScrollView>;
}

export function DigestSurface() {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Tuesday, September 15">Your digest</Heading><Card tone="butter"><Text style={styles.cardEyebrow}>YOUR DAY</Text><Text style={styles.cardTitle}>A calm start with one important loop.</Text><Text style={styles.cardDetail}>Book the dentist appointment before lunch.</Text></Card><Text style={styles.sectionTitle}>Open loops</Text><Card><TaskRow title="Prepare Q2 planning" detail="Work · no due date" /></Card><Card tone="lavender"><Text style={styles.cardEyebrow}>CAPTURED YESTERDAY</Text><Text style={styles.cardTitle}>Send project update</Text><Text style={styles.cardDetail}>Needs review</Text></Card></ScrollView>;
}

export function MeSurface() {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Your organization">Library</Heading><Card tone="butter"><Text style={styles.cardTitle}>Spaces</Text><Text style={styles.cardDetail}>Home · Work · Personal › Health</Text></Card><Card tone="lavender"><Text style={styles.cardTitle}>Entities</Text><Text style={styles.cardDetail}>Dentist · Alex · Q2 Planning</Text></Card><Card tone="blue"><Text style={styles.cardTitle}>Tags</Text><Text style={styles.cardDetail}>urgent · errand · waiting</Text></Card></ScrollView>;
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: tokens.colors.background, flex: 1 },
  content: { flex: 1 },
  navigation: { alignItems: "center", backgroundColor: tokens.colors.surface, borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", height: 76, justifyContent: "space-around", paddingHorizontal: 8 },
  navItem: { alignItems: "center", gap: 2, minWidth: 56, paddingVertical: 8 },
  navIcon: { color: tokens.colors.muted, fontSize: 21, fontWeight: "600" },
  navLabel: { color: tokens.colors.muted, fontSize: 11, fontWeight: "600" },
  navActive: { color: tokens.colors.green, fontWeight: "800" },
  capture: { alignItems: "center", backgroundColor: tokens.colors.lime, borderColor: tokens.colors.green, borderRadius: 32, borderWidth: 3, height: 64, justifyContent: "center", marginTop: -25, width: 64 },
  captureIcon: { color: tokens.colors.green, fontSize: 26 },
  surface: { paddingBottom: tokens.spacing.lg },
  search: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, flexDirection: "row", marginHorizontal: tokens.spacing.lg, padding: tokens.spacing.md },
  searchIcon: { color: tokens.colors.ink, fontSize: 24, marginRight: 10 },
  searchPlaceholder: { color: tokens.colors.muted, fontSize: 16 },
  chips: { flexDirection: "row", gap: 8, padding: tokens.spacing.lg },
  cardEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  cardTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: "700", lineHeight: 25 },
  cardDetail: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  sectionTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "800", marginHorizontal: tokens.spacing.lg, marginVertical: 8 },
});
