import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { createReviewClient, type ReviewClient, type ReviewContract, type ReviewOutcome } from "./review";

interface ReviewScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly detailUrl: string;
  readonly onBack: () => void;
  readonly client?: ReviewClient;
}

type ReviewStatus = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly review: ReviewContract };
type Draft = { readonly title?: string; readonly dueAt?: string | null; readonly content?: string };

export function ReviewScreen({ apiBaseUrl, memberId, detailUrl, onBack, client: providedClient }: ReviewScreenProps) {
  const client = useMemo(() => providedClient ?? createReviewClient(apiBaseUrl), [apiBaseUrl, providedClient]);
  const [state, setState] = useState<ReviewStatus>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>({});
  const [editing, setEditing] = useState<"title" | "dueAt" | "content" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingInFlight = useRef(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const review = await client.get(detailUrl);
      setState({ status: "ready", review });
      setDraft(review.outcome?.kind === "task" ? { title: review.outcome.title, dueAt: review.outcome.dueAt ?? null } : review.outcome ? { content: review.outcome.content } : {});
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load review" });
    }
  }, [client, detailUrl]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (state.status !== "ready" || !state.review.outcome || savingInFlight.current) return;
    savingInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const outcome = state.review.outcome;
      if (outcome.kind === "task") {
        const changes: { title?: string; dueAt?: string | null } = {};
        if (draft.title !== outcome.title && draft.title !== undefined) changes.title = draft.title;
        if (draft.dueAt !== outcome.dueAt) changes.dueAt = draft.dueAt ?? null;
        if (Object.keys(changes).length > 0) await client.updateTask(outcome.id, memberId, outcome.version, changes);
      } else if (draft.content !== outcome.content) {
        await client.updateNote(outcome.id, memberId, outcome.version, draft.content ?? "");
      }
      onBack();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unable to save review");
    } finally {
      savingInFlight.current = false;
      setSaving(false);
    }
  }, [client, draft, memberId, onBack, state]);

  if (state.status === "loading") return <ReviewShell onBack={onBack}><ActivityIndicator accessibilityLabel="Loading review" /><Text style={styles.stateText}>Loading review…</Text></ReviewShell>;
  if (state.status === "error") return <ReviewShell onBack={onBack}><Text style={styles.title}>Couldn’t load review</Text><Text style={styles.stateText}>{state.message}</Text><Button label="Try again" onPress={() => void load()} /></ReviewShell>;
  return <ReviewShell onBack={onBack}>
    <Text style={styles.eyebrow}>DETAILED REVIEW</Text>
    <Text style={styles.title}>{state.review.outcome?.kind === "task" ? "Task" : state.review.outcome?.kind === "note" ? "Note" : "Processing"}</Text>
    <Text style={styles.stateText}>Original source and processing history remain separate from editable result fields.</Text>
    {state.review.outcome ? <ReviewFields outcome={state.review.outcome} draft={draft} editing={editing} onEdit={setEditing} onChange={setDraft} /> : <Text style={styles.stateText}>This Capture has no editable result yet.</Text>}
    {state.review.outcome ? <><Text style={styles.sectionTitle}>Source and provenance</Text><Text style={styles.provenance}>Capture {state.review.capture.id}{state.review.transcription ? ` · transcription ${state.review.transcription.status}` : " · transcription pending"}</Text><Button label={saving ? "Saving…" : "Save"} onPress={() => void save()} disabled={saving} /></> : null}
    {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
  </ReviewShell>;
}

function ReviewFields({ outcome, draft, editing, onEdit, onChange }: { readonly outcome: ReviewOutcome; readonly draft: Draft; readonly editing: "title" | "dueAt" | "content" | null; readonly onEdit: (field: "title" | "dueAt" | "content") => void; readonly onChange: (draft: Draft) => void }) {
  if (outcome.kind === "note") return <EditableField field="content" label="Note" value={draft.content ?? ""} editing={editing} onEdit={onEdit} onChange={(value) => onChange({ content: value })} multiline />;
  return <><EditableField field="title" label="Title" value={draft.title ?? ""} editing={editing} onEdit={onEdit} onChange={(value) => onChange({ ...draft, title: value })} /><EditableField field="dueAt" label="Due information" value={draft.dueAt ?? "Not set"} editing={editing} onEdit={onEdit} onChange={(value) => onChange({ ...draft, dueAt: value || null })} /></>;
}

function EditableField({ field, label, value, editing, onEdit, onChange, multiline = false }: { readonly field: "title" | "dueAt" | "content"; readonly label: string; readonly value: string; readonly editing: string | null; readonly onEdit: (field: "title" | "dueAt" | "content") => void; readonly onChange: (value: string) => void; readonly multiline?: boolean }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{editing === field ? <TextInput accessibilityLabel={label} autoFocus value={value} multiline={multiline} onChangeText={onChange} style={styles.input} /> : <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={() => onEdit(field)}><Text style={styles.value}>{value}</Text></Pressable>}</View>;
}

function ReviewShell({ children, onBack }: { readonly children: ReactNode; readonly onBack: () => void }) { return <SafeAreaView style={styles.safeArea}><Pressable accessibilityRole="button" accessibilityLabel="Back to items" onPress={onBack}><Text style={styles.back}>‹ Items</Text></Pressable><ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></SafeAreaView>; }
function Button({ label, onPress, disabled = false }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, content: { padding: 24 }, back: { color: "#7A5C36", fontSize: 16, paddingHorizontal: 24, paddingTop: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 32, fontWeight: "700", marginTop: 6 }, stateText: { color: "#716B64", fontSize: 15, lineHeight: 22, marginTop: 8 }, field: { marginTop: 24 }, fieldLabel: { color: "#8B7355", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, value: { color: "#24221F", fontSize: 19, lineHeight: 27, marginTop: 5 }, input: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", fontSize: 19, lineHeight: 27, paddingVertical: 5 }, sectionTitle: { color: "#24221F", fontSize: 17, fontWeight: "700", marginTop: 32 }, provenance: { color: "#716B64", fontSize: 14, lineHeight: 21, marginTop: 6 }, button: { alignSelf: "flex-start", backgroundColor: "#24221F", borderRadius: 12, marginTop: 24, paddingHorizontal: 20, paddingVertical: 12 }, buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" }, error: { color: "#A33B31", fontSize: 14, marginTop: 12 } });
