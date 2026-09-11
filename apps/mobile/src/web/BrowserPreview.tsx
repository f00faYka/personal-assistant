import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card, Chip, Heading, PrimaryButton, TaskRow, tokens } from "../design-system";
import { ReviewScreen } from "../review/ReviewScreen";
import { createReviewFixtureClient } from "../review/review";
import { resetBrowserFixtureData, type BrowserFixtureData, type BrowserFixtureEntity, type BrowserFixtureTag } from "./fixture-data";

type PreviewTab = "home" | "calendar" | "review" | "find" | "spaces" | "entity" | "tag";

export function BrowserPreview() {
  const [tab, setTab] = useState<PreviewTab>("home");
  const fixture = useMemo(resetBrowserFixtureData, []);
  const [reviewClient] = useState(() => createReviewFixtureClient("note", { kind: "note", id: fixture.notes[0]!.id, content: fixture.notes[0]!.content, reviewState: fixture.notes[0]!.reviewState, version: 0 }));
  const content = tab === "review"
    ? <ReviewScreen apiBaseUrl="http://127.0.0.1:3000" memberId={fixture.memberId} detailUrl="/captures/demo-capture-1/review" client={reviewClient} onBack={() => setTab("home")} />
    : tab === "calendar" ? <CalendarSurface fixture={fixture} />
    : tab === "find" ? <FindSurface fixture={fixture} />
    : tab === "spaces" ? <SpacesSurface fixture={fixture} />
    : tab === "entity" ? <EntitySurface fixture={fixture} />
    : tab === "tag" ? <TagSurface fixture={fixture} />
    : <HomeSurface fixture={fixture} onOpenReview={() => setTab("review")} />;
  return <View style={styles.root}>
    <View style={styles.notice} accessibilityRole="alert"><Text style={styles.noticeTitle}>Browser preview · deterministic fixture</Text><Text style={styles.noticeText}>Synthetic data only. Reload this page to reset it; microphone, storage, and backend actions are disabled.</Text></View>
    <View style={styles.content}>{content}</View>
    <ScrollView horizontal contentContainerStyle={styles.footer} accessibilityLabel="Browser preview navigation">
      {(["home", "calendar", "review", "find", "spaces", "entity", "tag"] as const).map((item) => navItem(item, item[0]!.toUpperCase() + item.slice(1), tab, setTab))}
      <Pressable accessibilityRole="button" accessibilityLabel="Start a voice Capture" disabled style={styles.capture}><Text style={styles.captureIcon}>●</Text></Pressable>
    </ScrollView>
  </View>;
}

