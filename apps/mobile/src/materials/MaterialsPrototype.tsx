/**
 * Throwaway prototype for #155.
 *
 * Question: can a Member browse a mixed Task/Note collection, understand its
 * Space hierarchy, reveal search when needed, and return from an item without
 * learning organization administration first?
 *
 * This screen is fixture-only. It compares three Materials compositions with
 * deterministic in-memory data; it does not call the API or perform writes.
 */
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ReactNode } from "react";

import { localDateKey } from "../day/selected-day";
import { tokens } from "../design-system";
import { NoteCard, TaskCard, type NoteCardData, type TaskCardData } from "../web/TaskNoteCardPrototype";

type VariantKey = "A" | "B" | "C" | "D";
type CombinedMode = "flat" | "spaces";
type ScenarioKey = "mixed" | "empty" | "hierarchy" | "retrieval" | "long" | "search" | "pagination";
type FilterKey = "Task" | "Note" | "Needs review" | "No Space" | "Work";

type PrototypeMaterial =
  | { readonly kind: "task"; readonly task: TaskCardData; readonly spaceId?: string }
  | { readonly kind: "note"; readonly note: NoteCardData; readonly spaceId?: string };

interface PrototypeSpace {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly parentId?: string;
}

interface PrototypeScenario {
  readonly key: ScenarioKey;
  readonly label: string;
  readonly description: string;
  readonly items: readonly PrototypeMaterial[];
  readonly spaces: readonly PrototypeSpace[];
  readonly remainingItems?: readonly PrototypeMaterial[];
  readonly initialQuery?: string;
  readonly initialFilters?: readonly FilterKey[];
}

const variantNames: Record<VariantKey, string> = {
  A: "Flat list",
  B: "Space tree",
  C: "Context first",
  D: "Flat + Spaces",
};

const scenarioLabels: Record<ScenarioKey, string> = {
  mixed: "Mixed",
  empty: "Empty",
  hierarchy: "Nested Spaces",
  retrieval: "Retrieval edges",
  long: "Long list",
  search: "Search + filters",
  pagination: "Page failure",
};

const baseSpaces: readonly PrototypeSpace[] = [
  { id: "home", name: "Home", path: "Home" },
  { id: "health-home", name: "Health", path: "Home / Health", parentId: "home" },
  { id: "work", name: "Work", path: "Work" },
  { id: "planning", name: "Planning", path: "Work / Planning", parentId: "work" },
  { id: "launch", name: "Launch week", path: "Work / Planning / Launch week", parentId: "planning" },
  { id: "travel", name: "Travel", path: "Travel" },
  { id: "personal", name: "Personal", path: "Personal" },
  { id: "health-personal", name: "Health", path: "Personal / Health", parentId: "personal" },
];

const baseItems: readonly PrototypeMaterial[] = [
  { kind: "task", spaceId: "health-home", task: { id: "task-dentist", title: "Book dentist appointment", dueAt: "2026-09-15T09:30:00.000Z", status: "open", space: "Home / Health", tags: ["errand", "urgent"] } },
  { kind: "note", spaceId: "launch", note: { id: "note-handoff", content: "Ask Alex about the launch hand-off", reviewState: "needs_review", space: "Work / Planning / Launch week", tags: ["waiting"] } },
  { kind: "task", spaceId: "planning", task: { id: "task-planning", title: "Prepare Q2 planning", dueAt: "2026-10-03T13:00:00.000Z", status: "open", space: "Work / Planning", tags: ["planning"] } },
  { kind: "note", spaceId: "home", note: { id: "note-studio", content: "Ideas for making the studio calmer", reviewState: "none", space: "Home", tags: [] } },
  { kind: "task", spaceId: "launch", task: { id: "task-update", title: "Send project update", dueAt: "2026-09-18T16:00:00.000Z", status: "open", space: "Work / Planning / Launch week", tags: ["waiting", "planning"] } },
  { kind: "task", spaceId: "travel", task: { id: "task-hotel", title: "Confirm hotel booking", dueAt: "2026-10-04T14:00:00.000Z", status: "completed", space: "Travel", tags: ["waiting"] } },
  { kind: "task", task: { id: "task-receipts", title: "Clean up receipts", status: "open", tags: [] } },
  { kind: "task", spaceId: "home", task: { id: "task-cable", title: "Buy studio cable", dueAt: "2026-10-08T11:00:00.000Z", status: "open", space: "Home", tags: ["errand"] } },
];

