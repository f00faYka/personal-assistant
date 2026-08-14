import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { createIdempotencyKey, type CaptureSubmitter, type RecordedAudio, type VoiceRecorder } from "../capture/voice-capture";
import { createMemberItemsClient, initialListState, listItemLabel, listStateFromError, listStateFromPage, type ListState, type MemberListItem } from "./member-items";

interface MemberListScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly onOpenDetail?: (detailUrl: string) => void;
  readonly voiceRecorder?: VoiceRecorder;
  readonly captureSubmitter?: CaptureSubmitter;
}

type CaptureState =
  | { readonly status: "idle" }
  | { readonly status: "requesting" | "recording" | "stopping" | "submitting" }
  | { readonly status: "permission_denied" | "error"; readonly message: string }
  | { readonly status: "ready" | "failed"; readonly audio: RecordedAudio; readonly message?: string };

export function MemberListScreen({ apiBaseUrl, memberId, onOpenDetail, voiceRecorder, captureSubmitter }: MemberListScreenProps) {
  const client = useMemo(() => createMemberItemsClient(apiBaseUrl), [apiBaseUrl]);
  const [state, setState] = useState<ListState>(initialListState);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [capture, setCapture] = useState<CaptureState>({ status: "idle" });
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState(0);
  const submissionInFlight = useRef(false);
  const captureKey = useRef<string | null>(null);
  const loadingCursor = useRef<string | null>(null);

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
        return { ...nextPage, items: cursor ? [...current.items, ...nextPage.items] : nextPage.items };
      });
    } catch (error) {
      setState((current) => listStateFromError(current.items, error));
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
      return;
    }
    if (!voiceRecorder || (capture.status !== "recording" && capture.status !== "stopping")) return;
    await voiceRecorder.cancel();
    captureKey.current = null;
    setCapture({ status: "idle" });
  }, [capture.status, voiceRecorder]);

  const submitCapture = useCallback(async (audio: RecordedAudio) => {
    if (!captureSubmitter || submissionInFlight.current || !captureKey.current) return;
    submissionInFlight.current = true;
    setCapture({ status: "submitting" });
    try {
      await captureSubmitter.submit({ memberId, idempotencyKey: captureKey.current, audio, capturedAt: new Date().toISOString() });
      captureKey.current = null;
      setCapture({ status: "idle" });
      await load(true);
    } catch (error) {
      setCapture({ status: "failed", audio, message: error instanceof Error ? error.message : "Unable to submit Capture" });
    } finally {
      submissionInFlight.current = false;
    }
  }, [captureSubmitter, load, memberId]);

  useEffect(() => { void load(); }, [load]);

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>D · SUMMARY TIMELINE</Text>
        <Text style={styles.title}>Your items</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh items" onPress={() => void load(true)} style={styles.headerRefresh}>
          <Text style={styles.headerRefreshText}>Refresh</Text>
        </Pressable>
        {voiceRecorder && capture.status === "idle" ? <Pressable accessibilityRole="button" accessibilityLabel="Record a voice Capture" onPress={() => void startCapture()} style={styles.captureButton}><Text style={styles.captureButtonText}>Record a Capture</Text></Pressable> : null}
      </View>
      {voiceRecorder && capture.status !== "idle" ? <CapturePanel state={capture} recordingElapsedSeconds={recordingElapsedSeconds} onStop={() => void stopCapture()} onCancel={() => void cancelCapture()} onSubmit={(audio) => void submitCapture(audio)} /> : null}
      {state.status === "loading" && state.items.length === 0 ? <LoadingState /> : null}
      {state.status === "error" && state.items.length === 0 ? <ErrorState message={state.message} onRetry={() => void load()} /> : null}
      {state.status === "ready" && state.items.length === 0 ? <EmptyState onRefresh={() => void load(true)} /> : null}
      {state.status === "error" && state.items.length > 0 ? <ErrorBanner message={state.message} /> : null}
      {state.items.length > 0 ? (
        <FlatList
          data={state.items}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          onEndReached={state.status === "ready" && state.nextCursor && !loadingMore ? () => void load(false, state.nextCursor ?? undefined) : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} /> : null}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ListCard item={item} onPress={onOpenDetail} />}
        />
      ) : null}
    </SafeAreaView>
  );
}

