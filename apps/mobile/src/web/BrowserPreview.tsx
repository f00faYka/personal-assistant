import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card, Chip, Heading, PrimaryButton, TaskRow, tokens } from "../design-system";
import { ReviewScreen } from "../review/ReviewScreen";
import { createReviewFixtureClient } from "../review/review";

type PreviewTab = "home" | "calendar" | "review" | "find";

export function BrowserPreview() {
  const [tab, setTab] = useState<PreviewTab>("home");
  const [reviewClient] = useState(() => createReviewFixtureClient("task"));
  const content = tab === "review"
    ? <ReviewScreen apiBaseUrl="http://127.0.0.1:3000" memberId="member-1" detailUrl="/captures/demo-capture-1/review" client={reviewClient} onBack={() => setTab("home")} />
    : tab === "calendar" ? <CalendarSurface />
    : tab === "find" ? <FindSurface />
    : <HomeSurface onOpenReview={() => setTab("review")} />;

  return <View style={styles.root}>
    <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.noticeTitle}>Browser preview</Text>
      <Text style={styles.noticeText}>Fixture data is shown for UI review. Microphone recording, native storage, and backend actions are disabled.</Text>
    </View>
    <View style={styles.content}>{content}</View>
    <View style={styles.footer} accessibilityLabel="Browser preview navigation">
      {navItem("home", "Home", tab, setTab)}
      {navItem("calendar", "Calendar", tab, setTab)}
      <Pressable accessibilityRole="button" accessibilityLabel="Start a voice Capture" disabled style={styles.capture}><Text style={styles.captureIcon}>●</Text></Pressable>
      {navItem("review", "Review", tab, setTab)}
      {navItem("find", "Find", tab, setTab)}
    </View>
  </View>;
}

function navItem(tab: PreviewTab, label: string, current: PreviewTab, onSelect: (tab: PreviewTab) => void) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label}`} accessibilityState={{ selected: current === tab }} onPress={() => onSelect(tab)} style={styles.navItem}>
    <Text style={[styles.navIcon, current === tab && styles.navActive]}>{tab === "home" ? "⌂" : tab === "calendar" ? "▦" : tab === "review" ? "✓" : "⌕"}</Text>
    <Text style={[styles.navLabel, current === tab && styles.navActive]}>{label}</Text>
  </Pressable>;
}

function HomeSurface({ onOpenReview }: { readonly onOpenReview: () => void }) {
  return <ScrollView contentContainerStyle={styles.surface}>
    <Heading eyebrow="Tuesday, September 15">Good morning</Heading>
    <Card tone="butter"><Text style={styles.cardEyebrow}>TODAY</Text><Text style={styles.cardTitle}>One important loop at a time.</Text><Text style={styles.cardDetail}>You have 2 open Tasks and 1 Capture to review.</Text></Card>
    <Text style={styles.sectionTitle}>Your items</Text>
    <Card><TaskRow title="Book dentist appointment" detail="Personal · due today" /><View style={styles.divider} /><TaskRow title="Prepare Q2 planning" detail="Work · no due date" /></Card>
    <Card tone="lavender"><Text style={styles.cardEyebrow}>CAPTURED YESTERDAY</Text><Text style={styles.cardTitle}>Send project update</Text><Text style={styles.cardDetail}>Needs review · Audio Capture</Text><PrimaryButton label="Open Review" onPress={onOpenReview} /></Card>
  </ScrollView>;
}

function CalendarSurface() {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="September 15, 2026">Calendar</Heading><Card tone="blue"><Text style={styles.cardEyebrow}>TUESDAY</Text><Text style={styles.cardTitle}>Today</Text><Text style={styles.cardDetail}>2 Tasks · 1 scheduled item</Text></Card><View style={styles.week}><Chip>14 Mon</Chip><Chip>15 Tue</Chip><Chip>16 Wed</Chip><Chip>17 Thu</Chip></View><Text style={styles.sectionTitle}>Agenda</Text><Card><TaskRow title="Book dentist appointment" detail="09:30 · Personal" /><View style={styles.divider} /><TaskRow title="Prepare Q2 planning" detail="No due time · Work" /></Card></ScrollView>;
}

function FindSurface() {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Universal search">Find</Heading><View style={styles.search}><Text style={styles.searchIcon}>⌕</Text><Text style={styles.searchPlaceholder}>Search everything</Text></View><View style={styles.week}><Chip>Tasks</Chip><Chip>Captures</Chip><Chip>Notes</Chip><Chip>Spaces</Chip></View><Card tone="blue"><Text style={styles.cardEyebrow}>TASK</Text><Text style={styles.cardTitle}>Book dentist appointment</Text><Text style={styles.cardDetail}>Personal › Health · today</Text></Card><Card><Text style={styles.cardEyebrow}>CAPTURE</Text><Text style={styles.cardTitle}>I need to book a dentist appointment…</Text><Text style={styles.cardDetail}>Audio Capture · yesterday</Text></Card></ScrollView>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.colors.background, flex: 1 },
  content: { flex: 1, maxWidth: 760, width: "100%", alignSelf: "center" },
  notice: { backgroundColor: tokens.colors.green, paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.sm },
  noticeTitle: { color: tokens.colors.lime, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" },
  noticeText: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, marginTop: 3 },
  surface: { paddingBottom: tokens.spacing.lg },
  footer: { alignItems: "center", backgroundColor: tokens.colors.surface, borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", minHeight: 76, paddingHorizontal: 8, width: "100%" },
  navItem: { alignItems: "center", minWidth: 70, paddingVertical: 5 },
  navIcon: { color: tokens.colors.muted, fontSize: 22, lineHeight: 25 },
  navLabel: { color: tokens.colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  navActive: { color: tokens.colors.green },
  capture: { alignItems: "center", backgroundColor: tokens.colors.lime, borderColor: tokens.colors.green, borderRadius: 30, borderWidth: 2, height: 60, justifyContent: "center", marginTop: -28, opacity: 0.55, width: 60 },
  captureIcon: { color: tokens.colors.green, fontSize: 24 },
  cardEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 },
  cardTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: "700", lineHeight: 25 },
  cardDetail: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 },
  sectionTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "800", marginHorizontal: tokens.spacing.lg, marginVertical: 8 },
  divider: { backgroundColor: tokens.colors.border, height: 1, marginVertical: 16 },
  week: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: tokens.spacing.lg, paddingBottom: tokens.spacing.md },
  search: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, flexDirection: "row", marginHorizontal: tokens.spacing.lg, padding: tokens.spacing.md },
  searchIcon: { color: tokens.colors.ink, fontSize: 24, marginRight: 10 },
  searchPlaceholder: { color: tokens.colors.muted, fontSize: 16 },
});