export function MaterialsPrototype({ timeZone }: { readonly timeZone: string }) {
  const [variant, setVariant] = useState<VariantKey>("D");
  const [combinedMode, setCombinedMode] = useState<CombinedMode>("flat");
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("mixed");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<readonly FilterKey[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<PrototypeMaterial | null>(null);
  const [paginationRecovered, setPaginationRecovered] = useState(false);

  const scenario = useMemo(() => createScenario(scenarioKey, paginationRecovered), [paginationRecovered, scenarioKey]);
  const effectiveQuery = query;
  const effectiveFilters = filters;
  const visibleItems = useMemo(() => scenario.items
    .concat(scenario.remainingItems && paginationRecovered ? scenario.remainingItems : [])
    .filter((item) => matchesFilters(item, effectiveQuery, effectiveFilters, scenario.spaces, selectedSpaceId)),
  [effectiveFilters, effectiveQuery, scenario.items, scenario.remainingItems, scenario.spaces, selectedSpaceId]);

  const chooseScenario = (next: ScenarioKey) => {
    const nextScenario = createScenario(next, false);
    setScenarioKey(next);
    setSearchOpen(false);
    setQuery(nextScenario.initialQuery ?? "");
    setFilters(nextScenario.initialFilters ?? []);
    setSelectedSpaceId(null);
    setSelectedItem(null);
    setPaginationRecovered(false);
  };

  const chooseVariant = (next: VariantKey) => {
    setVariant(next);
    if (next === "D") setCombinedMode("flat");
    setSelectedItem(null);
  };

  const toggleFilter = (filter: FilterKey) => {
    setFilters((current) => current.includes(filter) ? current.filter((value) => value !== filter) : [...current, filter]);
  };

  const commonProps = {
    effectiveFilters,
    effectiveQuery,
    onOpenSearch: () => setSearchOpen((open) => !open),
    onChooseScenario: chooseScenario,
    onQueryChange: setQuery,
    onToggleFilter: toggleFilter,
    onSelectItem: setSelectedItem,
    onSelectSpace: setSelectedSpaceId,
    selectedSpaceId,
    searchOpen,
    spaces: scenario.spaces,
    timeZone,
    visibleItems,
  };

  return <View style={styles.root}>
    {variant === "A" ? <FlatListVariant scenario={scenario} {...commonProps} /> : null}
    {variant === "B" ? <SpaceTreeVariant scenario={scenario} {...commonProps} /> : null}
    {variant === "C" ? <ContextFirstVariant scenario={scenario} {...commonProps} /> : null}
    {variant === "D" ? <CombinedBrowseVariant mode={combinedMode} onModeChange={setCombinedMode} scenario={scenario} {...commonProps} /> : null}
    {selectedItem ? <ItemDetailStub item={selectedItem} onBack={() => setSelectedItem(null)} /> : null}
    {scenarioKey === "pagination" && !paginationRecovered ? <View style={styles.paginationBanner}>
      <Text style={styles.paginationText}>More materials are available, but the next page failed.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry loading next Materials page" onPress={() => setPaginationRecovered(true)}><Text style={styles.retryText}>Retry page</Text></Pressable>
    </View> : null}
    <PrototypeSwitcher variant={variant} onChange={chooseVariant} />
  </View>;
}

function FlatListVariant(props: VariantProps) {
  const { visibleItems, onSelectItem, timeZone } = props;
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <PrototypeHeader title="Materials" subtitle="Everything together, with organization revealed only when useful." {...props} />
    <View style={styles.summaryRow}><Text style={styles.summaryStrong}>{visibleItems.length} materials</Text><Text style={styles.summaryMuted}>Flat mixed list</Text></View>
    {visibleItems.length === 0 ? <EmptyState /> : visibleItems.map((item) => <MaterialCard key={materialId(item)} item={item} onPress={() => onSelectItem(item)} timeZone={timeZone} />)}
  </ScrollView>;
}

function SpaceTreeVariant(props: VariantProps) {
  const { scenario, selectedSpaceId, onSelectSpace, visibleItems, onSelectItem, timeZone } = props;
  const selectedSpace = scenario.spaces.find((space) => space.id === selectedSpaceId);
  const children = scenario.spaces.filter((space) => selectedSpaceId === null ? space.parentId === undefined : space.parentId === selectedSpaceId);
  const directItems = visibleItems.filter((item) => item.spaceId === selectedSpaceId || (selectedSpaceId === null && item.spaceId === undefined));
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <PrototypeHeader title="Materials" subtitle="Browse the collection as a hierarchy, then open the items in one Space." {...props} />
    <View style={styles.breadcrumb}><Text style={styles.breadcrumbLabel}>Space</Text><Text style={styles.breadcrumbPath}>{selectedSpace?.path ?? "All Spaces"}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Select all Materials" onPress={() => onSelectSpace(null)} style={[styles.treeRow, selectedSpaceId === null && styles.treeRowActive]}><Text style={styles.treeGlyph}>⌂</Text><View><Text style={styles.treeName}>All Spaces</Text><Text style={styles.treeHint}>Every Space and unassigned material</Text></View></Pressable>
    {children.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Open Space ${space.path}`} onPress={() => onSelectSpace(space.id)} style={[styles.treeRow, selectedSpaceId === space.id && styles.treeRowActive]}><Text style={styles.treeGlyph}>{space.parentId ? "↳" : "◌"}</Text><View><Text style={styles.treeName}>{space.name}</Text><Text style={styles.treeHint}>{space.path}</Text></View><Text style={styles.treeChevron}>›</Text></Pressable>)}
    {selectedSpaceId !== null && children.length === 0 ? <Text style={styles.noChildren}>No child Spaces</Text> : null}
    <Text style={styles.sectionTitle}>{selectedSpace ? selectedSpace.name : "Unassigned + all Spaces"}</Text>
    {directItems.length === 0 ? <EmptyState label={selectedSpace ? "No direct materials in this Space" : "No unassigned materials"} /> : directItems.map((item) => <MaterialCard key={materialId(item)} item={item} onPress={() => onSelectItem(item)} timeZone={timeZone} />)}
  </ScrollView>;
}

function ContextFirstVariant(props: VariantProps) {
  const { scenario, selectedSpaceId, onSelectSpace, visibleItems, onSelectItem, timeZone } = props;
  const contextItems = selectedSpaceId === null ? visibleItems : visibleItems.filter((item) => item.spaceId === selectedSpaceId);
  const selectedSpace = scenario.spaces.find((space) => space.id === selectedSpaceId);
  const attention = contextItems.filter((item) => item.kind === "note" && item.note.reviewState === "needs_review" || item.kind === "task" && item.task.status === "open").slice(0, 3);
  const rest = contextItems.filter((item) => !attention.includes(item));
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <PrototypeHeader title="Materials" subtitle="Choose the context first; the collection follows your current place." {...props} />
    <View style={styles.contextHero}><Text style={styles.contextEyebrow}>CURRENT CONTEXT</Text><Text style={styles.contextTitle}>{selectedSpace?.path ?? "Everywhere"}</Text><Text style={styles.contextDescription}>{contextItems.length} materials · paths stay visible when you scan.</Text></View>
    <Text style={styles.sectionTitle}>Choose a Space</Text>
    <View style={styles.contextPicker}>
      <ContextChoice active={selectedSpaceId === null} label="Everywhere" detail="All materials" onPress={() => onSelectSpace(null)} />
      {scenario.spaces.filter((space) => !space.parentId).map((space) => <ContextChoice key={space.id} active={selectedSpaceId === space.id} label={space.name} detail={space.path} onPress={() => onSelectSpace(space.id)} />)}
      <ContextChoice active={props.effectiveFilters.includes("No Space")} label="No Space" detail="Unassigned" onPress={() => props.onToggleFilter("No Space")} />
    </View>
    <Text style={styles.sectionTitle}>Needs attention</Text>
    {attention.length === 0 ? <Text style={styles.sectionHint}>Nothing needs attention in this context.</Text> : attention.map((item) => <MaterialCard key={materialId(item)} item={item} onPress={() => onSelectItem(item)} timeZone={timeZone} />)}
    {rest.length > 0 ? <Text style={styles.sectionTitle}>Everything else</Text> : null}
    {rest.map((item) => <MaterialCard key={materialId(item)} item={item} onPress={() => onSelectItem(item)} timeZone={timeZone} />)}
  </ScrollView>;
}

function CombinedBrowseVariant(props: VariantProps & { readonly mode: CombinedMode; readonly onModeChange: (mode: CombinedMode) => void }) {
  const { mode, onModeChange, scenario, selectedSpaceId, onSelectSpace, visibleItems, onSelectItem, timeZone } = props;
  const selectedSpace = scenario.spaces.find((space) => space.id === selectedSpaceId);
  const children = scenario.spaces.filter((space) => selectedSpaceId === null ? space.parentId === undefined : space.parentId === selectedSpaceId);
  const directItems = visibleItems.filter((item) => item.spaceId === selectedSpaceId || (selectedSpaceId === null && item.spaceId === undefined));
  const changeMode = (next: CombinedMode) => {
    onModeChange(next);
    if (next === "flat") onSelectSpace(null);
  };
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <PrototypeHeader
      title="Materials"
      subtitle="One destination with a quick choice between a flat uncategorized list and Space browsing."
      topContent={<BrowseModeTabs mode={mode} onChange={changeMode} />}
      {...props}
    />
    {mode === "flat" ? <>
      <View style={styles.combinedSummary}><View><Text style={styles.summaryStrong}>{visibleItems.length} materials</Text><Text style={styles.combinedSummaryHint}>Flat · no grouping</Text></View><Text style={styles.combinedSummarySide}>Space paths stay on each card</Text></View>
      {visibleItems.length === 0 ? <EmptyState /> : visibleItems.map((item) => <MaterialCard key={materialId(item)} item={item} onPress={() => onSelectItem(item)} timeZone={timeZone} />)}
    </> : <>
      <View style={styles.breadcrumb}><Text style={styles.breadcrumbLabel}>SPACE VIEW</Text><Text style={styles.breadcrumbPath}>{selectedSpace?.path ?? "All Spaces"}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Select all Materials" onPress={() => onSelectSpace(null)} style={[styles.treeRow, selectedSpaceId === null && styles.treeRowActive]}><Text style={styles.treeGlyph}>⌂</Text><View><Text style={styles.treeName}>All Spaces</Text><Text style={styles.treeHint}>Every Space and unassigned material</Text></View></Pressable>
      {children.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Open Space ${space.path}`} onPress={() => onSelectSpace(space.id)} style={[styles.treeRow, selectedSpaceId === space.id && styles.treeRowActive]}><Text style={styles.treeGlyph}>{space.parentId ? "↳" : "◌"}</Text><View><Text style={styles.treeName}>{space.name}</Text><Text style={styles.treeHint}>{space.path}</Text></View><Text style={styles.treeChevron}>›</Text></Pressable>)}
      <Text style={styles.sectionTitle}>{selectedSpace ? selectedSpace.name : "Unassigned"}</Text>
      {directItems.length === 0 ? <EmptyState label={selectedSpace ? "No direct materials in this Space" : "No unassigned materials"} /> : directItems.map((item) => <MaterialCard key={materialId(item)} item={item} onPress={() => onSelectItem(item)} timeZone={timeZone} />)}
    </>}
  </ScrollView>;
}

