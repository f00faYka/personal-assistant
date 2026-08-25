import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createIdempotencyKey, type CaptureSubmitter, type RecordedAudio, type VoiceRecorder } from "../capture/voice-capture";
import { createWaveformBars } from "../capture/audio-waveform";
import { shouldPersistOfflineDraft } from "../http/request-error";
import type { OfflineDraft, OfflineDraftStore } from "../offline/offline-drafts";
import type { OfflineDraftSynchronizationResult, OfflineDraftSyncClient } from "../offline/synchronize-offline-drafts";
import { createMemberItemsClient, initialListState, listItemLabel, listStateFromError, listStateFromPage, paginationStateFromError, type ListState, type MemberListItem } from "./member-items";
import { beginPreview, expirePreview, resolvePreview, savePreview, timeOutPreview, type PreviewItem, type PreviewState } from "../preview/result-preview";

interface MemberListScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly onOpenDetail?: (detailUrl: string) => void;
  readonly voiceRecorder?: VoiceRecorder;
  readonly recordingMetering?: number | undefined;
  readonly recordingInterrupted?: boolean;
  readonly captureSubmitter?: CaptureSubmitter;
  readonly offlineDraftStore?: OfflineDraftStore;
  readonly offlineDraftSyncClient?: OfflineDraftSyncClient;
}

type CaptureState =
  | { readonly status: "idle" }
  | { readonly status: "requesting" | "recording" | "stopping" | "submitting" }
  | { readonly status: "permission_denied" | "error"; readonly message: string }
  | { readonly status: "ready" | "failed"; readonly audio: RecordedAudio; readonly message?: string };

type TimelineItem =
  | { readonly kind: "offline_draft"; readonly draft: OfflineDraft }
  | { readonly kind: "server_item"; readonly item: MemberListItem };

