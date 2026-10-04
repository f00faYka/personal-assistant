import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createMetadataClient, type Entity, type MetadataItemKind } from "./metadata";
import { createReviewClient, type ReviewContract } from "./review";
import { createSpacesClient, findAssignedSpace, spacePath } from "../spaces/spaces";
import type { PreviewItem } from "../preview/result-preview";

type Facts = { readonly status: "loading" | "unavailable" | "ready"; readonly space?: string; readonly entities?: readonly Entity[] };

export function CaptureResultFacts({ apiBaseUrl, memberId, item, timeZone }: { readonly apiBaseUrl: string; readonly memberId: string; readonly item: PreviewItem; readonly timeZone: string }) {
  const [facts, setFacts] = useState<Facts>({ status: "loading" });
  useEffect(() => {
    let active = true;
    const kind: MetadataItemKind = item.kind;
    const metadataClient = createMetadataClient(apiBaseUrl);
    const spacesClient = createSpacesClient(apiBaseUrl);
    setFacts({ status: "loading" });
    void Promise.all([metadataClient.listLinks(item.id, kind, memberId), spacesClient.list(memberId)])
      .then(async ([links, spaces]) => {
        const assigned = await findAssignedSpace(spacesClient, spaces, memberId, item.id, kind);
        if (active) setFacts({ status: "ready", ...(assigned ? { space: spacePath(spaces, assigned.id) } : {}), entities: links.entities });
      })
      .catch(() => { if (active) setFacts({ status: "unavailable" }); });
    return () => { active = false; };
  }, [apiBaseUrl, item.detailUrl, item.id, item.kind, memberId]);

  return <View>
    <Fact label="Type" value={item.kind === "task" ? "Task" : "Note"} />
    {item.kind === "task" ? <Fact label="Status" value={item.state === "completed" ? "Completed" : "Open"} /> : item.state === "needs_review" ? <Fact label="Review" value="Needs review" /> : null}
    {item.kind === "task" && item.dueAt ? <><Fact label="Due date" value={new Date(item.dueAt).toLocaleDateString(undefined, { timeZone, year: "numeric", month: "long", day: "numeric" })} /><Fact label="Due time" value={new Date(item.dueAt).toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" })} /></> : null}
    {facts.status === "ready" && facts.space ? <Fact label="Space" value={facts.space} /> : null}
    {facts.status === "ready" ? facts.entities?.map((entity) => <Fact key={entity.id} label="Entity" value={`${entity.name} · ${entity.type}`} />) : <Text style={styles.metaStatus}>{facts.status === "loading" ? "Loading Space and Entity details…" : "Space and Entity details are unavailable."}</Text>}
  </View>;
}

export function CaptureResultReview({ apiBaseUrl, memberId, detailUrl, timeZone, onBack }: { readonly apiBaseUrl: string; readonly memberId: string; readonly detailUrl: string; readonly timeZone: string; readonly onBack: () => void }) {
  const client = useMemo(() => createReviewClient(apiBaseUrl), [apiBaseUrl]);
  const [state, setState] = useState<{ readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly review: ReviewContract }>({ status: "loading" });
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true;
    void client.get(detailUrl).then((review) => { if (active) setState({ status: "ready", review }); }).catch((error: unknown) => { if (active) setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load Capture review" }); });
    return () => { active = false; };
  }, [client, detailUrl]);

  const result = state.status === "ready" ? state.review.outcome : null;
  const item: PreviewItem | null = result?.kind === "task"
    ? { kind: "task", id: result.id, captureId: state.status === "ready" ? state.review.capture.id : "", title: result.title, ...(result.dueAt === undefined ? {} : { dueAt: result.dueAt }), state: result.status, createdAt: "", detailUrl }
    : result?.kind === "note"
      ? { kind: "note", id: result.id, captureId: state.status === "ready" ? state.review.capture.id : "", content: result.content, state: result.reviewState, createdAt: "", detailUrl }
      : null;

  return <SafeAreaView style={styles.safe}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to Capture result" onPress={onBack}><Text style={styles.back}>‹ Back</Text></Pressable>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>CAPTURE RESULT</Text>
      {state.status === "loading" ? <Text style={styles.body}>Loading result…</Text> : null}
      {state.status === "error" ? <Text accessibilityRole="alert" style={styles.body}>Couldn’t load the Capture result: {state.message}</Text> : null}
      {state.status === "ready" ? <>
        {result && item ? <>
          <Text style={styles.title}>{result.kind === "task" ? result.title : result.content}</Text>
          {result.kind === "note" && result.reviewState === "needs_review" ? <Text accessibilityRole="alert" style={styles.notice}>Needs review · This Note came from an ambiguous or unsupported Capture.</Text> : null}
          <CaptureResultFacts apiBaseUrl={apiBaseUrl} memberId={memberId} item={item} timeZone={timeZone} />
        </> : <StateNotice review={state.review} />}
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Hide source and review history" : "Show source and review history"} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.disclosure}><Text style={styles.disclosureText}>{expanded ? "⌄" : "›"} Capture, source and history</Text></Pressable>
        {expanded ? <SourceHistory review={state.review} /> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

function SourceHistory({ review }: { readonly review: ReviewContract }) {
  return <View style={styles.history}>
    <Fact label="Capture" value={review.capture.id} /><Fact label="Source" value={review.source.id} />
    <Fact label="Original audio" value={review.source.content ? `${review.source.storageState === "stored" ? "Stored" : "Storage pending"} · ${review.source.content.contentType} · ${formatByteLength(review.source.content.byteLength)}` : "Audio details unavailable"} />
    {review.transcription ? <Fact label={`Original transcription${review.transcription.language ? ` · ${review.transcription.language}` : ""}`} value={review.transcription.text ?? `Unavailable · ${review.transcription.status}`} /> : <Fact label="Original transcription" value="Unavailable" />}
    {review.correction ? <Fact label="Member correction" value={review.correction.text} /> : <Fact label="Member correction" value="None" />}
    <Fact label="AI interpretation" value={review.interpretation?.classification?.replaceAll("_", " ") ?? "Unavailable"} />
    <Fact label="Current result" value={review.outcome ? review.outcome.kind === "task" ? `Task · ${review.outcome.title}` : `Note · ${review.outcome.content}` : review.state === "failed" ? `Processing failed · ${review.failure?.message ?? "No failure details available"}` : "No result is available yet"} />
    <Text style={styles.sourceNote}>Audio playback is not available in the current review contract.</Text>
  </View>;
}

function StateNotice({ review }: { readonly review: ReviewContract }) {
  if (review.state === "failed") return <Text accessibilityRole="alert" style={styles.notice}>Processing failed · {review.failure?.message ?? "The Capture could not be processed."}</Text>;
  if (review.state === "needs_review") return <Text accessibilityRole="alert" style={styles.notice}>Needs review · No result is available yet.</Text>;
  return <Text accessibilityRole="alert" style={styles.body}>Processing · No result is available yet.</Text>;
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) { return <View style={styles.fact}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }
function formatByteLength(byteLength: number): string { return byteLength < 1024 ? `${byteLength} bytes` : `${(byteLength / 1024).toFixed(1)} KB`; }
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#F7F5F0" }, back: { color: "#7A5C36", fontSize: 16, paddingHorizontal: 24, paddingTop: 16 }, content: { padding: 24 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 30, fontWeight: "700", lineHeight: 38, marginTop: 8 }, body: { color: "#716B64", fontSize: 15, lineHeight: 22, marginTop: 14 }, notice: { color: "#8C3D25", fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 14 }, fact: { marginTop: 18 }, label: { color: "#8B7355", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, value: { color: "#24221F", fontSize: 17, lineHeight: 24, marginTop: 4 }, metaStatus: { color: "#716B64", fontSize: 13, lineHeight: 19, marginTop: 12 }, disclosure: { borderTopColor: "#D8CFC2", borderTopWidth: 1, marginTop: 30, paddingVertical: 18 }, disclosureText: { color: "#24221F", fontSize: 17, fontWeight: "700" }, history: { backgroundColor: "#FFFDF9", borderRadius: 14, marginTop: 4, padding: 16 }, sourceNote: { color: "#716B64", fontSize: 13, lineHeight: 19, marginTop: 20 } });