function BrowseModeTabs({ mode, onChange }: { readonly mode: CombinedMode; readonly onChange: (mode: CombinedMode) => void }) {
  return <View accessibilityLabel="Materials view switcher" style={styles.modeTabs}>
    <Pressable accessibilityRole="tab" accessibilityLabel="View all Materials flat" accessibilityState={{ selected: mode === "flat" }} onPress={() => onChange("flat")} style={[styles.modeTab, mode === "flat" && styles.modeTabActive]}><Text style={[styles.modeTabText, mode === "flat" && styles.modeTabTextActive]}>All materials</Text><Text style={[styles.modeTabHint, mode === "flat" && styles.modeTabHintActive]}>Flat · uncategorized</Text></Pressable>
    <Pressable accessibilityRole="tab" accessibilityLabel="View Materials by Space" accessibilityState={{ selected: mode === "spaces" }} onPress={() => onChange("spaces")} style={[styles.modeTab, mode === "spaces" && styles.modeTabActive]}><Text style={[styles.modeTabText, mode === "spaces" && styles.modeTabTextActive]}>By Spaces</Text><Text style={[styles.modeTabHint, mode === "spaces" && styles.modeTabHintActive]}>Tree · paths</Text></Pressable>
  </View>;
}

interface VariantProps {
  readonly scenario: PrototypeScenario;
  readonly visibleItems: readonly PrototypeMaterial[];
  readonly spaces: readonly PrototypeSpace[];
  readonly selectedSpaceId: string | null;
  readonly searchOpen: boolean;
  readonly effectiveQuery: string;
  readonly effectiveFilters: readonly FilterKey[];
  readonly timeZone: string;
  readonly onSelectSpace: (id: string | null) => void;
  readonly onSelectItem: (item: PrototypeMaterial) => void;
  readonly onOpenSearch: () => void;
  readonly onChooseScenario: (scenario: ScenarioKey) => void;
  readonly onQueryChange: (value: string) => void;
  readonly onToggleFilter: (filter: FilterKey) => void;
}