export function MemberListScreen({ apiBaseUrl, memberId, onOpenDetail, voiceRecorder, recordingMetering, recordingInterrupted = false, captureSubmitter, offlineDraftStore, offlineDraftSyncClient }: MemberListScreenProps) {
  const client = useMemo(() => createMemberItemsClient(apiBaseUrl), [apiBaseUrl]);
  const [state, setState] = useState<ListState>(initialListState);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [capture, setCapture] = useState<CaptureState>({ status: "idle" });
  const [offlineDrafts, setOfflineDrafts] = useState<readonly OfflineDraft[]>([]);
  const [offlineDraftError, setOfflineDraftError] = useState<string | null>(null);
  const [offlineDraftSync, setOfflineDraftSync] = useState<Record<string, OfflineDraftSynchronizationResult>>({});
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const submissionInFlight = useRef(false);
  const captureKey = useRef<string | null>(null);
  const captureCreatedAt = useRef<string | null>(null);
  const loadingCursor = useRef<string | null>(null);
  const deletedOfflineDraftIds = useRef(new Set<string>());

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

  const load = useCallback(async (isRefresh = false, cursor?: string) => {
    if (isRefresh) setRefreshing(true);
    else if (cursor) {
      if (loadingCursor.current === cursor) return;
      loadingCursor.current = cursor;
      setLoadingMore(true);
    }
    else setState((current) => ({ status: "loading", items: current.items }));
    try {
      const page = await client.list(memberId, cursor);
      setState((current) => {
        const nextPage = listStateFromPage(page);
        return { ...nextPage, items: cursor ? appendUniqueItems(current.items, nextPage.items) : nextPage.items };
      });
    } catch (error) {
      setState((current) => cursor ? paginationStateFromError(current.items, cursor, error) : listStateFromError(current.items, error));
    } finally {
      setRefreshing(false);
      setLoadingMore(false);
      if (cursor) loadingCursor.current = null;
    }
  }, [client, memberId]);

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
      const result = await captureSubmitter.submit({ memberId, idempotencyKey: draftId, audio, capturedAt });
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
          const draft = await offlineDraftStore.save({ draftId, memberId, capturedAt, source: { kind: "audio", uri: audio.uri, contentType: audio.contentType } });
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
  }, [captureSubmitter, memberId, offlineDraftStore, synchronizeDraft, voiceRecorder]);

  useEffect(() => { void load(); }, [load]);

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
        setPreview((current) => current ? resolvePreview(current, page.items, Date.now()) : current);
      } catch {
        // Keep the processing state honest; the next poll can recover a transient read failure.
      }
      if (!cancelled) globalThis.setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { cancelled = true; };
  }, [client, memberId, preview]);

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
    void load(true);
  }, [load]);

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

  const timelineItems: readonly TimelineItem[] = [
    ...offlineDrafts.map((draft): TimelineItem => ({ kind: "offline_draft", draft })),
    ...state.items.map((item): TimelineItem => ({ kind: "server_item", item })),
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>D · SUMMARY TIMELINE</Text>
        <Text style={styles.title}>Your items</Text>
        {voiceRecorder && capture.status === "idle" ? <Pressable accessibilityRole="button" accessibilityLabel="Record a voice Capture" onPress={() => void startCapture()} style={styles.captureButton}><Text style={styles.captureButtonText}>Record a Capture</Text></Pressable> : null}
      </View>
      {voiceRecorder && capture.status !== "idle" ? <CapturePanel state={capture} recordingElapsedSeconds={recordingElapsedSeconds} recordingMetering={recordingMetering} recordingInterrupted={recordingInterrupted} onStop={() => void stopCapture()} onCancel={() => void cancelCapture()} onSubmit={(audio) => void submitCapture(audio)} /> : null}
      {preview ? <ResultPreview state={preview} onSave={saveResultPreview} /> : null}
      {offlineDraftError ? <OfflineDraftErrorBanner message={offlineDraftError} /> : null}
      {state.status === "loading" && timelineItems.length === 0 ? <LoadingState /> : null}
      {state.status === "error" && timelineItems.length === 0 ? <ErrorState message={state.message} onRetry={() => void load()} /> : null}
      {state.status === "ready" && timelineItems.length === 0 ? <EmptyState onRefresh={() => void load(true)} /> : null}
      {state.status === "error" && timelineItems.length > 0 ? <ErrorBanner message={state.message} /> : null}
      {timelineItems.length > 0 ? (
        <FlatList
          data={timelineItems}
          keyExtractor={(entry) => entry.kind === "offline_draft" ? `offline:${entry.draft.draftId}` : `${entry.item.kind}:${entry.item.id}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          onEndReached={state.status === "ready" && state.nextCursor && !loadingMore ? () => void load(false, state.nextCursor ?? undefined) : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} /> : state.status === "pagination_error" ? <PaginationError message={state.message} onRetry={() => void load(false, state.failedCursor)} /> : null}
          contentContainerStyle={styles.list}
          renderItem={({ item: entry }) => entry.kind === "offline_draft"
            ? <OfflineDraftCard draft={entry.draft} sync={offlineDraftSync[entry.draft.draftId]} deleting={deletingDraftId === entry.draft.draftId} onDelete={() => void deleteOfflineDraft(entry.draft.draftId)} onSync={() => retryOfflineDraft(entry.draft.draftId)} />
            : <ListCard item={entry.item} onPress={onOpenDetail} />}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ResultPreview({ state, onSave }: { readonly state: PreviewState; readonly onSave: () => void }) {
  if (state.status === "processing") return <View accessibilityRole="alert" style={styles.previewPanel}><ActivityIndicator /><Text style={styles.captureTitle}>Processing your Capture…</Text><Text style={styles.captureText}>Your result will appear here when the server confirms it.</Text></View>;
  if (state.status === "failed") return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.captureTitle}>Capture processing failed</Text><Text style={styles.captureText}>Your original Capture remains stored on the server.</Text></View>;
  if (state.status === "timed_out") return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.captureTitle}>Processing is taking longer than expected</Text><Text style={styles.captureText}>The server has not confirmed a result. Your original Capture remains stored on the server.</Text></View>;
  if (state.status === "saved") return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.captureTitle}>Saved</Text><Text style={styles.captureText}>{previewTitle(state.item)}</Text></View>;
  return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.previewEyebrow}>RESULT</Text><Text style={styles.captureTitle}>{previewTitle(state.item)}</Text>{state.item.kind === "note" ? <Text style={styles.captureText}>{state.item.content}</Text> : state.item.dueAt ? <Text style={styles.captureText}>Due {formatDate(state.item.dueAt)}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="Save result" onPress={onSave} style={styles.retry}><Text style={styles.retryText}>Save</Text></Pressable></View>;
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

function ListCard({ item, onPress }: { readonly item: MemberListItem; readonly onPress: ((detailUrl: string) => void) | undefined }) {
  const label = listItemLabel(item);
  const title = item.kind === "task" ? item.title : item.kind === "note" ? item.content : item.state === "failed" ? "Capture processing failed" : "Processing your Capture";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${title}`} onPress={() => onPress?.(item.detailUrl)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardHeader}><Text style={styles.label}>{label}</Text><Text style={styles.date}>{formatDate(item.createdAt)}</Text></View>
      <Text style={cardTitleStyle}>{title}</Text>
      {item.kind === "task" && item.dueAt ? <Text style={styles.detail}>Due {formatDate(item.dueAt)}</Text> : null}
      {item.kind === "note" && item.state === "needs_review" ? <Text style={styles.reviewHint}>Review this item to confirm what it means.</Text> : null}
      {item.kind === "capture" && item.state === "failed" ? <Text style={styles.reviewHint}>Open review to inspect the failure.</Text> : null}
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

function LoadingState() { return <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading items" /><Text style={styles.stateText}>Loading your items…</Text></View>; }
function EmptyState({ onRefresh }: { readonly onRefresh: () => void }) { return <View style={styles.state}><Text style={styles.stateTitle}>Nothing here yet</Text><Text style={styles.stateText}>Your Tasks and Notes will appear here after your first Capture.</Text><Pressable accessibilityRole="button" onPress={onRefresh} style={styles.retry}><Text style={styles.retryText}>Refresh</Text></Pressable></View>; }
function ErrorBanner({ message }: { readonly message: string }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Refresh failed: {message}</Text></View>; }
function PaginationError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Couldn’t load more items: {message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading more items" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Retry loading more items</Text></Pressable></View>; }
function OfflineDraftErrorBanner({ message }: { readonly message: string }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{message}</Text></View>; }
function ErrorState({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <View style={styles.state}><Text style={styles.stateTitle}>Couldn’t load your items</Text><Text style={styles.stateText}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View>; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function formatDuration(totalSeconds: number): string { const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0"); const seconds = (totalSeconds % 60).toString().padStart(2, "0"); return `${minutes}:${seconds}`; }

const cardTitleStyle = { color: "#24221F", fontSize: 18, fontWeight: "600" as const, lineHeight: 24 };

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 34, fontWeight: "700", marginTop: 6 }, captureButton: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 12, paddingHorizontal: 16, paddingVertical: 11, alignSelf: "flex-start" }, captureButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" }, actionButton: { alignItems: "center", flex: 1, height: 48, justifyContent: "center", paddingHorizontal: 12 }, actionPrimaryButton: { alignSelf: "stretch", marginTop: 0 }, actionButtonContent: { alignItems: "center", flexDirection: "row", gap: 6 }, actionIcon: { fontSize: 16, fontWeight: "700", lineHeight: 18 }, capturePanel: { backgroundColor: "#FFF4E8", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 14 }, previewPanel: { backgroundColor: "#FFF4E8", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 14 }, previewEyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, recordingPanel: { backgroundColor: "#FCE8E5", borderColor: "#E5A49B", borderWidth: 1 }, captureTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" }, recordingTitle: { color: "#B43C32", fontSize: 17, fontWeight: "700" }, recordingText: { color: "#8C3D25", fontSize: 15, lineHeight: 21, marginTop: 6 }, meteringStatus: { color: "#8C3D25", fontSize: 12, lineHeight: 18, marginTop: 6 }, recordingHeader: { alignItems: "center", flexDirection: "row", gap: 8 }, recordingDot: { backgroundColor: "#C44739", borderRadius: 5, height: 10, width: 10 }, recordingTimer: { color: "#B43C32", fontSize: 16, fontVariant: ["tabular-nums"], marginLeft: "auto" }, waveform: { alignItems: "center", flexDirection: "row", gap: 3, height: 44, justifyContent: "center", marginTop: 14 }, recordingWaveform: { backgroundColor: "#F8D5D0", borderRadius: 14 }, waveformBar: { backgroundColor: "#D9A88A", borderRadius: 2, minHeight: 6, width: 4 }, recordingWaveformBar: { backgroundColor: "#E08B80" }, recordingWaveformBarActive: { backgroundColor: "#B43C32" }, captureText: { color: "#716B64", fontSize: 15, lineHeight: 21, marginTop: 6 }, captureActions: { alignItems: "stretch", flexDirection: "row", gap: 10, marginTop: 14 }, secondaryButton: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 10 }, secondaryButtonText: { color: "#5D5146", fontSize: 15, fontWeight: "600" }, recordingButton: { backgroundColor: "#B43C32" }, recordingButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" }, recordingSecondaryButton: { borderColor: "#B43C32" }, recordingSecondaryButtonText: { color: "#B43C32", fontSize: 15, fontWeight: "600" }, recordingIcon: { color: "#B43C32", fontSize: 16, fontWeight: "700", lineHeight: 18 }, list: { padding: 16, paddingTop: 4, gap: 12 }, card: { backgroundColor: "#FFFFFF", borderColor: "#E5E0D8", borderRadius: 16, borderWidth: 1, padding: 18 }, offlineDraftCard: { backgroundColor: "#FFF8E8", borderColor: "#CFAE70", borderStyle: "dashed" }, offlineDraftLabel: { color: "#8C641F", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, offlineDraftStatus: { color: "#8C641F", fontSize: 14, fontWeight: "600", marginTop: 8 }, retryDraft: { color: "#8C641F", fontSize: 14, fontWeight: "700", marginTop: 14 }, deleteDraft: { color: "#8C3D25", fontSize: 14, fontWeight: "600", marginTop: 14 }, cardPressed: { opacity: 0.7 }, cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, label: { color: "#7A5C36", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, date: { color: "#908A82", fontSize: 12 }, detail: { color: "#716B64", fontSize: 14, marginTop: 8 }, reviewHint: { color: "#A15B2A", fontSize: 14, marginTop: 8 }, errorBanner: { backgroundColor: "#FCE8DF", marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10 }, errorText: { color: "#8C3D25", fontSize: 14 }, state: { alignItems: "center", flex: 1, justifyContent: "center", padding: 32 }, stateTitle: { color: "#24221F", fontSize: 20, fontWeight: "700", textAlign: "center" }, stateText: { color: "#716B64", fontSize: 16, lineHeight: 23, marginTop: 8, maxWidth: 300, textAlign: "center" }, retry: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 }, retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" }, footer: { padding: 16 },
});