function CapturePanel({ state, recordingElapsedSeconds, onStop, onCancel, onSubmit }: { readonly state: CaptureState; readonly recordingElapsedSeconds: number; readonly onStop: () => void; readonly onCancel: () => void; readonly onSubmit: (audio: RecordedAudio) => void }) {
  if (state.status === "permission_denied" || state.status === "error") return <View accessibilityRole="alert" style={styles.capturePanel}><Text style={styles.captureTitle}>{state.status === "permission_denied" ? "Microphone access denied" : "Could not start recording"}</Text><Text style={styles.captureText}>{state.message}</Text><ActionButton icon="×" label="Dismiss" onPress={onCancel} /> </View>;
  if (state.status === "requesting") return <View style={styles.capturePanel}><ActivityIndicator /><Text style={styles.captureText}>Requesting microphone access…</Text></View>;
  if (state.status === "recording") return <View accessibilityRole="alert" style={styles.capturePanel}><View style={styles.recordingHeader}><View style={styles.recordingDot} /><Text style={styles.captureTitle}>Recording Capture</Text><Text accessibilityLabel="Recording duration" style={styles.recordingTimer}>{formatDuration(recordingElapsedSeconds)}</Text></View><Text style={styles.captureText}>Speak clearly, then submit when finished.</Text><AudioWaveform tick={recordingElapsedSeconds} /><View style={styles.captureActions}><ActionButton icon="×" label="Cancel" onPress={onCancel} variant="secondary" /><ActionButton icon="■" label="Finish recording" onPress={onStop} /></View></View>;
  if (state.status === "stopping" || state.status === "submitting") return <View style={styles.capturePanel}><ActivityIndicator /><Text style={styles.captureText}>{state.status === "stopping" ? "Preparing your Capture…" : "Submitting your Capture…"}</Text></View>;
  if (state.status !== "ready" && state.status !== "failed") return null;
  return <View accessibilityRole="alert" style={styles.capturePanel}><Text style={styles.captureTitle}>{state.status === "failed" ? "Capture submission failed" : "Capture ready"}</Text>{state.status === "failed" ? <Text style={styles.captureText}>{state.message}</Text> : <Text style={styles.captureText}>Submit this recording to your private timeline?</Text>}<View style={styles.captureActions}><ActionButton icon="×" label="Discard" onPress={onCancel} variant="secondary" /><ActionButton icon="↑" label={state.status === "failed" ? "Retry submission" : "Submit Capture"} onPress={() => onSubmit(state.audio)} /></View></View>;
}

function ActionButton({ icon, label, onPress, variant = "primary" }: { readonly icon: string; readonly label: string; readonly onPress: () => void; readonly variant?: "primary" | "secondary" }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.actionButton, variant === "secondary" ? styles.secondaryButton : styles.captureButton, variant === "primary" && styles.actionPrimaryButton]}><View style={styles.actionButtonContent}><Text style={styles.actionIcon}>{icon}</Text><Text style={variant === "secondary" ? styles.secondaryButtonText : styles.captureButtonText}>{label}</Text></View></Pressable>;
}

function AudioWaveform({ tick }: { readonly tick: number }) {
  const bars = [10, 18, 28, 14, 34, 22, 12, 30, 20, 38, 16, 26, 12, 32, 22, 36, 14, 28, 18, 34, 12, 24, 16, 30];
  return <View accessibilityLabel="Recording waveform" style={styles.waveform}>{bars.map((height, index) => <View key={index} style={[styles.waveformBar, { height }, index === tick % bars.length && styles.waveformBarActive]} />)}</View>;
}

