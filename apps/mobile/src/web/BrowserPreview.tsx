import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppShell, type ShellTab } from "../AppShell";
import { Card, Chip, Heading, TaskRow, tokens } from "../design-system";
import { ReviewScreen } from "../review/ReviewScreen";
import { createReviewFixtureClient } from "../review/review";
import { resetBrowserFixtureData, type BrowserFixtureData, type BrowserFixtureEntity, type BrowserFixtureTag } from "./fixture-data";
import { NoteCard, TaskCard, type CardSaveState } from "./TaskNoteCardPrototype";

type PreviewTab = ShellTab | "review" | "spaces" | "entity" | "tag";

export function BrowserPreview() {
  const [tab, setTab] = useState<PreviewTab>("home");
  const [fixture, setFixture] = useState(resetBrowserFixtureData);
  const [selectedDetail, setSelectedDetail] = useState<string | null>(null);
  const [saveStates, setSaveStates] = useState<Readonly<Record<string, CardSaveState>>>({ "task-02": "pending", "task-03": "error" });
  const [reviewClient] = useState(() => createReviewFixtureClient("note", { kind: "note", id: fixture.notes[0]!.id, content: fixture.notes[0]!.content, reviewState: fixture.notes[0]!.reviewState, version: 0 }));
  const openDetail = (title: string, spaceId: string | undefined, tagIds: readonly string[]) => setSelectedDetail([title, spacePath(fixture, spaceId), ...tagNames(fixture, tagIds).split(" ")].join("\n"));
  const content = tab === "review"
    ? <ReviewScreen apiBaseUrl="http://127.0.0.1:3000" memberId={fixture.memberId} detailUrl="/captures/demo-capture-1/review" client={reviewClient} onBack={() => setTab("home")} />
    : tab === "calendar" ? <CalendarSurface fixture={fixture} saveStates={saveStates} onRetry={(id) => setSaveStates((current) => ({ ...current, [id]: "saved" }))} onPress={(title, spaceId, tagIds) => openDetail(title, spaceId, tagIds)} onComplete={(id) => setFixture((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, status: "completed" } : task) }))} />
    : tab === "find" ? <FindSurface fixture={fixture} />
    : tab === "spaces" ? <SpacesSurface fixture={fixture} />
    : tab === "entity" ? <EntitySurface fixture={fixture} />
    : tab === "tag" ? <TagSurface fixture={fixture} />
    : <HomeSurface fixture={fixture} saveStates={saveStates} onRetry={(id) => setSaveStates((current) => ({ ...current, [id]: "saved" }))} onPress={(title, spaceId, tagIds) => openDetail(title, spaceId, tagIds)} onComplete={(id) => setFixture((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, status: "completed" } : task) }))} />;
  const shellTab: ShellTab = tab === "review" || tab === "spaces" || tab === "entity" || tab === "tag" ? "home" : tab;
  return <View style={styles.root}>
    <View style={styles.notice} accessibilityRole="alert"><Text style={styles.noticeTitle}>AI Assistant · #172 card prototype</Text><Text style={styles.noticeText}>Due-badge cards · in-memory fixtures</Text></View>
    {selectedDetail ? <Pressable accessibilityRole="button" accessibilityLabel="Close detail preview" onPress={() => setSelectedDetail(null)} style={styles.detailBanner}><Text style={styles.detailLabel}>DETAIL PREVIEW</Text><Text style={styles.detailText}>{selectedDetail}</Text><Text style={styles.detailHint}>Tap to close · fixture only</Text></Pressable> : null}
    <AppShell tab={shellTab} onTabChange={setTab} onCapture={() => setTab("review")}><View style={styles.content}>{content}</View></AppShell>
  </View>;
}

interface CardSurfaceProps {
  readonly fixture: BrowserFixtureData;
  readonly saveStates: Readonly<Record<string, CardSaveState>>;
  readonly onPress: (title: string, spaceId: string | undefined, tagIds: readonly string[]) => void;
  readonly onComplete: (id: string) => void;
  readonly onRetry: (id: string) => void;
}
const fixtureToday = "2026-09-15";
const fixtureTimeZone = "Europe/Warsaw";