function PrototypeHeader({ title, subtitle, topContent, scenario, searchOpen, effectiveQuery, effectiveFilters, onChooseScenario, onOpenSearch, onQueryChange, onToggleFilter }: VariantProps & { readonly title: string; readonly subtitle: string; readonly topContent?: ReactNode }) {
  return <>
    <View style={styles.prototypeBadge}><Text style={styles.prototypeBadgeText}>#155 · PROTOTYPE ONLY</Text></View>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.subtitle}>{subtitle}</Text>
    {topContent}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scenarioRail}>
      {(Object.keys(scenarioLabels) as ScenarioKey[]).map((key) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Fixture ${scenarioLabels[key]}`} onPress={() => onChooseScenario(key)} style={styles.scenarioChip}><Text style={styles.scenarioChipText}>{key === scenario.key ? `● ${scenarioLabels[key]}` : scenarioLabels[key]}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.scenarioNote}><Text style={styles.scenarioNoteText}>{scenario.description}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={searchOpen ? "Hide search and filters" : "Reveal search and filters"} onPress={onOpenSearch} style={styles.searchToggle}><Text style={styles.searchToggleText}>{searchOpen ? "Hide search" : "Reveal search"} · {effectiveQuery || "No query"}</Text><Text style={styles.searchToggleIcon}>{searchOpen ? "⌃" : "⌄"}</Text></Pressable>
    {searchOpen ? <View style={styles.searchPanel}><TextInput accessibilityLabel="Materials search" value={effectiveQuery} onChangeText={onQueryChange} placeholder="Search Tasks and Notes" placeholderTextColor={tokens.colors.muted} style={styles.searchInput} /><View style={styles.filterRail}>{(["Task", "Note", "Needs review", "No Space", "Work"] as FilterKey[]).map((filter) => <Pressable key={filter} accessibilityRole="button" accessibilityLabel={`Filter Materials by ${filter}`} onPress={() => onToggleFilter(filter)} style={[styles.filterChip, effectiveFilters.includes(filter) && styles.filterChipActive]}><Text style={[styles.filterText, effectiveFilters.includes(filter) && styles.filterTextActive]}>{filter}</Text></Pressable>)}</View></View> : null}
  </>;
}

function MaterialCard({ item, onPress, timeZone }: { readonly item: PrototypeMaterial; readonly onPress: () => void; readonly timeZone: string }) {
  const today = localDateKey(new Date(), timeZone);
  return item.kind === "task" ? <TaskCard task={item.task} timeZone={timeZone} today={today} onPress={onPress} /> : <NoteCard note={item.note} onPress={onPress} />;
}

function ContextChoice({ active, label, detail, onPress }: { readonly active: boolean; readonly label: string; readonly detail: string; readonly onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Choose Materials context ${label}`} onPress={onPress} style={[styles.contextChoice, active && styles.contextChoiceActive]}><Text style={[styles.contextChoiceLabel, active && styles.contextChoiceLabelActive]}>{label}</Text><Text style={styles.contextChoiceDetail}>{detail}</Text></Pressable>;
}

