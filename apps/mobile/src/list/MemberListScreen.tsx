import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createIdempotencyKey, type CaptureSubmitter, type RecordedAudio, type VoiceRecorder } from "../capture/voice-capture";
import { createWaveformBars } from "../capture/audio-waveform";
import { shouldPersistOfflineDraft } from "../http/request-error";
import type { OfflineDraft, OfflineDraftStore } from "../offline/offline-drafts";
import type { OfflineDraftSynchronizationResult, OfflineDraftSyncClient } from "../offline/synchronize-offline-drafts";
import { createMemberItemsClient, initialListState, listItemLabel, listStateFromError, listStateFromPage, paginationStateFromError, type ListState, type MemberItemsClient, type MemberListItem, type SearchFilters } from "./member-items";
import { beginPreview, expirePreview, openPreviewReview, previewCountdown, resolvePreview, savePreview, timeOutPreview, type PreviewItem, type PreviewState } from "../preview/result-preview";
import { CaptureResultFacts, CaptureResultReview } from "../review/CaptureResultReview";
import { SpacePanel } from "../spaces/SpacePanel";
import { createSpacesClient, type Space } from "../spaces/spaces";
import { createMetadataClient, type Entity, type Tag } from "../review/metadata";
import { loadCompleteMemberItems, localDateKey } from "../day/selected-day";
import { TaskCard } from "../web/TaskNoteCardPrototype";
import { createReviewClient, setTaskCompletion } from "../review/review";
import type { BrowserFixtureTask } from "../web/fixture-data";
import { getDeviceTimeZone } from "../time-zone";

interface MemberListScreenProps {
  readonly apiBaseUrl: string;
  readonly client?: MemberItemsClient;
  readonly memberId: string;
  readonly timeZone?: string;
  readonly onOpenDetail?: (detailUrl: string) => void;
  readonly onEditDetail?: (detailUrl: string) => void;
  readonly voiceRecorder?: VoiceRecorder;
  readonly recordingMetering?: number | undefined;
  readonly recordingInterrupted?: boolean;
  readonly captureSubmitter?: CaptureSubmitter;
  readonly offlineDraftStore?: OfflineDraftStore;
  readonly offlineDraftSyncClient?: OfflineDraftSyncClient;
  readonly captureRequest?: number;
  readonly home?: boolean;
  readonly onOpenToday?: () => void;
}

type CaptureState =
  | { readonly status: "idle" }
  | { readonly status: "requesting" | "recording" | "stopping" | "submitting" }
  | { readonly status: "permission_denied" | "error"; readonly message: string }
  | { readonly status: "ready" | "failed"; readonly audio: RecordedAudio; readonly message?: string };

type TimelineItem =
  | { readonly kind: "offline_draft"; readonly draft: OfflineDraft }
  | { readonly kind: "server_item"; readonly item: MemberListItem };
type AssignableItem = Extract<MemberListItem, { kind: "task" | "note" }>;

