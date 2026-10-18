import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { PreviewItem, PreviewState } from "./result-preview";
import { previewCountdown } from "./result-preview";
import { CaptureResultFacts } from "../review/CaptureResultReview";

export function CaptureResultPreview({ state, apiBaseUrl, memberId, timeZone, onSave, onOpenReview, onOpenResultReview }: {
  readonly state: PreviewState;
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly timeZone: string;
  readonly onSave: () => void;
  readonly onOpenReview: (detailUrl: string) => void;
  readonly onOpenResultReview: (item: PreviewItem) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const expiresAt = state.status === "preview" ? state.expiresAt : null;
  useEffect(() => {
    if (state.status !== "preview") return;
    setNow(Date.now());
    const interval = globalThis.setInterval(() => setNow(Date.now()), 250);
    return () => globalThis.clearInterval(interval);
  }, [state.status, expiresAt]);

  if (state.status === "processing") return <View accessibilityRole="alert" style={styles.previewPanel}><ActivityIndicator /><Text style={styles.captureTitle}>Processing your Capture…</Text><Text style={styles.captureText}>Your result will appear here when the server confirms it.</Text></View>;
  if (state.status === "failed") return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.captureTitle}>Capture processing failed</Text><Text style={styles.captureText}>Your original Capture remains stored on the server.</Text><PreviewReviewButton captureId={state.captureId} onOpenReview={onOpenReview} /></View>;
  if (state.status === "timed_out") return <View accessibilityRole="alert" style={styles.previewPanel}><Text style={styles.captureTitle}>Processing is taking longer than expected</Text><Text style={styles.captureText}>The server has not confirmed a result. Your original Capture remains stored on the server.</Text><PreviewReviewButton captureId={state.captureId} onOpenReview={onOpenReview} /></View>;
  if (state.status === "saved") return <View accessibilityRole="alert" style={styles.savedCard}><View style={styles.savedMark}><Text style={styles.savedCheck}>✓</Text></View><View style={styles.savedCopy}><Text style={styles.savedTitle}>Saved to your items</Text><Text numberOfLines={2} style={styles.savedDescription}>{previewTitle(state.item)}</Text></View></View>;
  if (state.status === "preview" || state.status === "reviewing") {
    const countdown = state.status === "preview" ? previewCountdown(state.expiresAt, now) : null;
    return <View accessibilityRole="alert" style={styles.card}>
      <View style={styles.header}>
        <View style={styles.readyBadge}><View style={styles.readyDot} /><Text style={styles.readyText}>CAPTURE RESULT</Text></View>
        {countdown ? <View accessibilityRole="timer" accessibilityLabel={`Auto-save in ${countdown.seconds} seconds`} style={styles.timerPill}><Text style={styles.timerLabel}>AUTO-SAVE</Text><Text style={styles.timerValue}>{formatCountdown(countdown.seconds)}</Text></View> : <View style={styles.stoppedPill}><Text style={styles.stoppedText}>TIMER STOPPED</Text></View>}
      </View>
      <Text style={styles.title}>{previewTitle(state.item)}</Text>
      <CaptureResultFacts apiBaseUrl={apiBaseUrl} memberId={memberId} item={state.item} timeZone={timeZone} />
      {!countdown ? <Text style={styles.timerHint}>The countdown stopped while you reviewed the details.</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open result details" onPress={() => onOpenResultReview(state.item)} style={styles.detailsButton}><Text style={styles.detailsText}>Open details</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Save result" onPress={onSave} style={styles.saveButton}><Text style={styles.saveText}>Save now</Text></Pressable>
      </View>
    </View>;
  }
  return null;
}

function formatCountdown(totalSeconds: number): string { return `0:${totalSeconds.toString().padStart(2, "0")}`; }

function PreviewReviewButton({ captureId, onOpenReview }: { readonly captureId: string; readonly onOpenReview: (detailUrl: string) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Open Capture review" onPress={() => onOpenReview(`/captures/${captureId}/review`)} style={styles.retry}><Text style={styles.retryText}>Open review</Text></Pressable>;
}

function previewTitle(item: PreviewItem): string { return item.kind === "task" ? item.title : item.content; }

const styles = StyleSheet.create({
  previewPanel: { backgroundColor: "#FFF4E8", marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 14 },
  captureTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" },
  captureText: { color: "#716B64", fontSize: 15, lineHeight: 21, marginTop: 6 },
  retry: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
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
  saveText: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  savedCard: { alignItems: "center", backgroundColor: "#EAF1ED", borderColor: "#C7D9CE", borderRadius: 17, borderWidth: 1, flexDirection: "row", gap: 12, marginHorizontal: 16, marginBottom: 14, padding: 15 },
  savedMark: { alignItems: "center", backgroundColor: "#31745D", borderRadius: 14, height: 30, justifyContent: "center", width: 30 },
  savedCheck: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  savedCopy: { flex: 1 },
  savedTitle: { color: "#245542", fontSize: 15, fontWeight: "700" },
  savedDescription: { color: "#566A5E", fontSize: 13, lineHeight: 18, marginTop: 2 },
});
