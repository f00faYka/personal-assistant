import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ReactNode } from "react";

import { localDateKey } from "../day/selected-day";
import { tokens } from "../design-system";
import { createMemberItemsClient, type MemberItemsClient, type SearchFilters } from "../list/member-items";
import { createMetadataClient, type Entity, type MetadataClient, type Tag } from "../review/metadata";
import { createSpacesClient, type Space, type SpacesClient } from "../spaces/spaces";
import { NoteCard, TaskCard } from "../web/TaskNoteCardPrototype";
import { appendUniqueMaterials, childSpaces, directItems, findSpace, loadMaterialsPage, spacePath, type MaterialItem } from "./materials";

interface MaterialsScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly timeZone: string;
  readonly client?: MemberItemsClient;
  readonly spacesClient?: Pick<SpacesClient, "list">;
  readonly metadataClient?: Pick<MetadataClient, "listTags" | "listEntities">;
  readonly onOpenDetail?: (detailUrl: string) => void;
  /** The parent keeps this screen mounted while rendering the existing detail surface. */
  readonly detailUrl?: string | null;
  readonly detail?: ReactNode;
}

type MaterialsMode = "all" | "spaces";
type LoadState = "loading" | "ready" | "error" | "pagination_error";
type FilterMenu = "space" | "tag" | "entity";

const anyFilterValue = "__any__";
const unassignedFilterValue = "__unassigned__";
type FilterOptionsState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "ready"; readonly spaces: readonly Space[]; readonly tags: readonly Tag[]; readonly entities: readonly Entity[] }
  | { readonly status: "error"; readonly message: string };