function ItemDetailStub({ item, onBack }: { readonly item: PrototypeMaterial; readonly onBack: () => void }) {
  const title = item.kind === "task" ? item.task.title : item.note.content;
  const space = item.kind === "task" ? item.task.space : item.note.space;
  return <View style={styles.detailStub}><Text style={styles.detailEyebrow}>EXISTING DETAIL DESTINATION · STUB</Text><Text style={styles.detailTitle}>{title}</Text><Text style={styles.detailText}>The chosen Materials view stays behind this detail. Returning keeps the selected Space, query and scroll context in the prototype.</Text><Text style={styles.detailPath}>Path: {space ?? "No Space"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Back to Materials" onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>Back to Materials</Text></Pressable></View>;
}

function EmptyState({ label = "Nothing matches this view" }: { readonly label?: string }) {
  return <View style={styles.empty}><Text style={styles.emptyTitle}>{label}</Text><Text style={styles.emptyText}>The collection remains a valid destination even when there are no materials to show.</Text></View>;
}

function PrototypeSwitcher({ variant, onChange }: { readonly variant: VariantKey; readonly onChange: (variant: VariantKey) => void }) {
  const keys: readonly VariantKey[] = ["A", "B", "C", "D"];
  const index = keys.indexOf(variant);
  const previous = keys[(index + keys.length - 1) % keys.length]!;
  const next = keys[(index + 1) % keys.length]!;
  return <View style={styles.switcher}><Pressable accessibilityRole="button" accessibilityLabel="Previous Materials prototype" onPress={() => onChange(previous)} style={styles.switcherButton}><Text style={styles.switcherArrow}>‹</Text></Pressable><View style={styles.switcherLabel}><Text style={styles.switcherKey}>{variant} · {variantNames[variant]}</Text><Text style={styles.switcherHint}>Change composition</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Next Materials prototype" onPress={() => onChange(next)} style={styles.switcherButton}><Text style={styles.switcherArrow}>›</Text></Pressable></View>;
}

function matchesFilters(item: PrototypeMaterial, query: string, filters: readonly FilterKey[], spaces: readonly PrototypeSpace[], selectedSpaceId: string | null): boolean {
  const text = item.kind === "task" ? item.task.title : item.note.content;
  const spaceId = item.spaceId;
  const space = spaceId ? spaces.find((candidate) => candidate.id === spaceId) : undefined;
  if (query && !text.toLowerCase().includes(query.toLowerCase())) return false;
  const kindFilters = filters.filter((filter): filter is "Task" | "Note" => filter === "Task" || filter === "Note");
  if (kindFilters.length > 0 && !kindFilters.some((filter) => filter === (item.kind === "task" ? "Task" : "Note"))) return false;
  if (filters.includes("Needs review") && !(item.kind === "note" && item.note.reviewState === "needs_review")) return false;
  if (filters.includes("No Space") && spaceId !== undefined) return false;
  if (filters.includes("Work") && !space?.path.startsWith("Work")) return false;
  if (selectedSpaceId !== null && spaceId !== selectedSpaceId) return false;
  return true;
}

function materialId(item: PrototypeMaterial): string { return item.kind === "task" ? item.task.id : item.note.id; }

function createScenario(key: ScenarioKey, paginationRecovered: boolean): PrototypeScenario {
  const common = { key, label: scenarioLabels[key], spaces: baseSpaces };
  if (key === "empty") return { ...common, description: "Empty collection: does the destination still explain where the Member is?", items: [] };
  if (key === "hierarchy") return { ...common, description: "Nested and same-named Spaces: can the path disambiguate Health under Home versus Personal?", items: baseItems, spaces: baseSpaces };
  if (key === "retrieval") return { ...common, description: "Retrieval edges: undated, overdue, completed and unassigned materials must remain findable.", items: baseItems };
  if (key === "long") return { ...common, description: "Long list: scan density and the discoverability of search should survive a full collection.", items: Array.from({ length: 24 }, (_, index) => cloneMaterial(baseItems[index % baseItems.length]!, index)) };
  if (key === "search") return { ...common, description: "Search is progressive disclosure inside Materials, not a second Find destination.", items: baseItems, initialQuery: "launch", initialFilters: ["Task", "Note"] };
  if (key === "pagination") {
    return paginationRecovered
      ? { ...common, description: "The failed page recovered: the list appends the remaining materials without changing the browsing context.", items: baseItems }
      : { ...common, description: "Pagination failure: loaded materials stay visible and the failed next page has an explicit retry.", items: baseItems.slice(0, 4), remainingItems: baseItems.slice(4) };
  }
  return { ...common, description: "Mixed collection: Tasks and Notes stay distinct while Space paths remain scannable.", items: baseItems };
}

function cloneMaterial(item: PrototypeMaterial, index: number): PrototypeMaterial {
  if (item.kind === "task") return { ...item, task: { ...item.task, id: `${item.task.id}-${index}`, title: `${item.task.title} · copy ${index + 1}` } };
  return { ...item, note: { ...item.note, id: `${item.note.id}-${index}`, content: `${item.note.content} · follow-up ${index + 1}` } };
}

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.colors.background, flex: 1 },
  scrollContent: { paddingBottom: 112 },
  prototypeBadge: { alignSelf: "flex-start", backgroundColor: tokens.colors.green, borderRadius: tokens.radius.pill, marginHorizontal: tokens.spacing.lg, marginTop: tokens.spacing.lg, paddingHorizontal: 10, paddingVertical: 6 },
  prototypeBadgeText: { color: tokens.colors.lime, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  title: { color: tokens.colors.ink, fontSize: 34, fontWeight: "800", marginHorizontal: tokens.spacing.lg, marginTop: 14 },
  subtitle: { color: tokens.colors.muted, fontSize: 15, lineHeight: 22, marginHorizontal: tokens.spacing.lg, marginTop: 8 },
  scenarioRail: { gap: 8, paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.md },
  scenarioChip: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.pill, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  scenarioChipText: { color: tokens.colors.green, fontSize: 12, fontWeight: "700" },
  scenarioNote: { backgroundColor: tokens.colors.butter, borderRadius: tokens.radius.control, marginHorizontal: tokens.spacing.lg, padding: 12 },
  scenarioNoteText: { color: tokens.colors.ink, fontSize: 13, lineHeight: 18 },
  searchToggle: { alignItems: "center", borderBottomColor: tokens.colors.border, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", marginHorizontal: tokens.spacing.lg, paddingVertical: 15 },
  searchToggleText: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" },
  searchToggleIcon: { color: tokens.colors.green, fontSize: 18 },
  searchPanel: { backgroundColor: tokens.colors.surface, marginHorizontal: tokens.spacing.lg, padding: 12 },
  searchInput: { borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, color: tokens.colors.ink, fontSize: 16, padding: 12 },
  filterRail: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  filterChip: { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, borderRadius: tokens.radius.pill, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  filterChipActive: { backgroundColor: tokens.colors.green, borderColor: tokens.colors.green },
  filterText: { color: tokens.colors.muted, fontSize: 12, fontWeight: "700" },
  filterTextActive: { color: "#FFFFFF" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginHorizontal: tokens.spacing.lg, paddingVertical: 16 },
  summaryStrong: { color: tokens.colors.ink, fontSize: 15, fontWeight: "800" },
  summaryMuted: { color: tokens.colors.muted, fontSize: 14 },
  combinedSummary: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginHorizontal: tokens.spacing.lg, paddingVertical: 16 },
  combinedSummaryHint: { color: tokens.colors.muted, fontSize: 12, marginTop: 3 },
  combinedSummarySide: { color: tokens.colors.muted, flexShrink: 1, fontSize: 13, marginLeft: 12, maxWidth: 150, textAlign: "right" },
  modeTabs: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, flexDirection: "row", marginHorizontal: tokens.spacing.lg, marginTop: tokens.spacing.md, padding: 4 },
  modeTab: { borderRadius: 10, flex: 1, paddingHorizontal: 10, paddingVertical: 10 },
  modeTabActive: { backgroundColor: tokens.colors.green },
  modeTabText: { color: tokens.colors.green, fontSize: 14, fontWeight: "800", textAlign: "center" },
  modeTabTextActive: { color: "#FFFFFF" },
  modeTabHint: { color: tokens.colors.muted, fontSize: 11, marginTop: 3, textAlign: "center" },
  modeTabHintActive: { color: "#DDE8D8" },
  breadcrumb: { backgroundColor: tokens.colors.surface, borderRadius: tokens.radius.card, margin: tokens.spacing.lg, padding: tokens.spacing.md },
  breadcrumbLabel: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.1, textTransform: "uppercase" },
  breadcrumbPath: { color: tokens.colors.ink, fontSize: 19, fontWeight: "800", marginTop: 5 },
  treeRow: { alignItems: "center", borderBottomColor: tokens.colors.border, borderBottomWidth: 1, flexDirection: "row", gap: 12, marginHorizontal: tokens.spacing.lg, minHeight: 62, paddingVertical: 10 },
  treeRowActive: { backgroundColor: "rgba(217,242,106,0.35)", borderRadius: tokens.radius.control, paddingHorizontal: 10 },
  treeGlyph: { color: tokens.colors.green, fontSize: 20, width: 24 },
  treeName: { color: tokens.colors.ink, fontSize: 16, fontWeight: "800" },
  treeHint: { color: tokens.colors.muted, fontSize: 12, marginTop: 3 },
  treeChevron: { color: tokens.colors.muted, fontSize: 26, marginLeft: "auto" },
  noChildren: { color: tokens.colors.muted, fontSize: 13, marginHorizontal: tokens.spacing.lg, marginTop: 12 },
  sectionTitle: { color: tokens.colors.ink, fontSize: 19, fontWeight: "800", marginHorizontal: tokens.spacing.lg, marginTop: 20, marginBottom: 10 },
  sectionHint: { color: tokens.colors.muted, fontSize: 14, marginHorizontal: tokens.spacing.lg },
  contextHero: { backgroundColor: tokens.colors.green, borderRadius: tokens.radius.card, margin: tokens.spacing.lg, padding: tokens.spacing.lg },
  contextEyebrow: { color: tokens.colors.lime, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  contextTitle: { color: "#FFFFFF", fontSize: 28, fontWeight: "800", marginTop: 7 },
  contextDescription: { color: "#E7EFE3", fontSize: 14, lineHeight: 20, marginTop: 8 },
  contextPicker: { gap: 10, marginHorizontal: tokens.spacing.lg },
  contextChoice: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, padding: 14 },
  contextChoiceActive: { backgroundColor: tokens.colors.lime, borderColor: tokens.colors.green },
  contextChoiceLabel: { color: tokens.colors.ink, fontSize: 15, fontWeight: "800" },
  contextChoiceLabelActive: { color: tokens.colors.green },
  contextChoiceDetail: { color: tokens.colors.muted, fontSize: 12, marginTop: 3 },
  empty: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.card, borderWidth: 1, margin: tokens.spacing.lg, padding: tokens.spacing.lg },
  emptyTitle: { color: tokens.colors.ink, fontSize: 18, fontWeight: "800" },
  emptyText: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  detailStub: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.green, borderRadius: tokens.radius.card, borderWidth: 2, bottom: 88, left: tokens.spacing.lg, padding: tokens.spacing.lg, position: "absolute", right: tokens.spacing.lg, zIndex: 5 },
  detailEyebrow: { color: tokens.colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  detailTitle: { color: tokens.colors.ink, fontSize: 22, fontWeight: "800", marginTop: 8 },
  detailText: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 10 },
  detailPath: { color: tokens.colors.green, fontSize: 13, fontWeight: "700", marginTop: 12 },
  backButton: { alignItems: "center", backgroundColor: tokens.colors.green, borderRadius: tokens.radius.control, marginTop: 16, padding: 13 },
  backButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  paginationBanner: { alignItems: "center", backgroundColor: tokens.colors.orange, bottom: 80, flexDirection: "row", justifyContent: "space-between", left: tokens.spacing.lg, padding: 12, position: "absolute", right: tokens.spacing.lg, zIndex: 4 },
  paginationText: { color: tokens.colors.ink, flex: 1, fontSize: 12, lineHeight: 17, marginRight: 12 },
  retryText: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" },
  switcher: { alignItems: "center", backgroundColor: tokens.colors.ink, borderRadius: 22, bottom: 10, elevation: 5, flexDirection: "row", left: 16, padding: 6, position: "absolute", right: 16, shadowColor: tokens.colors.ink, shadowOpacity: 0.2, shadowRadius: 8, zIndex: 6 },
  switcherButton: { alignItems: "center", backgroundColor: tokens.colors.green, borderRadius: 18, height: 36, justifyContent: "center", width: 42 },
  switcherArrow: { color: tokens.colors.lime, fontSize: 27, lineHeight: 30 },
  switcherLabel: { alignItems: "center", flex: 1 },
  switcherKey: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  switcherHint: { color: "#C7CEC5", fontSize: 10, marginTop: 2 },
});