export function MemberListScreen({ apiBaseUrl, client: providedClient, memberId, timeZone, onOpenDetail, onEditDetail, voiceRecorder, recordingMetering, recordingInterrupted = false, captureSubmitter, offlineDraftStore, offlineDraftSyncClient, captureRequest = 0, home = false, onOpenToday }: MemberListScreenProps) {
  const effectiveTimeZone = timeZone ?? getDeviceTimeZone();
  const client = useMemo(() => providedClient ?? createMemberItemsClient(apiBaseUrl), [apiBaseUrl, providedClient]);
  const spacesClient = useMemo(() => createSpacesClient(apiBaseUrl), [apiBaseUrl]);
  const reviewClient = useMemo(() => createReviewClient(apiBaseUrl), [apiBaseUrl]);
  const [state, setState] = useState<ListState>(initialListState);
  const [completeHomeItems, setCompleteHomeItems] = useState<readonly MemberListItem[]>([]);
  const [homeLoadStatus, setHomeLoadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [capture, setCapture] = useState<CaptureState>({ status: "idle" });
  const [offlineDrafts, setOfflineDrafts] = useState<readonly OfflineDraft[]>([]);
  const [offlineDraftError, setOfflineDraftError] = useState<string | null>(null);
  const [offlineDraftSync, setOfflineDraftSync] = useState<Record<string, OfflineDraftSynchronizationResult>>({});
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [captureReviewUrl, setCaptureReviewUrl] = useState<string | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [assigningItemId, setAssigningItemId] = useState<string | null>(null);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [failedAssignment, setFailedAssignment] = useState<{ readonly item: AssignableItem; readonly spaceId: string | null } | null>(null);
  const [homeTaskSaveStates, setHomeTaskSaveStates] = useState<Record<string, "pending" | "error">>({});
  const [homeTaskSaveError, setHomeTaskSaveError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [filterOptions, setFilterOptions] = useState<FilterOptionsState>({ status: "idle" });
  const assignedCaptures = useRef(new Set<string>());
  const submissionInFlight = useRef(false);
  const captureKey = useRef<string | null>(null);
  const captureCreatedAt = useRef<string | null>(null);
  const loadingCursor = useRef<string | null>(null);
  const requestGeneration = useRef(0);
  const refreshGeneration = useRef(0);
  const homeLoadGeneration = useRef(0);
  const deletedOfflineDraftIds = useRef(new Set<string>());
  const metadataClient = useMemo(() => createMetadataClient(apiBaseUrl), [apiBaseUrl]);

  const hasSearch = Object.values(filters).some((value) => value !== undefined && value !== "");

  const synchronizeDraft = useCallback(async (draft: OfflineDraft) => {
    if (!offlineDraftStore || !offlineDraftSyncClient) return;
    setOfflineDraftSync((current) => ({ ...current, [draft.draftId]: { draftId: draft.draftId, state: "processing", retryable: false } }));
    let result: OfflineDraftSynchronizationResult;
    try {
      result = await offlineDraftSyncClient.synchronize(draft);
    } catch (error) {
      result = { draftId: draft.draftId, state: "failed", retryable: true, message: error instanceof Error ? error.message : "Unable to synchronize Offline draft" };
    }
    if (result.state === "confirmed") {
      try {
        await offlineDraftStore.remove(memberId, draft.draftId);
        deletedOfflineDraftIds.current.add(draft.draftId);
        setOfflineDrafts((current) => current.filter((candidate) => candidate.draftId !== draft.draftId));
        setOfflineDraftSync((current) => { const next = { ...current }; delete next[draft.draftId]; return next; });
        try {
          const page = await client.list(memberId);
          setState(listStateFromPage(page));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to refresh confirmed result";
          setOfflineDraftError(`Server confirmed the draft, but the timeline could not refresh: ${message}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "local storage failed";
        setOfflineDraftError(`Server confirmed the draft, but local cleanup failed: ${message}`);
        setOfflineDraftSync((current) => ({ ...current, [draft.draftId]: { draftId: draft.draftId, state: "failed", retryable: true, message: `Local cleanup failed: ${message}` } }));
      }
      return;
    }
    setOfflineDraftSync((current) => ({ ...current, [draft.draftId]: result }));
  }, [client, memberId, offlineDraftStore, offlineDraftSyncClient]);

  const loadHomeItems = useCallback(async () => {
    if (!home) return;
    const generation = ++homeLoadGeneration.current;
    setHomeLoadStatus("loading");
    try {
      const result = await loadCompleteMemberItems(client, memberId);
      if (generation !== homeLoadGeneration.current) return;
      setCompleteHomeItems(result.items);
      setHomeLoadStatus("ready");
    } catch {
      if (generation === homeLoadGeneration.current) setHomeLoadStatus("error");
    }
  }, [client, home, memberId]);

  const load = useCallback(async (isRefresh = false, cursor?: string, generation = requestGeneration.current) => {
    if (isRefresh) setRefreshing(true);
    else if (cursor) {
      if (loadingCursor.current === cursor) return;
      loadingCursor.current = cursor;
      setLoadingMore(true);
    }
    else setState((current) => ({ status: "loading", items: current.items }));
    try {
      const page = hasSearch ? await client.search(memberId, filters, cursor) : await client.list(memberId, cursor);
      if (generation !== requestGeneration.current) return;
      setState((current) => {
        const nextPage = listStateFromPage(page);
        return { ...nextPage, items: cursor ? appendUniqueItems(current.items, nextPage.items) : nextPage.items };
      });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      setState((current) => cursor ? paginationStateFromError(current.items, cursor, error) : listStateFromError(current.items, error));
    } finally {
      if (generation === requestGeneration.current) {
        setRefreshing(false);
        setLoadingMore(false);
        if (cursor) loadingCursor.current = null;
      }
    }
  }, [client, filters, hasSearch, memberId]);

  const startFreshLoad = useCallback((isRefresh = false) => {
    const generation = ++requestGeneration.current;
    loadingCursor.current = null;
    return load(isRefresh, undefined, generation);
  }, [load]);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    await startFreshLoad(true);
    if (!home || generation !== refreshGeneration.current) return;
    setRefreshing(true);
    try {
      await loadHomeItems();
    } finally {
      if (generation === refreshGeneration.current) setRefreshing(false);
    }
  }, [home, loadHomeItems, startFreshLoad]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    if (filterOptions.status === "loading" || filterOptions.status === "ready") return;
    setFilterOptions({ status: "loading" });
    Promise.all([spacesClient.list(memberId), metadataClient.listTags(memberId), metadataClient.listEntities(memberId)])
      .then(([nextSpaces, tags, entities]) => {
        setSpaces(nextSpaces);
        setFilterOptions({ status: "ready", spaces: nextSpaces, tags, entities });
      })
      .catch((error: unknown) => setFilterOptions({ status: "error", message: error instanceof Error ? error.message : "Unable to load search filters" }));
  }, [filterOptions.status, memberId, metadataClient, spacesClient]);

  const applyFilters = useCallback((next: SearchFilters) => setFilters(next), []);
  const clearFilters = useCallback(() => {
    setSearchText("");
    setFilters({});
  }, []);

  const startCapture = useCallback(async () => {
    if (!voiceRecorder || capture.status !== "idle") return;
    setCapture({ status: "requesting" });
    try {
      if (!await voiceRecorder.requestPermission()) {
        setCapture({ status: "permission_denied", message: "Microphone access is required to record a Capture." });
        return;
      }
      await voiceRecorder.start();
      setCapture({ status: "recording" });
    } catch (error) {
      setCapture({ status: "error", message: error instanceof Error ? error.message : "Unable to start recording" });
    }
  }, [capture.status, voiceRecorder]);

  const previousCaptureRequest = useRef(captureRequest);
  useEffect(() => {
    if (captureRequest !== previousCaptureRequest.current) {
      previousCaptureRequest.current = captureRequest;
      void startCapture();
    }
  }, [captureRequest, startCapture]);

  const stopCapture = useCallback(async () => {
    if (!voiceRecorder || capture.status !== "recording") return;
    setCapture({ status: "stopping" });
    try {
      const audio = await voiceRecorder.stop();
      if (!audio) throw new Error("No recording was created");
      captureKey.current = createIdempotencyKey();
      captureCreatedAt.current = new Date().toISOString();
      setCapture({ status: "ready", audio });
    } catch (error) {
      setCapture({ status: "error", message: error instanceof Error ? error.message : "Unable to finish recording" });
    }
  }, [capture.status, voiceRecorder]);

  const cancelCapture = useCallback(async () => {
    if (capture.status === "permission_denied" || capture.status === "error" || capture.status === "ready" || capture.status === "failed") {
      if (capture.status !== "permission_denied" && capture.status !== "error") await voiceRecorder?.cancel();
      setCapture({ status: "idle" });
      captureKey.current = null;
      captureCreatedAt.current = null;
      return;
    }
    if (!voiceRecorder || (capture.status !== "recording" && capture.status !== "stopping")) return;
    await voiceRecorder.cancel();
    captureKey.current = null;
    captureCreatedAt.current = null;
    setCapture({ status: "idle" });
  }, [capture.status, voiceRecorder]);

  const submitCapture = useCallback(async (audio: RecordedAudio) => {
    if (!captureSubmitter || submissionInFlight.current || !captureKey.current) return;
    submissionInFlight.current = true;
    setCapture({ status: "submitting" });
    const draftId = captureKey.current;
    const capturedAt = captureCreatedAt.current ?? new Date().toISOString();
    try {
      const result = await captureSubmitter.submit({ memberId, idempotencyKey: draftId, audio, capturedAt, timeZone: effectiveTimeZone });
      captureKey.current = null;
      captureCreatedAt.current = null;
      setCapture({ status: "idle" });
      setPreview(beginPreview(result.captureId));
    } catch (error) {
      const submissionMessage = error instanceof Error ? error.message : "Unable to submit Capture";
      if (!offlineDraftStore || !shouldPersistOfflineDraft(error)) {
        setCapture({ status: "failed", audio, message: submissionMessage });
      } else {
        try {
          const draft = await offlineDraftStore.save({ draftId, memberId, capturedAt, timeZone: effectiveTimeZone, source: { kind: "audio", uri: audio.uri, contentType: audio.contentType } });
          deletedOfflineDraftIds.current.delete(draft.draftId);
          setOfflineDrafts((current) => [draft, ...current.filter((candidate) => candidate.draftId !== draft.draftId)]);
          setOfflineDraftError(null);
          captureKey.current = null;
          captureCreatedAt.current = null;
          setCapture({ status: "idle" });
          try { await voiceRecorder?.cancel(); } catch { /* The durable copy is already confirmed locally. */ }
          void synchronizeDraft(draft);
        } catch (persistenceError) {
          const persistenceMessage = persistenceError instanceof Error ? persistenceError.message : "local storage failed";
          setCapture({ status: "failed", audio, message: `${submissionMessage}. Offline draft was not saved: ${persistenceMessage}` });
        }
      }
    } finally {
      submissionInFlight.current = false;
    }
  }, [captureSubmitter, effectiveTimeZone, memberId, offlineDraftStore, synchronizeDraft, voiceRecorder]);

  useEffect(() => { void startFreshLoad(); }, [startFreshLoad]);

  useEffect(() => {
    if (!home) return;
    void loadHomeItems();
    return () => { homeLoadGeneration.current += 1; };
  }, [home, loadHomeItems]);

  useEffect(() => {
    if (!offlineDraftStore) return;
    let cancelled = false;
    void offlineDraftStore.list(memberId).then((drafts) => {
      if (cancelled) return;
      setOfflineDrafts((current) => {
        const restoredIds = new Set(drafts.map((draft) => draft.draftId));
        return [...drafts.filter((draft) => !deletedOfflineDraftIds.current.has(draft.draftId)), ...current.filter((draft) => !restoredIds.has(draft.draftId))]
          .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
      });
      setOfflineDraftError(null);
      void Promise.all(drafts.map((draft) => synchronizeDraft(draft)));
    }).catch((error: unknown) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : "local storage failed";
        setOfflineDraftError(`Couldn’t restore Offline drafts: ${message}`);
      }
    });
    return () => { cancelled = true; };
  }, [memberId, offlineDraftStore, synchronizeDraft]);

  useEffect(() => {
    if (!offlineDraftStore || !offlineDraftSyncClient) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      void offlineDraftStore.list(memberId).then((drafts) => Promise.all(drafts.map((draft) => synchronizeDraft(draft))));
    });
    return () => subscription.remove();
  }, [memberId, offlineDraftStore, offlineDraftSyncClient, synchronizeDraft]);

  const deleteOfflineDraft = useCallback(async (draftId: string) => {
    if (!offlineDraftStore || deletingDraftId) return;
    setDeletingDraftId(draftId);
    setOfflineDraftError(null);
    try {
      await offlineDraftStore.remove(memberId, draftId);
      deletedOfflineDraftIds.current.add(draftId);
      setOfflineDrafts((current) => current.filter((draft) => draft.draftId !== draftId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "local storage failed";
      setOfflineDraftError(`Couldn’t delete Offline draft: ${message}`);
    } finally {
      setDeletingDraftId(null);
    }
  }, [deletingDraftId, memberId, offlineDraftStore]);

  const retryOfflineDraft = useCallback((draftId: string) => {
    const draft = offlineDrafts.find((candidate) => candidate.draftId === draftId);
    if (draft) void synchronizeDraft(draft);
  }, [offlineDrafts, synchronizeDraft]);

  useEffect(() => {
    if (!preview || preview.status !== "processing") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const page = await client.list(memberId);
        if (cancelled) return;
        setState(listStateFromPage(page));
        setPreview((current) => {
          const next = current ? resolvePreview(current, page.items, Date.now()) : current;
          if (next?.status === "preview" && selectedSpaceId !== null && !assignedCaptures.current.has(next.item.captureId)) {
            assignedCaptures.current.add(next.item.captureId);
            void spacesClient.assign(next.item.id, next.item.kind, memberId, selectedSpaceId).then(() => void refresh()).catch(() => { assignedCaptures.current.delete(next.item.captureId); });
          }
          return next;
        });
      } catch {
        // Keep the processing state honest; the next poll can recover a transient read failure.
      }
      if (!cancelled) globalThis.setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { cancelled = true; };
  }, [client, memberId, preview, refresh, selectedSpaceId, spacesClient]);

  useEffect(() => {
    if (!preview || preview.status !== "preview") return;
    const timer = globalThis.setTimeout(() => setPreview((current) => current ? expirePreview(current, Date.now()) : current), Math.max(0, preview.expiresAt - Date.now()));
    return () => globalThis.clearTimeout(timer);
  }, [preview]);

  useEffect(() => {
    if (!preview || preview.status !== "processing") return;
    const timer = globalThis.setTimeout(() => setPreview((current) => current ? timeOutPreview(current, Date.now()) : current), Math.max(0, preview.startedAt + 30_000 - Date.now()));
    return () => globalThis.clearTimeout(timer);
  }, [preview]);

  const saveResultPreview = useCallback(() => {
    setPreview((current) => current ? savePreview(current) : current);
    void refresh();
  }, [refresh]);

  const openResultReview = useCallback((item: PreviewItem) => {
    setPreview((current) => current ? openPreviewReview(current) : current);
    setCaptureReviewUrl(item.detailUrl);
  }, []);

  const assignItem = useCallback(async (item: AssignableItem, spaceId: string | null) => {
    setAssigningItemId(item.id); setSpaceError(null); setFailedAssignment(null);
    try { await spacesClient.assign(item.id, item.kind, memberId, spaceId); await refresh(); }
    catch (cause) { setSpaceError(cause instanceof Error ? cause.message : "Unable to update Space assignment"); setFailedAssignment({ item, spaceId }); }
    finally { setAssigningItemId(null); }
  }, [memberId, refresh, spacesClient]);

  const setTaskCompleted = useCallback(async (task: Extract<MemberListItem, { kind: "task" }>, completed: boolean): Promise<boolean> => {
    setHomeTaskSaveStates((current) => ({ ...current, [task.id]: "pending" }));
    setHomeTaskSaveError(null);
    try {
      const saved = await setTaskCompletion(reviewClient, task.detailUrl, memberId, completed);
      const state = saved.status;
      setCompleteHomeItems((items) => items.map((item) => item.id === task.id && item.kind === "task" ? { ...item, state } : item));
      setState((current) => ({ ...current, items: current.items.map((item) => item.id === task.id && item.kind === "task" ? { ...item, state } : item) } as ListState));
      setHomeTaskSaveStates((current) => { const next = { ...current }; delete next[task.id]; return next; });
      return true;
    } catch (cause) {
      setHomeTaskSaveStates((current) => ({ ...current, [task.id]: "error" }));
      setHomeTaskSaveError(cause instanceof Error ? cause.message : "Unable to complete Task");
      return false;
    }
  }, [memberId, reviewClient]);

  useEffect(() => {
    if (capture.status !== "recording") {
      setRecordingElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setRecordingElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [capture.status]);

  const timelineItems: readonly TimelineItem[] = hasSearch
    ? state.items.map((item): TimelineItem => ({ kind: "server_item", item }))
    : [
      ...offlineDrafts.map((draft): TimelineItem => ({ kind: "offline_draft", draft })),
      ...state.items.map((item): TimelineItem => ({ kind: "server_item", item })),
    ];

  const homeDate = localDateKey(new Date(), effectiveTimeZone);
  const homeItems = (home ? completeHomeItems : state.items).filter((item): item is Extract<MemberListItem, { kind: "task" }> => item.kind === "task" && item.dueAt !== undefined && localDateKey(item.dueAt, effectiveTimeZone) === homeDate);
  const homeTimelineItems: readonly TimelineItem[] = homeItems.map((item): TimelineItem => ({ kind: "server_item", item }));
  return captureReviewUrl ? <CaptureResultReview apiBaseUrl={apiBaseUrl} memberId={memberId} detailUrl={captureReviewUrl} timeZone={effectiveTimeZone} onBack={() => setCaptureReviewUrl(null)} /> : (
    <SafeAreaView style={styles.safeArea}>
      {home ? <HomeHeader taskCount={homeItems.length} loading={homeLoadStatus === "loading"} /> : <View style={styles.header}>
        <Text style={styles.eyebrow}>D · SUMMARY TIMELINE</Text>
        <Text style={styles.title}>Your items</Text>
        {voiceRecorder && capture.status === "idle" ? <Pressable accessibilityRole="button" accessibilityLabel="Record a voice Capture" onPress={() => void startCapture()} style={styles.captureButton}><Text style={styles.captureButtonText}>Record a Capture</Text></Pressable> : null}
      </View>}
      {!home ? <><SpacePanel client={spacesClient} memberId={memberId} selectedSpaceId={selectedSpaceId} onSelect={setSelectedSpaceId} onSpacesChanged={setSpaces} />
      <SearchFilterPanel open={searchOpen} text={searchText} filters={filters} options={filterOptions} onOpen={openSearch} onTextChange={setSearchText} onApplyText={() => applyFilters(withTextFilter(filters, searchText))} onApply={applyFilters} onClear={clearFilters} onRetry={openSearch} /></> : null}
      {spaceError && failedAssignment ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{spaceError}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry Space assignment" onPress={() => void assignItem(failedAssignment.item, failedAssignment.spaceId)}><Text style={styles.retryText}>Retry assignment</Text></Pressable></View> : null}
      {homeTaskSaveError ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{homeTaskSaveError}</Text></View> : null}
      {voiceRecorder && capture.status !== "idle" ? <CapturePanel state={capture} recordingElapsedSeconds={recordingElapsedSeconds} recordingMetering={recordingMetering} recordingInterrupted={recordingInterrupted} onStop={() => void stopCapture()} onCancel={() => void cancelCapture()} onSubmit={(audio) => void submitCapture(audio)} /> : null}
      {preview ? <ResultPreview state={preview} apiBaseUrl={apiBaseUrl} memberId={memberId} timeZone={effectiveTimeZone} onSave={saveResultPreview} onOpenReview={setCaptureReviewUrl} onOpenResultReview={openResultReview} /> : null}
      {offlineDraftError ? <OfflineDraftErrorBanner message={offlineDraftError} /> : null}
      {state.status === "loading" && timelineItems.length === 0 ? <LoadingState /> : null}
      {state.status === "loading" && timelineItems.length > 0 ? <LoadingBanner message={hasSearch ? "Updating search results…" : "Refreshing your items…"} /> : null}
      {state.status === "error" && timelineItems.length === 0 ? <ErrorState message={state.message} onRetry={() => void refresh()} /> : null}
      {state.status === "ready" && timelineItems.length === 0 ? <EmptyState searching={hasSearch} onRefresh={() => void refresh()} /> : null}
      {state.status === "error" && timelineItems.length > 0 ? <ErrorBanner message={state.message} onRetry={() => void refresh()} /> : null}
      {home ? <View style={homeStyles.homeSection}><View style={homeStyles.homeSectionHeader}><View><Text style={homeStyles.homeSectionTitle}>Today’s tasks</Text><Text style={homeStyles.homeSectionDetail}>{homeLoadStatus === "loading" ? "Loading tasks…" : `${homeItems.length} remaining`}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open all tasks for today" onPress={onOpenToday}><Text style={homeStyles.homeLink}>All for today ↗</Text></Pressable></View>{homeItems.length === 0 && homeLoadStatus === "ready" ? <Text style={styles.stateText}>Nothing scheduled today.</Text> : null}</View> : null}
      {(home ? homeTimelineItems.length > 0 : timelineItems.length > 0) ? (
        <FlatList
          data={home ? homeTimelineItems : timelineItems}
          keyExtractor={(entry) => entry.kind === "offline_draft" ? `offline:${entry.draft.draftId}` : `${entry.item.kind}:${entry.item.id}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          onEndReached={state.status === "ready" && state.nextCursor && !loadingMore ? () => void load(false, state.nextCursor ?? undefined) : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} /> : state.status === "pagination_error" ? <PaginationError message={state.message} onRetry={() => void load(false, state.failedCursor)} /> : null}
          contentContainerStyle={styles.list}
          renderItem={({ item: entry }) => {
            if (entry.kind === "offline_draft") return <OfflineDraftCard draft={entry.draft} sync={offlineDraftSync[entry.draft.draftId]} deleting={deletingDraftId === entry.draft.draftId} onDelete={() => void deleteOfflineDraft(entry.draft.draftId)} onSync={() => retryOfflineDraft(entry.draft.draftId)} />;
            const item = entry.item;
            if (home && item.kind === "task") return <TaskCard task={toCardTask(item)} timeZone={effectiveTimeZone} today={homeDate} saveState={homeTaskSaveStates[item.id] ?? "saved"} onRetry={() => void setTaskCompleted(item, item.state !== "completed")} onPress={() => onOpenDetail?.(item.detailUrl)} onEdit={() => onEditDetail?.(item.detailUrl)} onSetCompleted={(completed) => setTaskCompleted(item, completed)} />;
            return <ListCard item={item} spaces={spaces} assigning={assigningItemId === item.id} onAssign={(assignable, spaceId) => void assignItem(assignable, spaceId)} onPress={onOpenDetail} />;
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

function toCardTask(item: Extract<MemberListItem, { kind: "task" }>): BrowserFixtureTask {
  return { id: item.id, title: item.title, ...(item.dueAt ? { dueAt: item.dueAt } : {}), status: item.state, tagIds: [], entityIds: [] };
}

function HomeHeader({ taskCount, loading }: { readonly taskCount: number; readonly loading: boolean }) {
  return <View style={homeStyles.homeHeader}><View style={homeStyles.homeDigestLabel}><Text style={homeStyles.homeEyebrow}>TODAY AT A GLANCE</Text><Text style={homeStyles.homePrepared}>PREPARED DIGEST</Text></View><Text style={homeStyles.homeDigestTitle}>Your day, at a glance.</Text><Text style={homeStyles.homeDigestText}>{loading ? "Preparing today’s tasks…" : `${taskCount} ${taskCount === 1 ? "task" : "tasks"} scheduled for today`}</Text><Text style={homeStyles.homeDigestArrow}>↗</Text></View>;
}

function ResultPreview({ state, apiBaseUrl, memberId, timeZone, onSave, onOpenReview, onOpenResultReview }: { readonly state: PreviewState; readonly apiBaseUrl: string; readonly memberId: string; readonly timeZone: string; readonly onSave: () => void; readonly onOpenReview: ((detailUrl: string) => void) | undefined; readonly onOpenResultReview: (item: PreviewItem) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.status !== "preview") return;
    setNow(Date.now());
    const interval = globalThis.setInterval(() => setNow(Date.now()), 250);
    return () => globalThis.clearInterval(interval);
  }, [state.status, state.status === "preview" ? state.expiresAt : null]);

  if (state.status === "processing") return <View accessibilityRole="alert" style={styles.previewPanel}><ActivityIndicator /><Text style={styles.captureTitle}>Processing your Capture…</Text><Text style={styles.captureText}>Your result will appear here when the server confirms it.</Text></View>;
  if (state.status === "failed") return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.captureTitle}>Capture processing failed</Text><Text style={styles.captureText}>Your original Capture remains stored on the server.</Text><PreviewReviewButton captureId={state.captureId} onOpenReview={onOpenReview} /></View>;
  if (state.status === "timed_out") return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.captureTitle}>Processing is taking longer than expected</Text><Text style={styles.captureText}>The server has not confirmed a result. Your original Capture remains stored on the server.</Text><PreviewReviewButton captureId={state.captureId} onOpenReview={onOpenReview} /></View>;
  if (state.status === "saved") return <View accessibilityRole="alert" style={resultStyles.savedCard}><View style={resultStyles.savedMark}><Text style={resultStyles.savedCheck}>✓</Text></View><View style={resultStyles.savedCopy}><Text style={resultStyles.savedTitle}>Saved to your items</Text><Text numberOfLines={2} style={resultStyles.savedDescription}>{previewTitle(state.item)}</Text></View></View>;
  if (state.status === "preview" || state.status === "reviewing") {
    const countdown = state.status === "preview" ? previewCountdown(state.expiresAt, now) : null;
    return <View accessibilityRole="alert" style={resultStyles.card}>
      <View style={resultStyles.header}>
        <View style={resultStyles.readyBadge}><View style={resultStyles.readyDot} /><Text style={resultStyles.readyText}>CAPTURE RESULT</Text></View>
        {countdown ? <View accessibilityRole="timer" accessibilityLabel={`Auto-save in ${countdown.seconds} seconds`} style={resultStyles.timerPill}><Text style={resultStyles.timerLabel}>AUTO-SAVE</Text><Text style={resultStyles.timerValue}>{formatCountdown(countdown.seconds)}</Text></View> : <View style={resultStyles.stoppedPill}><Text style={resultStyles.stoppedText}>TIMER STOPPED</Text></View>}
      </View>
      <Text style={resultStyles.title}>{previewTitle(state.item)}</Text>
      <CaptureResultFacts apiBaseUrl={apiBaseUrl} memberId={memberId} item={state.item} timeZone={timeZone} />
      {!countdown ? <Text style={resultStyles.timerHint}>The countdown stopped while you reviewed the details.</Text> : null}
      <View style={resultStyles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open result details" onPress={() => onOpenResultReview(state.item)} style={resultStyles.detailsButton}><Text style={resultStyles.detailsText}>Open details</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Save result" onPress={onSave} style={resultStyles.saveButton}><Text style={resultStyles.saveText}>Save now</Text></Pressable>
      </View>
    </View>;
  }
  return null;
}

function formatCountdown(totalSeconds: number): string {
  return `0:${totalSeconds.toString().padStart(2, "0")}`;
}

function PreviewReviewButton({ captureId, onOpenReview }: { readonly captureId: string; readonly onOpenReview: ((detailUrl: string) => void) | undefined }) {
  return onOpenReview ? <Pressable accessibilityRole="button" accessibilityLabel="Open Capture review" onPress={() => onOpenReview(`/captures/${captureId}/review`)} style={styles.retry}><Text style={styles.retryText}>Open review</Text></Pressable> : null;
}

type FilterOptionsState =
  | { readonly status: "idle" | "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly spaces: readonly Space[]; readonly tags: readonly Tag[]; readonly entities: readonly Entity[] };

function SearchFilterPanel({ open, text, filters, options, onOpen, onTextChange, onApplyText, onApply, onClear, onRetry }: {
  readonly open: boolean;
  readonly text: string;
  readonly filters: SearchFilters;
  readonly options: FilterOptionsState;
  readonly onOpen: () => void;
  readonly onTextChange: (text: string) => void;
  readonly onApplyText: () => void;
  readonly onApply: (filters: SearchFilters) => void;
  readonly onClear: () => void;
  readonly onRetry: () => void;
}) {
  if (!open) return <Pressable accessibilityRole="button" accessibilityLabel="Open search and filters" onPress={onOpen} style={styles.filterToggle}><Text style={styles.filterToggleText}>Search and filter</Text></Pressable>;
  return <View style={styles.filterPanel}>
    <View style={styles.searchRow}>
      <TextInput accessibilityLabel="Search Task and Note content" placeholder="Search Tasks and Notes" value={text} onChangeText={onTextChange} onSubmitEditing={onApplyText} style={styles.searchInput} />
      <Pressable accessibilityRole="button" accessibilityLabel="Apply content search" onPress={onApplyText} style={styles.filterButton}><Text style={styles.filterButtonText}>Search</Text></Pressable>
    </View>
    {filters.text ? <Text style={styles.filterSummary}>Content: {filters.text}</Text> : null}
    {options.status === "loading" ? <View style={styles.filterStatus}><ActivityIndicator /><Text style={styles.stateText}>Loading filters…</Text></View> : null}
    {options.status === "error" ? <View accessibilityRole="alert" style={styles.filterError}><Text style={styles.errorText}>Couldn’t load filters: {options.message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading filters" onPress={onRetry}><Text style={styles.spaceAction}>Retry filters</Text></Pressable></View> : null}
    {options.status === "ready" ? <View>
      <Text style={styles.filterHeading}>Space</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Filter by unassigned root" onPress={() => onApply(selectUnassignedFilter(filters))}><Text style={styles.filterOption}>{filters.unassigned ? "✓ " : ""}Unassigned root</Text></Pressable>
      {options.spaces.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Filter by Space ${space.name}`} onPress={() => onApply(selectSpaceFilter(filters, space.id))}><Text style={styles.filterOption}>{filters.spaceId === space.id ? "✓ " : ""}{space.name} subtree</Text></Pressable>)}
      <Text style={styles.filterHeading}>Tag</Text>
      {options.tags.length === 0 ? <Text style={styles.filterMuted}>No Tags yet</Text> : options.tags.map((tag) => <Pressable key={tag.id} accessibilityRole="button" accessibilityLabel={`Filter by Tag ${tag.name}`} onPress={() => onApply(toggleIdFilter(filters, "tagId", tag.id))}><Text style={styles.filterOption}>{filters.tagId === tag.id ? "✓ " : ""}{tag.name}</Text></Pressable>)}
      <Text style={styles.filterHeading}>Entity</Text>
      {options.entities.length === 0 ? <Text style={styles.filterMuted}>No Entities yet</Text> : options.entities.map((entity) => <Pressable key={entity.id} accessibilityRole="button" accessibilityLabel={`Filter by Entity ${entity.name}`} onPress={() => onApply(toggleIdFilter(filters, "entityId", entity.id))}><Text style={styles.filterOption}>{filters.entityId === entity.id ? "✓ " : ""}{entity.name} ({entity.type})</Text></Pressable>)}
    </View> : null}
    {(hasActiveFilters(filters) || text.length > 0) ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search and filters" onPress={onClear} style={styles.clearFilters}><Text style={styles.clearFiltersText}>Clear search and filters</Text></Pressable> : null}
  </View>;
}

function previewTitle(item: PreviewItem): string {
  return item.kind === "task" ? item.title : item.content;
}

function CapturePanel({ state, recordingElapsedSeconds, recordingMetering, recordingInterrupted, onStop, onCancel, onSubmit }: { readonly state: CaptureState; readonly recordingElapsedSeconds: number; readonly recordingMetering?: number | undefined; readonly recordingInterrupted: boolean; readonly onStop: () => void; readonly onCancel: () => void; readonly onSubmit: (audio: RecordedAudio) => void }) {
  if (state.status === "permission_denied" || state.status === "error") return <View accessibilityRole="alert" style={styles.capturePanel}><Text style={styles.captureTitle}>{state.status === "permission_denied" ? "Microphone access denied" : "Could not start recording"}</Text><Text style={styles.captureText}>{state.message}</Text><ActionButton icon="×" label="Dismiss" onPress={onCancel} /> </View>;
  if (state.status === "requesting") return <View style={styles.capturePanel}><ActivityIndicator /><Text style={styles.captureText}>Requesting microphone access…</Text></View>;
  if (state.status === "recording") return <View accessibilityRole="alert" style={[styles.capturePanel, styles.recordingPanel]}><View style={styles.recordingHeader}><View style={styles.recordingDot} /><Text style={styles.recordingTitle}>Recording Capture</Text><Text accessibilityLabel="Recording duration" style={styles.recordingTimer}>{formatDuration(recordingElapsedSeconds)}</Text></View><Text style={styles.recordingText}>Speak clearly, then submit when finished.</Text><AudioWaveform metering={recordingMetering} /><Text style={styles.meteringStatus}>{recordingInterrupted ? "Microphone input was interrupted. You can still finish this recording." : recordingMetering === undefined ? "Microphone level unavailable; recording continues." : "Waveform follows microphone level."}</Text><View style={styles.captureActions}><ActionButton icon="×" label="Cancel" onPress={onCancel} variant="secondary" tone="recording" /><ActionButton icon="■" label="Finish recording" onPress={onStop} tone="recording" /></View></View>;
  if (state.status === "stopping" || state.status === "submitting") return <View style={styles.capturePanel}><ActivityIndicator /><Text style={styles.captureText}>{state.status === "stopping" ? "Preparing your Capture…" : "Submitting your Capture…"}</Text></View>;
  if (state.status !== "ready" && state.status !== "failed") return null;
  return <View accessibilityRole="alert" style={styles.capturePanel}><Text style={styles.captureTitle}>{state.status === "failed" ? "Capture submission failed" : "Capture ready"}</Text>{state.status === "failed" ? <Text style={styles.captureText}>{state.message}</Text> : <Text style={styles.captureText}>Submit this recording to your private timeline?</Text>}<View style={styles.captureActions}><ActionButton icon="×" label="Discard" onPress={onCancel} variant="secondary" /><ActionButton icon="↑" label={state.status === "failed" ? "Retry submission" : "Submit Capture"} onPress={() => onSubmit(state.audio)} /></View></View>;
}

function ActionButton({ icon, label, onPress, variant = "primary", tone = "default" }: { readonly icon: string; readonly label: string; readonly onPress: () => void; readonly variant?: "primary" | "secondary"; readonly tone?: "default" | "recording" }) {
  const isRecording = tone === "recording";
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.actionButton, variant === "secondary" ? styles.secondaryButton : styles.captureButton, variant === "primary" && styles.actionPrimaryButton, isRecording && (variant === "secondary" ? styles.recordingSecondaryButton : styles.recordingButton)]}><View style={styles.actionButtonContent}><Text style={isRecording ? styles.recordingIcon : styles.actionIcon}>{icon}</Text><Text style={isRecording ? (variant === "secondary" ? styles.recordingSecondaryButtonText : styles.recordingButtonText) : (variant === "secondary" ? styles.secondaryButtonText : styles.captureButtonText)}>{label}</Text></View></Pressable>;
}

function AudioWaveform({ metering }: { readonly metering?: number | undefined }) {
  const bars = createWaveformBars(metering);
  return <View accessibilityLabel="Recording waveform" style={[styles.waveform, styles.recordingWaveform]}>{bars.map((height, index) => <View key={index} style={[styles.waveformBar, styles.recordingWaveformBar, { height }]} />)}</View>;
}

function OfflineDraftCard({ draft, sync, deleting, onDelete, onSync }: { readonly draft: OfflineDraft; readonly sync?: OfflineDraftSynchronizationResult | undefined; readonly deleting: boolean; readonly onDelete: () => void; readonly onSync: () => void }) {
  const title = draft.source.kind === "audio" ? "Voice Capture" : draft.source.text;
  const status = sync?.state === "confirmed" ? "Confirmed by server" : sync?.state === "processing" ? "Synchronizing…" : sync?.state === "accepted" ? "Accepted · waiting for server result" : sync?.state === "failed" ? sync.message ?? "Synchronization failed" : "Not confirmed · Waiting to synchronize";
  const canSync = sync === undefined || sync.state === "accepted" || (sync.state === "failed" && sync.retryable);
  return <View accessibilityLabel={`Offline draft, not confirmed: ${title}`} style={[styles.card, styles.offlineDraftCard]}>
    <View style={styles.cardHeader}><Text style={styles.offlineDraftLabel}>Offline draft</Text><Text style={styles.date}>{formatDate(draft.capturedAt)}</Text></View>
    <Text style={cardTitleStyle}>{title}</Text>
    <Text style={styles.offlineDraftStatus}>{status}</Text>
    {canSync ? <Pressable accessibilityRole="button" accessibilityLabel={`${sync?.state === "failed" ? "Retry" : "Synchronize"} Offline draft ${title}`} disabled={deleting} onPress={onSync}><Text style={styles.retryDraft}>{sync?.state === "failed" ? "Retry synchronization" : "Synchronize now"}</Text></Pressable> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`Delete Offline draft ${title}`} disabled={deleting} onPress={onDelete}><Text style={styles.deleteDraft}>{deleting ? "Deleting…" : "Delete draft"}</Text></Pressable>
  </View>;
}

function ListCard({ item, spaces, assigning, onAssign, onPress }: { readonly item: MemberListItem; readonly spaces: readonly Space[]; readonly assigning: boolean; readonly onAssign: (item: AssignableItem, spaceId: string | null) => void; readonly onPress: ((detailUrl: string) => void) | undefined }) {
  const label = listItemLabel(item);
  const title = item.kind === "task" ? item.title : item.kind === "note" ? item.content : item.state === "failed" ? "Capture processing failed" : "Processing your Capture";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${title}`} onPress={() => onPress?.(item.detailUrl)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardHeader}><Text style={styles.label}>{label}</Text><Text style={styles.date}>{formatDate(item.createdAt)}</Text></View>
      <Text style={cardTitleStyle}>{title}</Text>
      {item.kind === "task" && item.dueAt ? <Text style={styles.detail}>Due {formatDate(item.dueAt)}</Text> : null}
      {item.kind === "note" && item.state === "needs_review" ? <Text style={styles.reviewHint}>Review this item to confirm what it means.</Text> : null}
      {item.kind === "capture" && item.state === "failed" ? <Text style={styles.reviewHint}>Open review to inspect the failure.</Text> : null}
      {item.kind !== "capture" ? <View><Text style={styles.spaceLabel}>{assigning ? "Updating Space…" : item.spaceId ? `Space: ${spaces.find((space) => space.id === item.spaceId)?.name ?? "Assigned"}` : "Unassigned"}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Assign ${label} to Unassigned`} disabled={assigning} onPress={() => onAssign(item, null)}><Text style={styles.spaceAction}>Move to Unassigned</Text></Pressable>{spaces.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Assign ${label} to ${space.name}`} disabled={assigning} onPress={() => onAssign(item, space.id)}><Text style={styles.spaceAction}>Move to {space.name}</Text></Pressable>)}</View> : null}
    </Pressable>
  );
}

function appendUniqueItems(existing: readonly MemberListItem[], next: readonly MemberListItem[]): readonly MemberListItem[] {
  const seen = new Set(existing.map((item) => item.id));
  return [...existing, ...next.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })];
}

function hasActiveFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== "");
}

function withTextFilter(filters: SearchFilters, text: string): SearchFilters {
  const { text: _ignored, ...rest } = filters;
  return text.trim() ? { ...rest, text: text.trim() } : rest;
}

function selectUnassignedFilter(filters: SearchFilters): SearchFilters {
  const { spaceId: _spaceId, unassigned: current, ...rest } = filters;
  return current ? rest : { ...rest, unassigned: true };
}

function selectSpaceFilter(filters: SearchFilters, spaceId: string): SearchFilters {
  const { unassigned: _unassigned, spaceId: current, ...rest } = filters;
  return current === spaceId ? rest : { ...rest, spaceId };
}

function toggleIdFilter(filters: SearchFilters, key: "tagId" | "entityId", value: string): SearchFilters {
  const { [key]: current, ...rest } = filters;
  return current === value ? rest : { ...rest, [key]: value } as SearchFilters;
}

function LoadingState() { return <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading items" /><Text style={styles.stateText}>Loading your items…</Text></View>; }
function LoadingBanner({ message }: { readonly message: string }) { return <View accessibilityRole="alert" style={styles.errorBanner}><ActivityIndicator /><Text style={styles.errorText}>{message}</Text></View>; }
function EmptyState({ searching, onRefresh }: { readonly searching: boolean; readonly onRefresh: () => void }) { return <View style={styles.state}><Text style={styles.stateTitle}>{searching ? "No matching items" : "Nothing here yet"}</Text><Text style={styles.stateText}>{searching ? "Try clearing a filter or changing your search." : "Your Tasks and Notes will appear here after your first Capture."}</Text><Pressable accessibilityRole="button" onPress={onRefresh} style={styles.retry}><Text style={styles.retryText}>Refresh</Text></Pressable></View>; }
function ErrorBanner({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Refresh failed: {message}</Text>{onRetry ? <Pressable accessibilityRole="button" accessibilityLabel="Retry refreshing items" onPress={onRetry}><Text style={styles.retryText}>Retry</Text></Pressable> : null}</View>; }
function PaginationError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Couldn’t load more items: {message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading more items" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry loading more items</Text></Pressable></View>; }
function OfflineDraftErrorBanner({ message }: { readonly message: string }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{message}</Text></View>; }
function ErrorState({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <View style={styles.state}><Text style={styles.stateTitle}>Couldn’t load your items</Text><Text style={styles.stateText}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View>; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function formatDuration(totalSeconds: number): string { const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0"); const seconds = (totalSeconds % 60).toString().padStart(2, "0"); return `${minutes}:${seconds}`; }

const cardTitleStyle = { color: "#24221F", fontSize: 18, fontWeight: "600" as const, lineHeight: 24 };

const homeStyles = StyleSheet.create({
  homeHeader: { backgroundColor: "#173B2F", borderRadius: 26, marginHorizontal: 16, marginBottom: 18, padding: 22 }, homeDigestLabel: { flexDirection: "row", justifyContent: "space-between" }, homeEyebrow: { color: "#D7F04A", fontSize: 10, fontWeight: "700", letterSpacing: 1.6 }, homePrepared: { color: "#B8C9BF", fontSize: 9 }, homeDigestTitle: { color: "#FFFFFF", fontSize: 31, fontWeight: "600", marginVertical: 18 }, homeDigestText: { color: "#D2DFD7", fontSize: 14, lineHeight: 20, paddingRight: 28 }, homeDigestArrow: { color: "#D7F04A", fontSize: 28, position: "absolute", right: 22, bottom: 18 }, homeSection: { marginHorizontal: 16, marginBottom: 8 }, homeSectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, homeSectionTitle: { color: "#24221F", fontSize: 20, fontWeight: "700" }, homeSectionDetail: { color: "#716B64", fontSize: 13, marginTop: 4 }, homeLink: { color: "#173B2F", fontSize: 13, fontWeight: "700" },
});

const styles = StyleSheet.create({
  filterToggle: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, padding: 12 }, filterToggleText: { color: "#5D5146", fontSize: 15, fontWeight: "600", textAlign: "center" }, filterPanel: { backgroundColor: "#FFFDF9", borderColor: "#E5E0D8", borderRadius: 14, borderWidth: 1, marginHorizontal: 16, marginBottom: 12, padding: 14 }, searchRow: { alignItems: "center", flexDirection: "row", gap: 8 }, searchInput: { borderColor: "#B9A895", borderRadius: 10, borderWidth: 1, color: "#24221F", flex: 1, minHeight: 44, paddingHorizontal: 12 }, filterButton: { backgroundColor: "#24221F", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 }, filterButtonText: { color: "#FFFFFF", fontWeight: "700" }, filterSummary: { color: "#5D5146", fontSize: 13, marginTop: 10 }, filterStatus: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 12 }, filterError: { backgroundColor: "#FCE8DF", borderRadius: 8, marginTop: 12, padding: 10 }, filterHeading: { color: "#8B7355", fontSize: 12, fontWeight: "700", marginTop: 14, textTransform: "uppercase" }, filterOption: { color: "#5D5146", fontSize: 15, paddingVertical: 7 }, filterMuted: { color: "#908A82", fontSize: 14, paddingVertical: 7 }, clearFilters: { borderColor: "#B9A895", borderRadius: 10, borderWidth: 1, marginTop: 14, padding: 10 }, clearFiltersText: { color: "#8C3D25", fontSize: 14, fontWeight: "700", textAlign: "center" },
  spaceLabel: { color: "#716B64", fontSize: 13, marginTop: 12 }, spaceAction: { color: "#7A5C36", fontSize: 13, fontWeight: "600", marginTop: 8 },
  safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 34, fontWeight: "700", marginTop: 6 }, captureButton: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 12, paddingHorizontal: 16, paddingVertical: 11, alignSelf: "flex-start" }, captureButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" }, actionButton: { alignItems: "center", flex: 1, height: 48, justifyContent: "center", paddingHorizontal: 12 }, actionPrimaryButton: { alignSelf: "stretch", marginTop: 0 }, actionButtonContent: { alignItems: "center", flexDirection: "row", gap: 6 }, actionIcon: { fontSize: 16, fontWeight: "700", lineHeight: 18 }, capturePanel: { backgroundColor: "#FFF4E8", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 14 }, previewPanel: { backgroundColor: "#FFF4E8", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 14 }, previewEyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, recordingPanel: { backgroundColor: "#FCE8E5", borderColor: "#E5A49B", borderWidth: 1 }, captureTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" }, recordingTitle: { color: "#B43C32", fontSize: 17, fontWeight: "700" }, recordingText: { color: "#8C3D25", fontSize: 15, lineHeight: 21, marginTop: 6 }, meteringStatus: { color: "#8C3D25", fontSize: 12, lineHeight: 18, marginTop: 6 }, recordingHeader: { alignItems: "center", flexDirection: "row", gap: 8 }, recordingDot: { backgroundColor: "#C44739", borderRadius: 5, height: 10, width: 10 }, recordingTimer: { color: "#B43C32", fontSize: 16, fontVariant: ["tabular-nums"], marginLeft: "auto" }, waveform: { alignItems: "center", flexDirection: "row", gap: 3, height: 44, justifyContent: "center", marginTop: 14 }, recordingWaveform: { backgroundColor: "#F8D5D0", borderRadius: 14 }, waveformBar: { backgroundColor: "#D9A88A", borderRadius: 2, minHeight: 6, width: 4 }, recordingWaveformBar: { backgroundColor: "#E08B80" }, recordingWaveformBarActive: { backgroundColor: "#B43C32" }, captureText: { color: "#716B64", fontSize: 15, lineHeight: 21, marginTop: 6 }, captureActions: { alignItems: "stretch", flexDirection: "row", gap: 10, marginTop: 14 }, secondaryButton: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 10 }, secondaryButtonText: { color: "#5D5146", fontSize: 15, fontWeight: "600" }, recordingButton: { backgroundColor: "#B43C32" }, recordingButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" }, recordingSecondaryButton: { borderColor: "#B43C32" }, recordingSecondaryButtonText: { color: "#B43C32", fontSize: 15, fontWeight: "600" }, recordingIcon: { color: "#B43C32", fontSize: 16, fontWeight: "700", lineHeight: 18 }, list: { padding: 16, paddingTop: 4, gap: 12 }, card: { backgroundColor: "#FFFFFF", borderColor: "#E5E0D8", borderRadius: 16, borderWidth: 1, padding: 18 }, offlineDraftCard: { backgroundColor: "#FFF8E8", borderColor: "#CFAE70", borderStyle: "dashed" }, offlineDraftLabel: { color: "#8C641F", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, offlineDraftStatus: { color: "#8C641F", fontSize: 14, fontWeight: "600", marginTop: 8 }, retryDraft: { color: "#8C641F", fontSize: 14, fontWeight: "700", marginTop: 14 }, deleteDraft: { color: "#8C3D25", fontSize: 14, fontWeight: "600", marginTop: 14 }, cardPressed: { opacity: 0.7 }, cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, label: { color: "#7A5C36", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, date: { color: "#908A82", fontSize: 12 }, detail: { color: "#716B64", fontSize: 14, marginTop: 8 }, reviewHint: { color: "#A15B2A", fontSize: 14, marginTop: 8 }, errorBanner: { backgroundColor: "#FCE8DF", marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10 }, errorText: { color: "#8C3D25", fontSize: 14 }, state: { alignItems: "center", flex: 1, justifyContent: "center", padding: 32 }, stateTitle: { color: "#24221F", fontSize: 20, fontWeight: "700", textAlign: "center" }, stateText: { color: "#716B64", fontSize: 16, lineHeight: 23, marginTop: 8, maxWidth: 300, textAlign: "center" }, retry: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 }, retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" }, footer: { padding: 16 },
});

const resultStyles = StyleSheet.create({
  card: { backgroundColor: "#FFFFFF", borderColor: "#D7E2DB", borderRadius: 22, borderWidth: 1, elevation: 5, marginHorizontal: 16, marginBottom: 14, padding: 20, shadowColor: "#173B2F", shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.13, shadowRadius: 14 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", gap: 10 },
  readyBadge: { alignItems: "center", backgroundColor: "#EAF1ED", borderRadius: 99, flexDirection: "row", gap: 7, paddingHorizontal: 11, paddingVertical: 8 },
  readyDot: { backgroundColor: "#31745D", borderRadius: 4, height: 8, width: 8 },
  readyText: { color: "#245542", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  timerPill: { alignItems: "center", backgroundColor: "#F4F7D8", borderColor: "#D7E373", borderRadius: 13, borderWidth: 1, flexDirection: "row", gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
  timerLabel: { color: "#56651B", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  timerValue: { color: "#29350D", fontSize: 16, fontVariant: ["tabular-nums"], fontWeight: "800" },
  stoppedPill: { backgroundColor: "#F1EFEB", borderRadius: 13, paddingHorizontal: 10, paddingVertical: 9 },
  stoppedText: { color: "#716B64", fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  title: { color: "#24221F", fontSize: 23, fontWeight: "700", lineHeight: 30, marginTop: 18 },
  timerHint: { color: "#716B64", fontSize: 12, lineHeight: 17, marginTop: 8 },
  actions: { flexDirection: "row", gap: 10, marginTop: 17 },
  detailsButton: { alignItems: "center", borderColor: "#B8C9BF", borderRadius: 13, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 12 },
  detailsText: { color: "#245542", fontSize: 14, fontWeight: "700" },
  saveButton: { alignItems: "center", backgroundColor: "#173B2F", borderRadius: 13, flex: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 12 },
  saveText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  savedCard: { alignItems: "center", backgroundColor: "#EAF1ED", borderColor: "#C7D9CE", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 12, marginHorizontal: 16, marginBottom: 14, padding: 15 },
  savedMark: { alignItems: "center", backgroundColor: "#31745D", borderRadius: 14, height: 30, justifyContent: "center", width: 30 },
  savedCheck: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  savedCopy: { flex: 1 },
  savedTitle: { color: "#245542", fontSize: 15, fontWeight: "700" },
  savedDescription: { color: "#566A5E", fontSize: 13, lineHeight: 18, marginTop: 2 },
});