export function MaterialsScreen({ apiBaseUrl, memberId, timeZone, client: providedClient, spacesClient: providedSpacesClient, metadataClient: providedMetadataClient, onOpenDetail, detailUrl = null, detail }: MaterialsScreenProps) {
  const client = useMemo(() => providedClient ?? createMemberItemsClient(apiBaseUrl), [apiBaseUrl, providedClient]);
  const spacesClient = useMemo(() => providedSpacesClient ?? createSpacesClient(apiBaseUrl), [apiBaseUrl, providedSpacesClient]);
  const metadataClient = useMemo(() => providedMetadataClient ?? createMetadataClient(apiBaseUrl), [apiBaseUrl, providedMetadataClient]);
  const [mode, setMode] = useState<MaterialsMode>("all");
  const [items, setItems] = useState<readonly MaterialItem[]>([]);
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [paginationError, setPaginationError] = useState<{ readonly filters: SearchFilters; readonly cursor: string; readonly message: string } | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterMenu, setFilterMenu] = useState<FilterMenu | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [filterOptions, setFilterOptions] = useState<FilterOptionsState>({ status: "idle" });
  const requestGeneration = useRef(0);

  const load = useCallback(async (nextFilters: SearchFilters, isRefresh = false, retryCursor?: string, retainedItems: readonly MaterialItem[] = []) => {
    const generation = ++requestGeneration.current;
    if (isRefresh) setRefreshing(true);
    else setLoadState("loading");
    if (retryCursor === undefined && !isRefresh) setItems([]);
    if (retryCursor === undefined) {
      setPaginationError(null);
    }
    setError(null);
    let accumulated = retryCursor === undefined ? [] : [...retainedItems];
    let cursor = retryCursor;
    try {
      while (true) {
        const page = await loadMaterialsPage(client, memberId, nextFilters, cursor);
        accumulated = [...appendUniqueMaterials(accumulated, page.items)];
        if (page.nextCursor === null) {
          if (generation !== requestGeneration.current) return;
          setItems(accumulated);
          setLoadState("ready");
          return;
        }
        cursor = page.nextCursor;
      }
    } catch (cause) {
      if (generation !== requestGeneration.current) return;
      const message = cause instanceof Error ? cause.message : "Unable to load Materials";
      if (cursor !== undefined && accumulated.length > 0) {
        setItems(accumulated);
        setPaginationError({ filters: nextFilters, cursor, message });
        setLoadState("pagination_error");
      } else {
        setError(message);
        setLoadState("error");
      }
    } finally {
      if (generation === requestGeneration.current) setRefreshing(false);
    }
  }, [client, memberId]);

  const retryPagination = useCallback(() => {
    if (!paginationError) return;
    void load(paginationError.filters, false, paginationError.cursor, items);
  }, [items, load, paginationError]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      load({}),
      spacesClient.list(memberId).then((nextSpaces) => { if (!cancelled) setSpaces(nextSpaces); }).catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load Spaces");
      }),
    ]);
    return () => { cancelled = true; requestGeneration.current += 1; };
  }, [load, memberId, spacesClient]);

  const openSearch = useCallback((retry = false) => {
    setSearchOpen(true);
    if (!retry && filterOptions.status !== "idle") return;
    setFilterOptions({ status: "loading" });
    Promise.all([spacesClient.list(memberId), metadataClient.listTags(memberId), metadataClient.listEntities(memberId)])
      .then(([nextSpaces, tags, entities]) => {
        setSpaces(nextSpaces);
        setFilterOptions({ status: "ready", spaces: nextSpaces, tags, entities });
      })
      .catch((cause: unknown) => setFilterOptions({ status: "error", message: cause instanceof Error ? cause.message : "Unable to load search filters" }));
  }, [filterOptions.status, memberId, metadataClient, spacesClient]);

  const applyFilters = useCallback((nextFilters: SearchFilters) => {
    setFilters(nextFilters);
    void load(nextFilters);
  }, [load]);

  const selectSingleFilter = useCallback((menu: FilterMenu, value: string) => {
    const text = searchText.trim();
    const selected = value === anyFilterValue
      ? {}
      : value === unassignedFilterValue
      ? { unassigned: true }
      : menu === "space"
        ? { spaceId: value }
        : menu === "tag"
          ? { tagId: value }
          : { entityId: value };
    setFilterMenu(null);
    applyFilters(text ? { text, ...selected } : selected);
  }, [applyFilters, searchText]);

  const applySearchText = useCallback(() => {
    const text = searchText.trim();
    const { text: _currentText, ...withoutText } = filters;
    applyFilters(text ? { ...withoutText, text } : withoutText);
  }, [applyFilters, filters, searchText]);

  const clearFilters = useCallback(() => {
    const { text } = filters;
    setSearchText(text ?? "");
    applyFilters(text ? { text } : {});
  }, [applyFilters, filters]);

  const clearQuery = useCallback(() => {
    const { text: _text, ...withoutText } = filters;
    setSearchText("");
    applyFilters(withoutText);
  }, [applyFilters, filters]);

  const visibleItems = selectedSpaceId === null || mode === "all" ? items : directItems(items, selectedSpaceId);
  const today = localDateKey(new Date(), timeZone);

  return <View style={styles.root}>
    <View pointerEvents={detailUrl !== null && detail ? "none" : "auto"} style={detailUrl !== null && detail ? styles.browsingHidden : styles.browsingVisible}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(filters, true)} />} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YOUR COLLECTION</Text>
        <Text style={styles.title}>Materials</Text>
        <Text style={styles.subtitle}>Tasks and Notes in one place, with Space paths when they help you orient.</Text>
      </View>
      <View accessibilityLabel="Materials view switcher" style={styles.modeTabs}>
        <ModeTab active={mode === "all"} label="All materials" hint="Flat · uncategorized" onPress={() => setMode("all")} />
        <ModeTab active={mode === "spaces"} label="By Spaces" hint="Tree · paths" onPress={() => setMode("spaces")} />
      </View>
      <SearchPanel open={searchOpen} filterMenu={filterMenu} text={searchText} filters={filters} options={filterOptions} onOpen={() => openSearch()} onTextChange={setSearchText} onApplyText={applySearchText} onSelectFilter={selectSingleFilter} onClearQuery={clearQuery} onClearFilters={clearFilters} onToggleFilterMenu={(menu) => setFilterMenu((current) => current === menu ? null : menu)} onRetry={() => openSearch(true)} />
      {loadState === "loading" && items.length === 0 ? <StateMessage title="Loading Materials" detail="Reading the complete collection…" /> : null}
      {loadState === "loading" && items.length > 0 ? <View accessibilityRole="alert" style={styles.loadingBanner}><Text style={styles.sectionHint}>Updating Materials…</Text></View> : null}
      {loadState === "error" && items.length === 0 ? <StateMessage title="Couldn’t load Materials" detail={error ?? "Try again."} onRetry={() => void load(filters)} /> : null}
      {loadState === "pagination_error" ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Couldn’t load more Materials: {paginationError?.message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading more Materials" onPress={retryPagination}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {error && items.length > 0 ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading Materials" onPress={() => void load(filters)}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {loadState === "ready" && visibleItems.length === 0 ? <StateMessage title={filterCount(filters) > 0 ? "No matching materials" : mode === "spaces" && selectedSpaceId !== null ? "No direct materials here" : "Nothing here yet"} detail={filterCount(filters) > 0 ? "Try a different search or clear the filters." : "Your Tasks and Notes will appear here."} /> : null}
      {mode === "all" ? <AllMaterials items={visibleItems} spaces={spaces} timeZone={timeZone} today={today} onOpenDetail={onOpenDetail} /> : <SpaceMaterials items={visibleItems} spaces={spaces} selectedSpaceId={selectedSpaceId} onSelectSpace={setSelectedSpaceId} timeZone={timeZone} today={today} onOpenDetail={onOpenDetail} />}
      </ScrollView>
    </View>
    {detailUrl !== null && detail ? <View style={styles.detailSurface}>{detail}</View> : null}
  </View>;
}

function ModeTab({ active, label, hint, onPress }: { readonly active: boolean; readonly label: string; readonly hint: string; readonly onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityLabel={`View ${label}`} accessibilityState={{ selected: active }} onPress={onPress} style={[styles.modeTab, active && styles.modeTabActive]}><Text style={[styles.modeTabLabel, active && styles.modeTabLabelActive]}>{label}</Text><Text style={[styles.modeTabHint, active && styles.modeTabHintActive]}>{hint}</Text></Pressable>;
}

function AllMaterials({ items, spaces, timeZone, today, onOpenDetail }: { readonly items: readonly MaterialItem[]; readonly spaces: readonly Space[]; readonly timeZone: string; readonly today: string; readonly onOpenDetail: ((detailUrl: string) => void) | undefined }) {
  return <View><View style={styles.summary}><Text style={styles.summaryCount}>{items.length} materials</Text><Text style={styles.summaryHint}>Flat · no grouping</Text></View>{items.map((item) => <MaterialCard key={`${item.kind}:${item.id}`} item={item} spaces={spaces} timeZone={timeZone} today={today} onOpenDetail={onOpenDetail} />)}</View>;
}

function SpaceMaterials({ items, spaces, selectedSpaceId, onSelectSpace, timeZone, today, onOpenDetail }: { readonly items: readonly MaterialItem[]; readonly spaces: readonly Space[]; readonly selectedSpaceId: string | null; readonly onSelectSpace: (spaceId: string | null) => void; readonly timeZone: string; readonly today: string; readonly onOpenDetail: ((detailUrl: string) => void) | undefined }) {
  const current = findSpace(spaces, selectedSpaceId);
  const children = childSpaces(spaces, selectedSpaceId);
  const direct = directItems(items, selectedSpaceId);
  const parentId = current?.parentId ?? null;
  return <View>
    <View style={styles.breadcrumb}><Text style={styles.breadcrumbEyebrow}>SPACE PATH</Text><Text style={styles.breadcrumbPath}>{current ? spacePath(spaces, current.id) : "Unassigned"}</Text></View>
    {selectedSpaceId !== null ? <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${parentId === null ? "Unassigned" : spacePath(spaces, parentId)}`} onPress={() => onSelectSpace(parentId)} style={styles.backSpace}><Text style={styles.backSpaceText}>‹ {parentId === null ? "Unassigned" : spacePath(spaces, parentId)}</Text></Pressable> : null}
    {selectedSpaceId === null ? <Text style={styles.sectionHint}>Unassigned materials are shown here. Open a child Space to browse its direct items.</Text> : null}
    {children.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Open Space ${spacePath(spaces, space.id)}`} onPress={() => onSelectSpace(space.id)} style={styles.spaceRow}><View style={styles.spaceGlyph}><Text>◌</Text></View><View style={styles.spaceRowCopy}><Text style={styles.spaceName}>{space.name}</Text><Text style={styles.spacePath}>{spacePath(spaces, space.id)}</Text></View><Text style={styles.spaceChevron}>›</Text></Pressable>)}
    {children.length > 0 ? <Text style={styles.sectionTitle}>{current ? "Direct materials" : "Unassigned"}</Text> : null}
    {direct.map((item) => <MaterialCard key={`${item.kind}:${item.id}`} item={item} spaces={spaces} timeZone={timeZone} today={today} onOpenDetail={onOpenDetail} />)}
  </View>;
}