function HomeSurface({ fixture, saveStates, onPress, onComplete, onRetry }: CardSurfaceProps) {
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="Tuesday, September 15">Good morning</Heading>
    {fixture.tasks.map((task, index) => <View key={task.id}>
      <TaskCard task={task} fixture={fixture} timeZone={fixtureTimeZone} today={fixtureToday} saveState={saveStates[task.id] ?? "saved"} onPress={() => onPress(task.title, task.spaceId, task.tagIds)} onComplete={() => onComplete(task.id)} onRetry={() => onRetry(task.id)} />
      {fixture.notes[index] ? <NoteCard note={fixture.notes[index]} fixture={fixture} onPress={() => onPress(fixture.notes[index]!.content, fixture.notes[index]!.spaceId, fixture.notes[index]!.tagIds)} /> : null}
    </View>)}
  </ScrollView>;
}

function CalendarSurface({ fixture, saveStates, onPress, onComplete, onRetry }: CardSurfaceProps) {
  const scheduled = fixture.tasks.filter((task) => task.dueAt);
  const undated = fixture.tasks.find((task) => !task.dueAt)!;
  return <ScrollView contentContainerStyle={styles.surface}><Heading eyebrow="September 15 — October 15, 2026">Calendar</Heading><Card tone="blue"><Text style={styles.cardEyebrow}>NEXT MONTH</Text><Text style={styles.cardTitle}>{scheduled.length} scheduled Tasks</Text><Text style={styles.cardDetail}>Dense days and quiet gaps are both represented in this fixture.</Text></Card><View style={styles.week}>{scheduled.map((task) => <Chip key={task.id}>{day(task.dueAt)} · {task.title}</Chip>)}<Chip>Sep 17 · No scheduled Tasks</Chip><Chip>Sep 19 · No scheduled Tasks</Chip></View><Text style={styles.sectionTitle}>Agenda</Text>{scheduled.map((task) => <TaskCard key={task.id} task={task} fixture={fixture} timeZone={fixtureTimeZone} today={fixtureToday} saveState={saveStates[task.id] ?? "saved"} onPress={() => onPress(task.title, task.spaceId, task.tagIds)} onComplete={() => onComplete(task.id)} onRetry={() => onRetry(task.id)} />)}<NoteCard note={fixture.notes[1]!} fixture={fixture} onPress={() => onPress(fixture.notes[1]!.content, fixture.notes[1]!.spaceId, fixture.notes[1]!.tagIds)} /><Card tone="orange"><Text style={styles.cardEyebrow}>UNDATED</Text><Text style={styles.cardTitle}>{undated.title}</Text><Text style={styles.cardDetail}>No due date · still visible outside the calendar.</Text></Card></ScrollView>;
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

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.colors.background, flex: 1 }, content: { flex: 1, maxWidth: 760, width: "100%", alignSelf: "center" }, notice: { backgroundColor: tokens.colors.green, paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.sm }, noticeTitle: { color: tokens.colors.lime, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }, noticeText: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, marginTop: 3 }, detailBanner: { backgroundColor: tokens.colors.ink, marginHorizontal: tokens.spacing.lg, padding: tokens.spacing.md }, detailLabel: { color: tokens.colors.lime, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, detailText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginTop: 4 }, detailHint: { color: "#DDE8DE", fontSize: 12, marginTop: 4 }, surface: { paddingBottom: 92 }, cardEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8 }, cardTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: "700", lineHeight: 25 }, cardDetail: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 7 }, sectionTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "800", marginHorizontal: tokens.spacing.lg, marginVertical: 8 }, divider: { backgroundColor: tokens.colors.border, height: 1, marginVertical: 16 }, week: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: tokens.spacing.lg, paddingBottom: tokens.spacing.md }, search: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, flexDirection: "row", marginHorizontal: tokens.spacing.lg, padding: tokens.spacing.md }, searchIcon: { color: tokens.colors.ink, fontSize: 24, marginRight: 10 }, searchPlaceholder: { color: tokens.colors.muted, fontSize: 16 }, treeRow: { flexDirection: "row", gap: 8, marginTop: 14 }, treeMarker: { color: tokens.colors.green, fontSize: 18 }, treeName: { color: tokens.colors.ink, fontSize: 16, fontWeight: "700" }, treeLeaf: { color: tokens.colors.muted, fontSize: 14, marginTop: 6 }, dateOption: { paddingHorizontal: 12, minHeight: 44, justifyContent: "center", borderRadius: 14, backgroundColor: tokens.colors.surface }, dateSelected: { backgroundColor: tokens.colors.green }, metaDate: { color: tokens.colors.ink, fontSize: 13 }, dateSelectedText: { color: "#FFFFFF" },
});
