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
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [filterOptions, setFilterOptions] = useState<FilterOptionsState>({ status: "idle" });
  const requestGeneration = useRef(0);

  const load = useCallback(async (nextFilters: SearchFilters, isRefresh = false, retryCursor?: string, retainedItems: readonly MaterialItem[] = []) => {
    const generation = ++requestGeneration.current;
    if (isRefresh) setRefreshing(true);
    else setLoadState("loading");
    if (retryCursor === undefined) {
      setPaginationError(null);
      if (!isRefresh) setItems([]);
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

  const applySearchText = useCallback(() => {
    const text = searchText.trim();
    const { text: _currentText, ...withoutText } = filters;
    applyFilters(text ? { ...withoutText, text } : withoutText);
  }, [applyFilters, filters, searchText]);

  const clearFilters = useCallback(() => {
    setSearchText("");
    applyFilters({});
  }, [applyFilters]);

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
      <SearchPanel open={searchOpen} text={searchText} filters={filters} options={filterOptions} onOpen={() => openSearch()} onTextChange={setSearchText} onApplyText={applySearchText} onApply={applyFilters} onClear={clearFilters} onRetry={() => openSearch(true)} />
      {loadState === "loading" && items.length === 0 ? <StateMessage title="Loading Materials" detail="Reading the complete collection…" /> : null}
      {loadState === "loading" && items.length > 0 ? <View accessibilityRole="alert" style={styles.loadingBanner}><Text style={styles.sectionHint}>Updating Materials…</Text></View> : null}
      {loadState === "error" && items.length === 0 ? <StateMessage title="Couldn’t load Materials" detail={error ?? "Try again."} onRetry={() => void load(filters)} /> : null}
      {loadState === "pagination_error" ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Couldn’t load more Materials: {paginationError?.message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading more Materials" onPress={retryPagination}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {error && items.length > 0 ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading Materials" onPress={() => void load(filters)}><Text style={styles.retryText}>Retry</Text></Pressable></View> : null}
      {loadState === "ready" && visibleItems.length === 0 ? <StateMessage title={mode === "spaces" && selectedSpaceId !== null ? "No direct materials here" : "Nothing here yet"} detail={filters.text ? "Try a different search or clear the filters." : "Your Tasks and Notes will appear here."} /> : null}
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

function SearchPanel({ open, text, filters, options, onOpen, onTextChange, onApplyText, onApply, onClear, onRetry }: { readonly open: boolean; readonly text: string; readonly filters: SearchFilters; readonly options: FilterOptionsState; readonly onOpen: () => void; readonly onTextChange: (value: string) => void; readonly onApplyText: () => void; readonly onApply: (filters: SearchFilters) => void; readonly onClear: () => void; readonly onRetry: () => void }) {
  if (!open) return <Pressable accessibilityRole="button" accessibilityLabel="Open Materials search and filters" onPress={onOpen} style={styles.searchToggle}><Text style={styles.searchToggleText}>Search and filter</Text></Pressable>;
  return <View style={styles.searchPanel}>
    <View style={styles.searchRow}><TextInput accessibilityLabel="Search Materials" placeholder="Search Tasks and Notes" value={text} onChangeText={onTextChange} onSubmitEditing={onApplyText} style={styles.searchInput} /><Pressable accessibilityRole="button" accessibilityLabel="Apply Materials search" onPress={onApplyText} style={styles.searchButton}><Text style={styles.searchButtonText}>Search</Text></Pressable></View>
    {filters.text ? <Text style={styles.filterSummary}>Content: {filters.text}</Text> : null}
    {options.status === "loading" ? <View style={styles.filterLoading}><ActivityIndicator /><Text style={styles.sectionHint}>Loading filters…</Text></View> : null}
    {options.status === "error" ? <View accessibilityRole="alert"><Text style={styles.errorText}>Couldn’t load filters: {options.message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading Materials filters" onPress={onRetry}><Text style={styles.retryText}>Retry filters</Text></Pressable></View> : null}
    {options.status === "ready" ? <View><Text style={styles.filterHeading}>Space</Text><FilterButton active={filters.unassigned === true} label="Unassigned root" accessibilityLabel="Filter Materials by unassigned root" onPress={() => onApply(toggleUnassigned(filters))} />{options.spaces.map((space) => <FilterButton key={space.id} active={filters.spaceId === space.id} label={`${spacePath(options.spaces, space.id)} subtree`} accessibilityLabel={`Filter Materials by Space ${spacePath(options.spaces, space.id)}`} onPress={() => onApply(toggleSpace(filters, space.id))} />)}<Text style={styles.filterHeading}>Tag</Text>{options.tags.length === 0 ? <Text style={styles.sectionHint}>No Tags yet</Text> : options.tags.map((tag) => <FilterButton key={tag.id} active={filters.tagId === tag.id} label={tag.name} accessibilityLabel={`Filter Materials by Tag ${tag.name}`} onPress={() => onApply(toggleId(filters, "tagId", tag.id))} />)}<Text style={styles.filterHeading}>Entity</Text>{options.entities.length === 0 ? <Text style={styles.sectionHint}>No Entities yet</Text> : options.entities.map((entity) => <FilterButton key={entity.id} active={filters.entityId === entity.id} label={`${entity.name} (${entity.type})`} accessibilityLabel={`Filter Materials by Entity ${entity.name}`} onPress={() => onApply(toggleId(filters, "entityId", entity.id))} />)}</View> : null}
    {Object.values(filters).some((value) => value !== undefined && value !== "") || text.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Clear Materials search and filters" onPress={onClear} style={styles.clearButton}><Text style={styles.clearButtonText}>Clear search and filters</Text></Pressable> : null}
  </View>;
}

function FilterButton({ active, label, accessibilityLabel, onPress }: { readonly active: boolean; readonly label: string; readonly accessibilityLabel: string; readonly onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.filterOption}><Text style={active ? styles.filterOptionActive : styles.filterOptionText}>{active ? "✓ " : ""}{label}</Text></Pressable>;
}

function toggleUnassigned(filters: SearchFilters): SearchFilters {
  const { spaceId: _spaceId, unassigned, ...rest } = filters;
  return unassigned ? rest : { ...rest, unassigned: true };
}

function toggleSpace(filters: SearchFilters, spaceId: string): SearchFilters {
  const { unassigned: _unassigned, spaceId: current, ...rest } = filters;
  return current === spaceId ? rest : { ...rest, spaceId };
}

function toggleId(filters: SearchFilters, key: "tagId" | "entityId", value: string): SearchFilters {
  return filters[key] === value ? { ...filters, [key]: undefined } : { ...filters, [key]: value };
}

function StateMessage({ title, detail, onRetry }: { readonly title: string; readonly detail: string; readonly onRetry?: () => void }) {
  return <View style={styles.state}><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{detail}</Text>{onRetry ? <Pressable accessibilityRole="button" accessibilityLabel="Retry loading Materials" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>Retry</Text></Pressable> : null}</View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.colors.background, flex: 1 }, browsingVisible: { flex: 1 }, browsingHidden: { flex: 1, opacity: 0 }, detailSurface: { backgroundColor: tokens.colors.background, bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }, content: { paddingBottom: 32 }, header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 }, title: { color: tokens.colors.ink, fontSize: 34, fontWeight: "700", marginTop: 6 }, subtitle: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 }, modeTabs: { flexDirection: "row", gap: 8, marginHorizontal: 16, marginBottom: 12 }, modeTab: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 62, padding: 12 }, modeTabActive: { backgroundColor: tokens.colors.green, borderColor: tokens.colors.green }, modeTabLabel: { color: tokens.colors.ink, fontSize: 15, fontWeight: "700" }, modeTabLabelActive: { color: tokens.colors.surface }, modeTabHint: { color: tokens.colors.muted, fontSize: 12, marginTop: 4 }, modeTabHintActive: { color: "#D2DFD7" }, searchToggle: { borderColor: tokens.colors.border, borderRadius: 12, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, padding: 12 }, searchToggleText: { color: tokens.colors.muted, fontSize: 15, fontWeight: "600", textAlign: "center" }, searchPanel: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 14, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, padding: 14 }, searchRow: { alignItems: "center", flexDirection: "row", gap: 8 }, searchInput: { borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, color: tokens.colors.ink, flex: 1, minHeight: 44, paddingHorizontal: 12 }, searchButton: { backgroundColor: tokens.colors.ink, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }, searchButtonText: { color: tokens.colors.surface, fontWeight: "700" }, filterSummary: { color: tokens.colors.muted, fontSize: 13, marginTop: 10 }, filterLoading: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 }, filterHeading: { color: tokens.colors.muted, fontSize: 12, fontWeight: "800", marginTop: 14, textTransform: "uppercase" }, filterOption: { minHeight: 40, justifyContent: "center" }, filterOptionText: { color: tokens.colors.muted, fontSize: 14 }, filterOptionActive: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" }, clearButton: { borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, marginTop: 14, padding: 10 }, clearButtonText: { color: "#8C3D25", fontSize: 14, fontWeight: "700", textAlign: "center" }, summary: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginHorizontal: 16, marginBottom: 12 }, summaryCount: { color: tokens.colors.ink, fontSize: 16, fontWeight: "800" }, summaryHint: { color: tokens.colors.muted, fontSize: 13 }, breadcrumb: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 14, borderWidth: 1, marginHorizontal: 16, marginBottom: 10, padding: 14 }, breadcrumbEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2 }, breadcrumbPath: { color: tokens.colors.ink, fontSize: 18, fontWeight: "700", marginTop: 5 }, backSpace: { marginHorizontal: 16, marginBottom: 8, paddingVertical: 8 }, backSpaceText: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" }, sectionHint: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginHorizontal: 16, marginBottom: 12 }, loadingBanner: { backgroundColor: tokens.colors.surface, marginHorizontal: 16, marginBottom: 12, paddingVertical: 8 }, spaceRow: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 14, borderWidth: 1, flexDirection: "row", marginHorizontal: 16, marginBottom: 10, minHeight: 64, padding: 14 }, spaceGlyph: { alignItems: "center", backgroundColor: "#E3EEDD", borderRadius: 18, height: 36, justifyContent: "center", marginRight: 12, width: 36 }, spaceRowCopy: { flex: 1 }, spaceName: { color: tokens.colors.ink, fontSize: 16, fontWeight: "700" }, spacePath: { color: tokens.colors.muted, fontSize: 12, marginTop: 4 }, spaceChevron: { color: tokens.colors.green, fontSize: 24 }, sectionTitle: { color: tokens.colors.ink, fontSize: 18, fontWeight: "800", marginHorizontal: 16, marginVertical: 10 }, errorBanner: { alignItems: "center", backgroundColor: "#FCE8DF", borderRadius: 10, flexDirection: "row", justifyContent: "space-between", marginHorizontal: 16, marginBottom: 12, padding: 12 }, errorText: { color: "#8C3D25", fontSize: 14 }, retryText: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" }, state: { alignItems: "center", padding: 32 }, stateTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "700", textAlign: "center" }, stateText: { color: tokens.colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: "center" }, retryButton: { backgroundColor: tokens.colors.ink, borderRadius: 12, marginTop: 18, paddingHorizontal: 20, paddingVertical: 12 },
});
