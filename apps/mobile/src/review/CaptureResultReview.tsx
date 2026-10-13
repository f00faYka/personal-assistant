import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createMetadataClient, type Entity, type MetadataItemKind } from "./metadata";
import { createReviewClient, type ReviewContract } from "./review";
import { createSpacesClient, findAssignedSpace, spacePath } from "../spaces/spaces";
import type { PreviewItem } from "../preview/result-preview";

type Facts = { readonly status: "loading" | "unavailable" | "ready"; readonly space?: string; readonly tags?: readonly string[]; readonly entities?: readonly Entity[] };

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
        if (active) setFacts({ status: "ready", ...(assigned ? { space: spacePath(spaces, assigned.id) } : {}), tags: links.tags.map((tag) => tag.name), entities: links.entities });
      })
      .catch(() => { if (active) setFacts({ status: "unavailable" }); });
    return () => { active = false; };
  }, [apiBaseUrl, item.detailUrl, item.id, item.kind, memberId]);

  return <View style={styles.properties}>
    {item.kind === "task" && item.dueAt ? <View style={styles.dueRow}>
      <View style={styles.dueCard}><Text style={styles.fieldLabel}>DUE DATE</Text><Text style={styles.dueValue}>{new Date(item.dueAt).toLocaleDateString(undefined, { timeZone, year: "numeric", month: "short", day: "numeric" })}</Text></View>
      <View style={styles.dueCard}><Text style={styles.fieldLabel}>DUE TIME</Text><Text style={styles.dueValue}>{new Date(item.dueAt).toLocaleTimeString(undefined, { timeZone, hour: "2-digit", minute: "2-digit" })}</Text></View>
    </View> : null}
    {facts.status === "ready" && facts.space ? <Property label="SPACE"><Text style={styles.propertyValue}>{facts.space}</Text></Property> : null}
    {facts.status === "ready" && facts.tags && facts.tags.length > 0 ? <Property label="TAGS"><View style={styles.chips}>{facts.tags.map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View></Property> : null}
    {facts.status === "ready" && facts.entities && facts.entities.length > 0 ? <Property label="ENTITIES"><View style={styles.entityList}>{facts.entities.map((entity) => <View key={entity.id} style={styles.entity}><Text style={styles.entityName}>{entity.name}</Text><Text style={styles.entityType}>{entity.type}</Text></View>)}</View></Property> : null}
    {facts.status !== "ready" ? <Text style={styles.metaStatus}>{facts.status === "loading" ? "Loading item details…" : "Item details are unavailable."}</Text> : null}
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
    <Pressable accessibilityRole="button" accessibilityLabel="Back to Capture result" onPress={onBack} style={styles.topBar}><Text style={styles.back}>‹ Capture result</Text><Text style={styles.afterCapture}>After Capture</Text></Pressable>
    <ScrollView contentContainerStyle={styles.content}>
      {state.status === "loading" ? <Text style={styles.stateText}>Loading result…</Text> : null}
      {state.status === "error" ? <Text accessibilityRole="alert" style={styles.stateText}>Couldn’t load the Capture result: {state.message}</Text> : null}
      {state.status === "ready" ? <>
        {result && item ? <View style={styles.product}>
          <View style={styles.body}>
            <View style={styles.statusLine}><Text style={[styles.badge, item.kind === "note" && styles.noteBadge, item.kind === "task" && item.state === "completed" && styles.doneBadge]}>{item.kind.toUpperCase()}</Text><Text style={styles.statusText}>{item.kind === "task" ? item.state === "completed" ? "Completed" : "Open" : item.state === "needs_review" ? "Needs review" : "Saved"}</Text></View>
            <Text style={[styles.title, item.kind === "note" && styles.noteTitle]}>{result.kind === "task" ? result.title : result.content}</Text>
            {result.kind === "note" && result.reviewState === "needs_review" ? <Text accessibilityRole="alert" style={styles.notice}>Needs review · This Note came from an ambiguous or unsupported Capture.</Text> : null}
            <CaptureResultFacts apiBaseUrl={apiBaseUrl} memberId={memberId} item={item} timeZone={timeZone} />
            <View style={styles.sourceDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel={expanded ? "Hide source and review history" : "Show source and review history"} accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)} style={styles.disclosure}><Text style={styles.disclosureText}>{expanded ? "⌃" : "⌄"}  Source & review history</Text></Pressable>
            {expanded ? <SourceHistory review={state.review} /> : null}
          </View>
        </View> : <StateNotice review={state.review} />}
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
function Property({ label, children }: { readonly label: string; readonly children: ReactNode }) { return <View style={styles.property}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>; }
function formatByteLength(byteLength: number): string { return byteLength < 1024 ? `${byteLength} bytes` : `${(byteLength / 1024).toFixed(1)} KB`; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F7F5F0" },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 15 },
  back: { color: "#716B64", fontSize: 12 }, afterCapture: { color: "#716B64", fontSize: 12 }, content: { paddingHorizontal: 16, paddingBottom: 24 },
  product: { backgroundColor: "#FFFEFB", borderColor: "#DED8CE", borderRadius: 22, borderWidth: 1, overflow: "hidden", shadowColor: "#24221F", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 18 },
  body: { padding: 22 }, stateText: { color: "#716B64", fontSize: 15, lineHeight: 22, marginTop: 14 }, statusLine: { alignItems: "center", flexDirection: "row", gap: 8 },
  badge: { backgroundColor: "rgba(23, 59, 47, 0.1)", borderRadius: 999, color: "#173B2F", fontSize: 11, fontWeight: "800", letterSpacing: 1, paddingHorizontal: 9, paddingVertical: 6 },
  noteBadge: { backgroundColor: "#E8E4F2", color: "#24221F" }, doneBadge: { backgroundColor: "#173B2F", color: "#D9E89A" }, statusText: { color: "#716B64", fontSize: 13 },
  title: { color: "#24221F", fontSize: 34, fontWeight: "800", letterSpacing: -1.2, lineHeight: 40, marginBottom: 20, marginTop: 14 }, noteTitle: { fontWeight: "500" },
  notice: { color: "#8C3D25", fontSize: 14, fontWeight: "600", lineHeight: 21, marginBottom: 16 },
  properties: { gap: 16, marginTop: 4 }, dueRow: { flexDirection: "row", gap: 10 },
  dueCard: { backgroundColor: "#F7F5F0", borderColor: "#DED8CE", borderRadius: 15, borderWidth: 1, flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
  fieldLabel: { color: "#716B64", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, dueValue: { color: "#24221F", fontSize: 15, fontWeight: "700", marginTop: 5 },
  property: { borderTopColor: "#DED8CE", borderTopWidth: 1, paddingTop: 14 }, propertyValue: { color: "#24221F", fontSize: 15, marginTop: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 }, tag: { backgroundColor: "rgba(23, 59, 47, 0.09)", borderRadius: 8, color: "#173B2F", fontSize: 12, paddingHorizontal: 8, paddingVertical: 5 },
  entityList: { gap: 8, marginTop: 7 }, entity: { alignItems: "baseline", flexDirection: "row", gap: 8 }, entityName: { color: "#24221F", fontSize: 15, fontWeight: "600" }, entityType: { color: "#716B64", fontSize: 12 },
  metaStatus: { color: "#716B64", fontSize: 13, lineHeight: 19, marginTop: 8 }, sourceDivider: { borderTopColor: "#DED8CE", borderTopWidth: 1, marginTop: 22 }, disclosure: { paddingVertical: 15 }, disclosureText: { color: "#173B2F", fontSize: 13, fontWeight: "800" },
  fact: { marginTop: 18 }, label: { color: "#8B7355", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, value: { color: "#24221F", fontSize: 17, lineHeight: 24, marginTop: 4 }, history: { backgroundColor: "#F7F5F0", borderRadius: 14, marginTop: 4, padding: 16 }, sourceNote: { color: "#716B64", fontSize: 13, lineHeight: 19, marginTop: 20 },
});