function MaterialCard({ item, spaces, timeZone, today, onOpenDetail }: { readonly item: MaterialItem; readonly spaces: readonly Space[]; readonly timeZone: string; readonly today: string; readonly onOpenDetail: ((detailUrl: string) => void) | undefined }) {
  const onPress = () => onOpenDetail?.(item.detailUrl);
  const path = spacePath(spaces, item.spaceId);
  if (item.kind === "task") return <TaskCard task={{ id: item.id, title: item.title, ...(item.dueAt ? { dueAt: item.dueAt } : {}), status: item.state, space: path }} timeZone={timeZone} today={today} onPress={onPress} />;
  return <NoteCard note={{ id: item.id, content: item.content, reviewState: item.state, space: path }} onPress={onPress} />;
}

function SearchPanel({ open, filterMenu, text, filters, options, onOpen, onTextChange, onApplyText, onSelectFilter, onClearQuery, onClearFilters, onToggleFilterMenu, onRetry }: { readonly open: boolean; readonly filterMenu: FilterMenu | null; readonly text: string; readonly filters: SearchFilters; readonly options: FilterOptionsState; readonly onOpen: () => void; readonly onTextChange: (value: string) => void; readonly onApplyText: () => void; readonly onSelectFilter: (menu: FilterMenu, value: string) => void; readonly onClearQuery: () => void; readonly onClearFilters: () => void; readonly onToggleFilterMenu: (menu: FilterMenu) => void; readonly onRetry: () => void }) {
  if (!open) return <Pressable accessibilityRole="button" accessibilityLabel="Open Materials filters" onPress={onOpen} style={styles.searchToggle}><Text style={styles.searchToggleText}>Filter materials</Text><Text style={styles.searchToggleHint}>Filter by words, Space, Entity, or Tag</Text></Pressable>;
  return <View style={styles.searchPanel}>
    <Text style={styles.searchEyebrow}>FILTER MATERIALS</Text>
    <Text style={styles.searchTitle}>What are you looking for?</Text>
    <View style={styles.searchRow}><View style={{ flex: 1, position: "relative" }}><TextInput accessibilityLabel="Materials filter input" placeholder="Filter Tasks and Notes" value={text} onChangeText={onTextChange} onSubmitEditing={onApplyText} style={[styles.searchInput, { paddingRight: 42 }]} />{text.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear Materials query" onPress={onClearQuery} style={[styles.clearQuery, { marginLeft: 0, position: "absolute", right: 4, top: 0, width: 36 }]}><Text style={styles.clearQueryText}>×</Text></Pressable> : null}</View><Pressable accessibilityRole="button" accessibilityLabel="Apply Materials filter" onPress={onApplyText} style={styles.searchButton}><Text style={styles.searchButtonText}>Apply</Text></Pressable></View>
    {filterCount(filters) > 0 ? <Text style={styles.filterSummary}>{`${filterCount(filters)} active ${filterCount(filters) === 1 ? "filter" : "filters"} · ${filterSummary(filters, options)}`}</Text> : <Text style={styles.searchGuidance}>Choose one filter below, or search by words.</Text>}
    <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
      <FilterDropdown label="Space" menu="space" open={filterMenu === "space"} activeLabel={activeFilterLabel("space", filters, options)} onToggle={onToggleFilterMenu} />
      <FilterDropdown label="Tag" menu="tag" open={filterMenu === "tag"} activeLabel={activeFilterLabel("tag", filters, options)} onToggle={onToggleFilterMenu} />
      <FilterDropdown label="Entity" menu="entity" open={filterMenu === "entity"} activeLabel={activeFilterLabel("entity", filters, options)} onToggle={onToggleFilterMenu} />
    </View>
    {options.status === "loading" ? <View style={styles.filterLoading}><ActivityIndicator /><Text style={styles.sectionHint}>Loading filters…</Text></View> : null}
    {options.status === "error" ? <View accessibilityRole="alert"><Text style={styles.errorText}>Couldn’t load filters: {options.message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading Materials filters" onPress={onRetry}><Text style={styles.retryText}>Retry filters</Text></Pressable></View> : null}
    {filterMenu !== null && options.status === "ready" ? <FilterMenuList menu={filterMenu} options={options} filters={filters} onSelect={onSelectFilter} /> : null}
    {organizationFilterCount(filters) > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear Materials filters" onPress={onClearFilters} style={styles.clearButton}><Text style={styles.clearButtonText}>Clear filters</Text></Pressable> : null}
  </View>;
}

function FilterDropdown({ label, menu, open, activeLabel, onToggle }: { readonly label: string; readonly menu: FilterMenu; readonly open: boolean; readonly activeLabel: string | undefined; readonly onToggle: (menu: FilterMenu) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Select Materials ${label} filter`} accessibilityState={{ expanded: open }} onPress={() => onToggle(menu)} style={[styles.refineButton, { flex: 1, marginTop: 0 }, open && { backgroundColor: "#E3EEDD" }]}><Text style={styles.refineButtonText}>{activeLabel ?? `Any ${label}`}</Text><Text style={styles.refineButtonArrow}>{open ? "⌃" : "⌄"}</Text></Pressable>;
}

function FilterMenuList({ menu, options, filters, onSelect }: { readonly menu: FilterMenu; readonly options: Extract<FilterOptionsState, { readonly status: "ready" }>; readonly filters: SearchFilters; readonly onSelect: (menu: FilterMenu, value: string) => void }) {
  const values = menu === "space"
    ? [{ value: anyFilterValue, label: "Any Space" }, { value: unassignedFilterValue, label: "Unassigned root" }, ...options.spaces.map((space) => ({ value: space.id, label: `${spacePath(options.spaces, space.id)} subtree` }))]
    : menu === "tag"
      ? [{ value: anyFilterValue, label: "Any Tag" }, ...options.tags.map((tag) => ({ value: tag.id, label: tag.name }))]
      : [{ value: anyFilterValue, label: "Any Entity" }, ...options.entities.map((entity) => ({ value: entity.id, label: `${entity.name} (${entity.type})` }))];
  const activeValue = menu === "space" ? (filters.unassigned ? unassignedFilterValue : filters.spaceId ?? anyFilterValue) : menu === "tag" ? filters.tagId ?? anyFilterValue : filters.entityId ?? anyFilterValue;
  return <View style={{ backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, marginTop: 8, padding: 8 }}>{values.length === 0 ? <Text style={styles.sectionHint}>No {menu === "space" ? "Spaces" : menu === "tag" ? "Tags" : "Entities"} yet</Text> : values.map((option) => <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={`Choose Materials ${menu} ${option.label}`} onPress={() => onSelect(menu, option.value)} style={styles.filterOption}><Text style={option.value === activeValue ? styles.filterOptionActive : styles.filterOptionText}>{option.value === activeValue ? "✓ " : ""}{option.label}</Text></Pressable>)}</View>;
}

function activeFilterLabel(menu: FilterMenu, filters: SearchFilters, options: FilterOptionsState): string | undefined {
  if (menu === "space") {
    if (filters.unassigned) return "Unassigned";
    if (filters.spaceId) return options.status === "ready" ? spacePath(options.spaces, filters.spaceId) : "Selected Space";
  }
  if (menu === "tag" && filters.tagId) return options.status === "ready" ? options.tags.find((tag) => tag.id === filters.tagId)?.name ?? "Selected Tag" : "Selected Tag";
  if (menu === "entity" && filters.entityId) return options.status === "ready" ? options.entities.find((entity) => entity.id === filters.entityId)?.name ?? "Selected Entity" : "Selected Entity";
  return undefined;
}

function organizationFilterCount(filters: SearchFilters): number {
  return [filters.spaceId, filters.unassigned, filters.tagId, filters.entityId].filter((value) => value !== undefined && value !== "").length;
}

function filterCount(filters: SearchFilters): number {
  return organizationFilterCount(filters) + (filters.text ? 1 : 0);
}

function filterSummary(filters: SearchFilters, options: FilterOptionsState): string {
  const summary: string[] = [];
  if (filters.text) summary.push(`Query: “${filters.text}”`);
  if (filters.unassigned) summary.push("Space: Unassigned");
  if (filters.spaceId) summary.push(`Space: ${options.status === "ready" ? spacePath(options.spaces, filters.spaceId) : "Selected"}`);
  if (filters.entityId) summary.push(`Entity: ${options.status === "ready" ? options.entities.find((entity) => entity.id === filters.entityId)?.name ?? "Selected" : "Selected"}`);
  if (filters.tagId) summary.push(`Tag: ${options.status === "ready" ? options.tags.find((tag) => tag.id === filters.tagId)?.name ?? "Selected" : "Selected"}`);
  return summary.join(" · ");
}

function StateMessage({ title, detail, onRetry }: { readonly title: string; readonly detail: string; readonly onRetry?: () => void }) {
  return <View style={styles.state}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{detail}</Text>{onRetry ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading Materials" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.colors.background, flex: 1 }, browsingVisible: { flex: 1 }, browsingHidden: { flex: 1, opacity: 0 }, detailSurface: { backgroundColor: tokens.colors.background, bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }, content: { paddingBottom: 32 }, header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 }, title: { color: tokens.colors.ink, fontSize: 34, fontWeight: "700", marginTop: 6 }, subtitle: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 }, modeTabs: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 12 }, modeTab: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 62, padding: 12 }, modeTabActive: { backgroundColor: tokens.colors.green, borderColor: tokens.colors.green }, modeTabLabel: { color: tokens.colors.ink, fontSize: 15, fontWeight: "700" }, modeTabLabelActive: { color: tokens.colors.surface }, modeTabHint: { color: tokens.colors.muted, fontSize: 12, marginTop: 4 }, modeTabHintActive: { color: "#D2DFD7" }, searchToggle: { borderColor: tokens.colors.border, borderRadius: 12, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, padding: 12 }, searchToggleText: { color: tokens.colors.green, fontSize: 17, fontWeight: "800", textAlign: "center" }, searchToggleHint: { color: tokens.colors.muted, fontSize: 13, marginTop: 4, textAlign: "center" }, searchPanel: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 14, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, padding: 16 }, searchEyebrow: { color: tokens.colors.green, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, searchTitle: { color: tokens.colors.ink, fontSize: 21, fontWeight: "800", marginBottom: 12, marginTop: 6 }, searchRow: { alignItems: "center", flexDirection: "row", gap: 8 }, searchInput: { borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, color: tokens.colors.ink, flex: 1, minHeight: 44, paddingHorizontal: 12 }, searchButton: { backgroundColor: tokens.colors.green, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }, searchButtonText: { color: tokens.colors.surface, fontWeight: "700" }, clearQuery: { alignItems: "center", height: 44, justifyContent: "center", marginLeft: -48, width: 40 }, clearQueryText: { color: tokens.colors.muted, fontSize: 24 }, filterSummary: { color: tokens.colors.ink, fontSize: 13, lineHeight: 20, marginTop: 10 }, searchGuidance: { color: tokens.colors.muted, fontSize: 13, lineHeight: 20, marginTop: 10 }, refineButton: { alignItems: "center", borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, padding: 11 }, refineButtonText: { color: tokens.colors.green, fontSize: 14, fontWeight: "800" }, refineButtonArrow: { color: tokens.colors.green, fontSize: 18 }, filterLoading: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 }, filterHeading: { color: tokens.colors.muted, fontSize: 12, fontWeight: "800", marginTop: 14, textTransform: "uppercase" }, filterOption: { minHeight: 40, justifyContent: "center" }, filterOptionText: { color: tokens.colors.muted, fontSize: 14 }, filterOptionActive: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" }, clearButton: { borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, marginTop: 14, padding: 10 }, clearButtonText: { color: "#8C3D25", fontSize: 14, fontWeight: "700", textAlign: "center" }, summary: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginHorizontal: 16, marginBottom: 12 }, summaryCount: { color: tokens.colors.ink, fontSize: 16, fontWeight: "800" }, summaryHint: { color: tokens.colors.muted, fontSize: 13 }, breadcrumb: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 14, borderWidth: 1, marginHorizontal: 16, marginBottom: 10, padding: 14 }, breadcrumbEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, breadcrumbPath: { color: tokens.colors.ink, fontSize: 18, fontWeight: "700", marginTop: 5 }, backSpace: { marginHorizontal: 16, marginBottom: 8, paddingVertical: 8 }, backSpaceText: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" }, sectionHint: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginHorizontal: 16, marginBottom: 12 }, loadingBanner: { backgroundColor: tokens.colors.surface, marginHorizontal: 16, marginBottom: 12, paddingVertical: 8 }, spaceRow: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 14, borderWidth: 1, flexDirection: "row", marginHorizontal: 16, marginBottom: 10, minHeight: 64, padding: 14 }, spaceGlyph: { alignItems: "center", backgroundColor: "#E3EEDD", borderRadius: 18, height: 36, justifyContent: "center", marginRight: 12, width: 36 }, spaceRowCopy: { flex: 1 }, spaceName: { color: tokens.colors.ink, fontSize: 16, fontWeight: "700" }, spacePath: { color: tokens.colors.muted, fontSize: 12, marginTop: 4 }, spaceChevron: { color: tokens.colors.green, fontSize: 24 }, sectionTitle: { color: tokens.colors.ink, fontSize: 18, fontWeight: "800", marginHorizontal: 16, marginVertical: 10 }, errorBanner: { alignItems: "center", backgroundColor: "#FCE8DF", borderRadius: 10, flexDirection: "row", justifyContent: "space-between", marginHorizontal: 16, marginBottom: 12, padding: 12 }, errorText: { color: "#8C3D25", fontSize: 14 }, retryText: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" }, state: { alignItems: "center", padding: 32 }, stateTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "700", textAlign: "center" }, stateText: { color: tokens.colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: "center" }, retryButton: { backgroundColor: tokens.colors.ink, borderRadius: 12, marginTop: 18, paddingHorizontal: 20, paddingVertical: 12 },
});