function ListCard({ item, onPress }: { readonly item: MemberListItem; readonly onPress: ((detailUrl: string) => void) | undefined }) {
  const label = listItemLabel(item);
  const title = item.kind === "task" ? item.title : item.kind === "note" ? item.content : item.state === "failed" ? "This Capture could not be processed" : "Processing your Capture";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${title}`} onPress={() => onPress?.(item.detailUrl)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardHeader}><Text style={styles.label}>{label}</Text><Text style={styles.date}>{formatDate(item.createdAt)}</Text></View>
      <Text style={cardTitleStyle}>{title}</Text>
      {item.kind === "task" && item.dueAt ? <Text style={styles.detail}>Due {formatDate(item.dueAt)}</Text> : null}
      {item.kind === "note" && item.state === "needs_review" ? <Text style={styles.reviewHint}>Review this item to confirm what it means.</Text> : null}
    </Pressable>
  );
}

function LoadingState() { return <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading items" /><Text style={styles.stateText}>Loading your items…</Text></View>; }
function EmptyState({ onRefresh }: { readonly onRefresh: () => void }) { return <View style={styles.state}><Text style={styles.stateTitle}>Nothing here yet</Text><Text style={styles.stateText}>Your Tasks and Notes will appear here after your first Capture.</Text><Pressable accessibilityRole="button" onPress={onRefresh} style={styles.retry}><Text style={styles.retryText}>Refresh</Text></Pressable></View>; }
function ErrorBanner({ message }: { readonly message: string }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Refresh failed: {message}</Text></View>; }
function ErrorState({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <View style={styles.state}><Text style={styles.stateTitle}>Couldn’t load your items</Text><Text style={styles.stateText}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View>; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function formatDuration(totalSeconds: number): string { const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0"); const seconds = (totalSeconds % 60).toString().padStart(2, "0"); return `${minutes}:${seconds}`; }

const cardTitleStyle = { color: "#24221F", fontSize: 18, fontWeight: "600" as const, lineHeight: 24 };

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 34, fontWeight: "700", marginTop: 6 }, headerRefresh: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 4 }, headerRefreshText: { color: "#7A5C36", fontSize: 15, fontWeight: "600" }, captureButton: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 12, paddingHorizontal: 16, paddingVertical: 11, alignSelf: "flex-start" }, captureButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" }, actionButton: { alignItems: "center", flex: 1, height: 48, justifyContent: "center", paddingHorizontal: 12 }, actionPrimaryButton: { alignSelf: "stretch", marginTop: 0 }, actionButtonContent: { alignItems: "center", flexDirection: "row", gap: 6 }, actionIcon: { fontSize: 16, fontWeight: "700", lineHeight: 18 }, capturePanel: { backgroundColor: "#FFF4E8", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 14 }, captureTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" }, recordingHeader: { alignItems: "center", flexDirection: "row", gap: 8 }, recordingDot: { backgroundColor: "#C44739", borderRadius: 5, height: 10, width: 10 }, recordingTimer: { color: "#8C3D25", fontSize: 16, fontVariant: ["tabular-nums"], marginLeft: "auto" }, waveform: { alignItems: "center", flexDirection: "row", gap: 3, height: 44, justifyContent: "center", marginTop: 14 }, waveformBar: { backgroundColor: "#D9A88A", borderRadius: 2, minHeight: 6, width: 4 }, waveformBarActive: { backgroundColor: "#C44739" }, captureText: { color: "#716B64", fontSize: 15, lineHeight: 21, marginTop: 6 }, captureActions: { alignItems: "stretch", flexDirection: "row", gap: 10, marginTop: 14 }, secondaryButton: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 10 }, secondaryButtonText: { color: "#5D5146", fontSize: 15, fontWeight: "600" }, list: { padding: 16, paddingTop: 4, gap: 12 }, card: { backgroundColor: "#FFFFFF", borderColor: "#E5E0D8", borderRadius: 16, borderWidth: 1, padding: 18 }, cardPressed: { opacity: 0.7 }, cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, label: { color: "#7A5C36", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, date: { color: "#908A82", fontSize: 12 }, detail: { color: "#716B64", fontSize: 14, marginTop: 8 }, reviewHint: { color: "#A15B2A", fontSize: 14, marginTop: 8 }, errorBanner: { backgroundColor: "#FCE8DF", marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10 }, errorText: { color: "#8C3D25", fontSize: 14 }, state: { alignItems: "center", flex: 1, justifyContent: "center", padding: 32 }, stateTitle: { color: "#24221F", fontSize: 20, fontWeight: "700", textAlign: "center" }, stateText: { color: "#716B64", fontSize: 16, lineHeight: 23, marginTop: 8, maxWidth: 300, textAlign: "center" }, retry: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 }, retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" }, footer: { padding: 16 },
});