function navItem(tab: PreviewTab, label: string, current: PreviewTab, onSelect: (tab: PreviewTab) => void) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label}`} accessibilityState={{ selected: current === tab }} onPress={() => onSelect(tab)} style={styles.navItem}><Text style={[styles.navIcon, current === tab && styles.navActive]}>{tab === "home" ? "⌂" : tab === "calendar" ? "▦" : tab === "review" ? "✓" : tab === "find" ? "⌕" : tab === "spaces" ? "▤" : tab === "entity" ? "◉" : "#"}</Text><Text style={[styles.navLabel, current === tab && styles.navActive]}>{label}</Text></Pressable>;
}

function HomeSurface({ fixture, onOpenReview }: { readonly fixture: BrowserFixtureData; readonly onOpenReview: () => void }) {
  const today = fixture.tasks.filter((task) => task.dueAt?.startsWith("2026-09-15"));
  const reviewNote = fixture.notes[0]!;
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Tuesday, September 15">Good morning</Heading><Card tone="butter"><Text style={styles.cardEyebrow}>TODAY</Text><Text style={styles.cardTitle}>One important loop at a time.</Text><Text style={styles.cardDetail}>{today.length} open Tasks · {fixture.notes.filter((note) => note.reviewState === "needs_review").length} Capture to review</Text></Card><Text style={styles.sectionTitle}>Your items</Text><Card>{today.map((task, index) => <View key={task.id}>{index > 0 && <View style={styles.divider} />}<TaskRow title={task.title} detail={`${spacePath(fixture, task.spaceId)} · ${formatTime(task.dueAt)}`} completed={task.status === "completed"} /></View>)}</Card><Card tone="lavender"><Text style={styles.cardEyebrow}>NEEDS REVIEW</Text><Text style={styles.cardTitle}>{reviewNote.content}</Text><Text style={styles.cardDetail}>Audio Capture · {spacePath(fixture, reviewNote.spaceId)}</Text><PrimaryButton label="Open Review" onPress={onOpenReview} /></Card></ScrollView>;
}

function CalendarSurface({ fixture }: { readonly fixture: BrowserFixtureData }) {
  const scheduled = fixture.tasks.filter((task) => task.dueAt);
  const undated = fixture.tasks.find((task) => !task.dueAt)!;
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="September 15 — October 15, 2026">Calendar</Heading><Card tone="blue"><Text style={styles.cardEyebrow}>NEXT MONTH</Text><Text style={styles.cardTitle}>{scheduled.length} scheduled Tasks</Text><Text style={styles.cardDetail}>Dense days and quiet gaps are both represented in this fixture.</Text></Card><View style={styles.week}>{scheduled.map((task) => <Chip key={task.id}>{day(task.dueAt)} · {task.title}</Chip>)}<Chip>Sep 17 · No scheduled Tasks</Chip><Chip>Sep 19 · No scheduled Tasks</Chip></View><Text style={styles.sectionTitle}>Agenda</Text><Card>{scheduled.map((task, index) => <View key={task.id}>{index > 0 && <View style={styles.divider} />}<TaskRow title={task.title} detail={`${day(task.dueAt)} · ${spacePath(fixture, task.spaceId)}`} completed={task.status === "completed"} /></View>)}</Card><Card tone="orange"><Text style={styles.cardEyebrow}>UNDATED</Text><Text style={styles.cardTitle}>{undated.title}</Text><Text style={styles.cardDetail}>No due date · still visible outside the calendar.</Text></Card></ScrollView>;
}

function FindSurface({ fixture }: { readonly fixture: BrowserFixtureData }) {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Universal search">Find</Heading><View style={styles.search}><Text style={styles.searchIcon}>⌕</Text><Text style={styles.searchPlaceholder}>Search everything</Text></View><View style={styles.week}>{fixture.tags.map((tag) => <Chip key={tag.id}>#{tag.name}</Chip>)}<Chip>Spaces</Chip><Chip>Entities</Chip></View>{fixture.tasks.slice(0, 3).map((task) => <Card key={task.id} tone="blue"><Text style={styles.cardEyebrow}>TASK · {task.status.toUpperCase()}</Text><Text style={styles.cardTitle}>{task.title}</Text><Text style={styles.cardDetail}>{spacePath(fixture, task.spaceId)} · {tagNames(fixture, task.tagIds)}</Text></Card>)}</ScrollView>;
}

function SpacesSurface({ fixture }: { readonly fixture: BrowserFixtureData }) {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Structured hierarchy">Spaces</Heading>{fixture.spaces.filter((space) => !space.parentId).map((root) => <Card key={root.id}><Text style={styles.cardTitle}>{root.name}</Text>{fixture.spaces.filter((space) => space.parentId === root.id).map((child) => <View key={child.id} style={styles.treeRow}><Text style={styles.treeMarker}>↳</Text><View><Text style={styles.treeName}>{child.name}</Text>{fixture.spaces.filter((space) => space.parentId === child.id).map((leaf) => <Text key={leaf.id} style={styles.treeLeaf}>↳ {leaf.name}</Text>)}</View></View>)}</Card>)}</ScrollView>;
}

function EntitySurface({ fixture }: { readonly fixture: BrowserFixtureData }) { return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Alternate views">Entities</Heading>{fixture.entities.map((entity) => <MetadataSurface key={entity.id} fixture={fixture} title="Entity" eyebrow={entity.type} resource={entity} items={fixture.tasks.filter((task) => task.entityIds.includes(entity.id))} />)}</ScrollView>; }
function TagSurface({ fixture }: { readonly fixture: BrowserFixtureData }) { return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Cross-cutting views">Tags</Heading>{fixture.tags.map((tag) => <MetadataSurface key={tag.id} fixture={fixture} title="Tag" eyebrow="Flat marker" resource={tag} items={fixture.tasks.filter((task) => task.tagIds.includes(tag.id))} />)}</ScrollView>; }
function MetadataSurface({ fixture, title, eyebrow, resource, items }: { readonly fixture: BrowserFixtureData; readonly title: string; readonly eyebrow: string; readonly resource: BrowserFixtureEntity | BrowserFixtureTag; readonly items: BrowserFixtureData["tasks"] }) {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow={eyebrow}>{title}</Heading><Card tone="lavender"><Text style={styles.cardEyebrow}>{"type" in resource ? resource.type : "TAG"}</Text><Text style={styles.cardTitle}>{resource.name}</Text><Text style={styles.cardDetail}>{items.length} linked Tasks</Text></Card><Text style={styles.sectionTitle}>Linked Tasks</Text><Card>{items.map((task, index) => <View key={task.id}>{index > 0 && <View style={styles.divider} />}<TaskRow title={task.title} detail={spacePath(fixture, task.spaceId)} completed={task.status === "completed"} /></View>)}</Card></ScrollView>;
}

function spacePath(fixture: BrowserFixtureData, id?: string): string { const names: string[] = []; let current = fixture.spaces.find((space) => space.id === id); while (current) { names.unshift(current.name); current = fixture.spaces.find((space) => space.id === current?.parentId); } return names.join(" › ") || "Unassigned"; }
function tagNames(fixture: BrowserFixtureData, ids: readonly string[]): string { return ids.map((id) => `#${fixture.tags.find((tag) => tag.id === id)?.name ?? id}`).join(" ") || "No tags"; }
function day(value?: string): string { return value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "Undated"; }
function formatTime(value?: string): string { return value ? new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "no due time"; }

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.colors.background, flex: 1 }, content: { flex: 1, maxWidth: 760, width: "100%", alignSelf: "center" }, notice: { backgroundColor: tokens.colors.green, paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.sm }, noticeTitle: { color: tokens.colors.lime, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }, noticeText: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, marginTop: 3 }, surface: { paddingBottom: tokens.spacing.lg }, footer: { alignItems: "center", backgroundColor: tokens.colors.surface, borderTopColor: tokens.colors.border, borderTopWidth: 1, minHeight: 76, paddingHorizontal: 8 }, navItem: { alignItems: "center", minWidth: 70, paddingVertical: 5 }, navIcon: { color: tokens.colors.muted, fontSize: 22, lineHeight: 25 }, navLabel: { color: tokens.colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 }, navActive: { color: tokens.colors.green }, capture: { alignItems: "center", backgroundColor: tokens.colors.lime, borderColor: tokens.colors.green, borderRadius: 30, borderWidth: 2, height: 60, justifyContent: "center", marginHorizontal: 10, marginTop: -28, opacity: 0.55, width: 60 }, captureIcon: { color: tokens.colors.green, fontSize: 24 }, cardEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 }, cardTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: "700", lineHeight: 25 }, cardDetail: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 }, sectionTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "800", marginHorizontal: tokens.spacing.lg, marginVertical: 8 }, divider: { backgroundColor: tokens.colors.border, height: 1, marginVertical: 16 }, week: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: tokens.spacing.lg, paddingBottom: tokens.spacing.md }, search: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, flexDirection: "row", marginHorizontal: tokens.spacing.lg, padding: tokens.spacing.md }, searchIcon: { color: tokens.colors.ink, fontSize: 24, marginRight: 10 }, searchPlaceholder: { color: tokens.colors.muted, fontSize: 16 }, treeRow: { flexDirection: "row", gap: 8, marginTop: 14 }, treeMarker: { color: tokens.colors.green, fontSize: 18 }, treeName: { color: tokens.colors.ink, fontSize: 16, fontWeight: "700" }, treeLeaf: { color: tokens.colors.muted, fontSize: 14, marginTop: 6 },
});
