import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createOfflineDraftId, type OfflineDraftStore } from "../offline/offline-drafts";
import { shouldPersistOfflineDraft } from "../http/request-error";
import { createReviewClient, type ReviewClient, type ReviewContract, type ReviewOutcome } from "./review";

interface ReviewScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly detailUrl: string;
  readonly onBack: () => void;
  readonly client?: ReviewClient;
  readonly offlineDraftStore?: OfflineDraftStore;
}

type ReviewStatus = { readonly status: "loading" } | { readonly status: "error"; readonly message: string } | { readonly status: "ready"; readonly review: ReviewContract };
type Draft = { readonly title?: string; readonly dueAt?: string | null; readonly content?: string };

export function ReviewScreen({ apiBaseUrl, memberId, detailUrl, onBack, client: providedClient, offlineDraftStore }: ReviewScreenProps) {
  const client = useMemo(() => providedClient ?? createReviewClient(apiBaseUrl), [apiBaseUrl, providedClient]);
  const [state, setState] = useState<ReviewStatus>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>({});
  const [editing, setEditing] = useState<"title" | "dueAt" | "content" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionNotice, setConversionNotice] = useState<string | null>(null);
  const savingInFlight = useRef(false);
  const completionInFlight = useRef(false);
  const conversionInFlight = useRef(false);
  const textDraftIdentity = useRef<{ readonly draftId: string; readonly capturedAt: string; readonly text: string } | null>(null);

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

  const refreshReviewVersion = useCallback(async () => {
    try {
      const review = await client.get(detailUrl);
      setState({ status: "ready", review });
      return review;
    } catch {
      // Keep the current review visible when the recovery read also fails.
      return undefined;
    }
  }, [client, detailUrl]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (state.status !== "ready" || !state.review.outcome || savingInFlight.current) return;
    if (state.review.outcome.kind === "task" && draft.dueAt !== null && draft.dueAt !== undefined && !isValidIsoDate(draft.dueAt)) {
      setSaveError("Due information must be a valid date and time");
      return;
    }
    savingInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    const outcome = state.review.outcome;
    try {
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
      const saveMessage = error instanceof Error ? error.message : "Unable to save review";
      const text = draft.content ?? "";
      if (outcome.kind === "note" && text !== outcome.content && offlineDraftStore && shouldPersistOfflineDraft(error)) {
        if (textDraftIdentity.current?.text !== text) {
          textDraftIdentity.current = { draftId: createOfflineDraftId(), capturedAt: new Date().toISOString(), text };
        }
        try {
          const identity = textDraftIdentity.current;
          await offlineDraftStore.save({ draftId: identity.draftId, memberId, capturedAt: identity.capturedAt, source: { kind: "text", text } });
          setSaveError(`${saveMessage}. Saved as an Offline draft · Not confirmed`);
        } catch (persistenceError) {
          const persistenceMessage = persistenceError instanceof Error ? persistenceError.message : "local storage failed";
          setSaveError(`${saveMessage}. Offline draft was not saved: ${persistenceMessage}`);
        }
      } else {
        setSaveError(saveMessage);
      }
      const refreshed = await refreshReviewVersion();
      if (outcome.kind === "note" && refreshed?.outcome?.kind === "task" && refreshed.outcome.id === outcome.id) {
        setDraft({ title: refreshed.outcome.title, dueAt: refreshed.outcome.dueAt ?? null });
        setEditing(null);
        setSaveError("This Note was converted to a Task elsewhere. The review was refreshed.");
      }
    } finally {
      savingInFlight.current = false;
      setSaving(false);
    }
  }, [client, draft, memberId, offlineDraftStore, onBack, refreshReviewVersion, state]);

  const complete = useCallback(async () => {
    if (state.status !== "ready" || state.review.outcome?.kind !== "task" || state.review.outcome.status !== "open" || completionInFlight.current) return;
    completionInFlight.current = true;
    setCompleting(true);
    setCompletionError(null);
    try {
      await client.completeTask(state.review.outcome.id, memberId, state.review.outcome.version);
      onBack();
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : "Unable to complete Task");
      await refreshReviewVersion();
    } finally {
      completionInFlight.current = false;
      setCompleting(false);
    }
  }, [client, memberId, onBack, refreshReviewVersion, state]);

  const convertNoteToTask = useCallback(async () => {
    if (state.status !== "ready" || state.review.outcome?.kind !== "note" || conversionInFlight.current) return;
    conversionInFlight.current = true;
    setConverting(true);
    setConversionError(null);
    setConversionNotice(null);
    const note = state.review.outcome;
    try {
      const task = await client.convertNoteToTask(note.id, memberId, note.version);
      if (task.id !== note.id) throw new Error("Conversion response did not preserve item identity");
      setState({ status: "ready", review: { ...state.review, state: "completed", outcome: task } });
      setDraft({ title: task.title, dueAt: task.dueAt ?? null });
      setEditing(null);
      setConversionNotice("Converted to Task. Identity and provenance were kept.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "conversion failed";
      const refreshed = await refreshReviewVersion();
      if (refreshed?.outcome?.kind === "task" && refreshed.outcome.id === note.id) {
        setDraft({ title: refreshed.outcome.title, dueAt: refreshed.outcome.dueAt ?? null });
        setEditing(null);
        setConversionNotice("Conversion confirmed after refreshing.");
      } else {
        setConversionError(`Unable to convert Note: ${message}`);
      }
    } finally {
      conversionInFlight.current = false;
      setConverting(false);
    }
  }, [client, memberId, refreshReviewVersion, state]);

  if (state.status === "loading") return <ReviewShell onBack={onBack}><ActivityIndicator accessibilityLabel="Loading review" /><Text style={styles.stateText}>Loading review…</Text></ReviewShell>;
  if (state.status === "error") return <ReviewShell onBack={onBack}><Text style={styles.title}>Couldn’t load review</Text><Text style={styles.stateText}>{state.message}</Text><Button label="Try again" onPress={() => void load()} /></ReviewShell>;
  return <ReviewShell onBack={onBack}>
    <Text style={styles.eyebrow}>DETAILED REVIEW</Text>
    <ReviewStateBanner review={state.review} />
    {state.review.state === "failed" ? <Button label="Refresh processing status" onPress={() => void load()} /> : null}
    <Text style={styles.title}>{state.review.outcome?.kind === "task" ? "Task" : state.review.outcome?.kind === "note" ? "Note" : state.review.state === "failed" ? "Processing failed" : "Processing"}</Text>
    <Text style={styles.stateText}>Original source and processing history remain separate from editable result fields.</Text>
    {state.review.outcome ? <ReviewFields outcome={state.review.outcome} draft={draft} editing={editing} onEdit={setEditing} onChange={setDraft} /> : <Text style={styles.stateText}>This Capture has no editable result yet.</Text>}
    <Text style={styles.sectionTitle}>Source and provenance</Text>
    <Text style={styles.provenance}>Capture {state.review.capture.id} · source {state.review.source.id}</Text>
    {state.review.transcription ? <><Text style={styles.fieldLabel}>Original transcription{state.review.transcription.language ? ` · ${state.review.transcription.language}` : ""}</Text><Text style={styles.originalText}>{state.review.transcription.text ?? `Status: ${state.review.transcription.status}`}</Text></> : <Text style={styles.provenance}>Original transcription · pending</Text>}
    {state.review.outcome ? <>
      {state.review.outcome.kind === "task" && state.review.outcome.status === "open" ? <Button label={completing ? "Completing…" : "Complete task"} onPress={() => void complete()} disabled={completing || saving || converting} /> : null}
      {state.review.outcome.kind === "note" || state.review.outcome.status === "open" ? <Button label={saving ? "Saving…" : "Save"} onPress={() => void save()} disabled={saving || completing || converting} /> : null}
      {state.review.outcome.kind === "note" ? <>
        <Text style={styles.stateText}>Conversion requires a connection. The saved Note becomes a Task while keeping its identity and provenance.</Text>
        <Button label={converting ? "Converting…" : "Convert saved Note to Task"} onPress={() => void convertNoteToTask()} disabled={saving || completing || converting} />
      </> : null}
    </> : null}
    {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
    {completionError ? <Text accessibilityRole="alert" style={styles.error}>{completionError}</Text> : null}
    {conversionError ? <Text accessibilityRole="alert" style={styles.error}>{conversionError}</Text> : null}
    {conversionNotice ? <Text accessibilityRole="alert" style={styles.success}>{conversionNotice}</Text> : null}
  </ReviewShell>;
}

function ReviewStateBanner({ review }: { readonly review: ReviewContract }) {
  if (review.state === "completed") return null;
  if (review.state === "needs_review") {
    if (review.interpretation?.classification === "ambiguous") return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · The Capture was ambiguous. Confirm or edit the Note before saving.</Text>;
    if (review.interpretation?.classification === "unsupported") return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · This instruction is unsupported. Confirm or edit the Note before saving.</Text>;
    return <Text accessibilityRole="alert" style={styles.reviewState}>Needs review · Confirm or edit this result before saving.</Text>;
  }
  if (review.state === "failed") return <View accessibilityRole="alert"><Text style={styles.error}>Processing failed</Text><Text style={styles.stateText}>{review.failure?.message ?? "The Capture could not be processed."}</Text><Text style={styles.stateText}>Review the original Capture and try again when processing is available.</Text></View>;
  return <Text accessibilityRole="alert" style={styles.reviewState}>Processing · No result is available yet.</Text>;
}

function ReviewFields({ outcome, draft, editing, onEdit, onChange }: { readonly outcome: ReviewOutcome; readonly draft: Draft; readonly editing: "title" | "dueAt" | "content" | null; readonly onEdit: (field: "title" | "dueAt" | "content") => void; readonly onChange: (draft: Draft) => void }) {
  if (outcome.kind === "note") return <EditableField field="content" label="Note" value={draft.content ?? ""} editing={editing} onEdit={onEdit} onChange={(value) => onChange({ content: value })} multiline />;
  const editable = outcome.status === "open";
  return <><EditableField field="title" label="Title" value={draft.title ?? ""} editing={editing} onEdit={onEdit} onChange={(value) => onChange({ ...draft, title: value })} editable={editable} /><DueInformation value={draft.dueAt ?? null} editing={editing === "dueAt"} editable={editable} onEdit={() => onEdit("dueAt")} onChange={(dueAt) => onChange({ ...draft, dueAt })} /></>;
}

function DueInformation({ value, editing, editable, onEdit, onChange }: { readonly value: string | null; readonly editing: boolean; readonly editable: boolean; readonly onEdit: () => void; readonly onChange: (value: string | null) => void }) {
  const initial = parseDue(value) ?? new Date();
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [hasDue, setHasDue] = useState(() => value !== null);
  const [draftDate, setDraftDate] = useState(() => initial);
  const [draftTime, setDraftTime] = useState(() => formatTime(initial));
  const display = value && isValidIsoDate(value) ? formatDue(value) : value ?? "Not set";

  if (!editing) return editable ? <Pressable style={styles.field} accessibilityRole="button" accessibilityLabel="Edit Due information" onPress={onEdit}><Text style={styles.fieldLabel}>Remind At:</Text><Text style={styles.value}>{display}</Text></Pressable> : <View style={styles.field}><Text style={styles.fieldLabel}>Remind At:</Text><Text style={styles.value}>{display}</Text></View>;

  const commitDate = (date: Date) => {
    const [hour, minute] = draftTime.split(":").map(Number);
    const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute));
    setDraftDate(next);
    setHasDue(true);
    onChange(next.toISOString());
    setPicker(null);
  };
  const commitTime = (time: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setTimeError("Enter a valid time between 00:00 and 23:59");
      return;
    }
    setTimeError(null);
    const [hour, minute] = time.split(":").map(Number);
    const next = new Date(Date.UTC(draftDate.getUTCFullYear(), draftDate.getUTCMonth(), draftDate.getUTCDate(), hour, minute));
    setDraftTime(time);
    setDraftDate(next);
    setHasDue(true);
    onChange(next.toISOString());
    setPicker(null);
  };
  return <View style={styles.field}><Text style={styles.fieldLabel}>Remind At:</Text>{hasDue ? <View style={styles.dueBubbles}><Pressable accessibilityRole="button" accessibilityLabel="Choose due date" onPress={() => setPicker("date")} style={styles.dueBubble}><Text style={styles.dueBubbleText}>{formatDateBubble(draftDate)}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Choose due time" onPress={() => setPicker("time")} style={styles.dueBubble}><Text style={styles.dueBubbleText}>{draftTime}</Text></Pressable></View> : <Text style={styles.value}>Not set</Text>}<Pressable accessibilityRole="button" accessibilityLabel={hasDue ? "Change due information" : "Set due information"} onPress={() => setPicker("date")}><Text style={styles.clearDue}>{hasDue ? "Change due information" : "Set due information"}</Text></Pressable>{hasDue ? <Pressable accessibilityRole="button" accessibilityLabel="Clear due information" onPress={() => { onChange(null); setHasDue(false); setPicker(null); }}><Text style={styles.clearDue}>Clear due information</Text></Pressable> : null}{timeError ? <Text accessibilityRole="alert" style={styles.error}>{timeError}</Text> : null}{picker === "date" ? <DatePicker value={draftDate} onCancel={() => setPicker(null)} onDone={commitDate} /> : null}{picker === "time" ? <TimePicker value={draftTime} onCancel={() => setPicker(null)} onDone={commitTime} /> : null}</View>;
}

function DatePicker({ value, onCancel, onDone }: { readonly value: Date; readonly onCancel: () => void; readonly onDone: (value: Date) => void }) {
  const [month, setMonth] = useState(() => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)));
  const days = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  const firstDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).getUTCDay();
  return <View style={styles.pickerPanel}><View style={styles.pickerHeader}><Pressable accessibilityRole="button" accessibilityLabel="Cancel due date" onPress={onCancel}><Text>Cancel</Text></Pressable><Text style={styles.pickerTitle}>Date</Text><Pressable accessibilityRole="button" accessibilityLabel="Done due date" onPress={() => onDone(value)}><Text>Done</Text></Pressable></View><View style={styles.monthRow}><Pressable accessibilityRole="button" accessibilityLabel="Previous due month" onPress={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}><Text>‹</Text></Pressable><Text>{month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next due month" onPress={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}><Text>›</Text></Pressable></View><View style={styles.calendarGrid}>{Array.from({ length: firstDay }, (_, index) => <View key={`empty-${index}`} style={styles.calendarDay} />)}{Array.from({ length: days }, (_, index) => { const day = index + 1; const selected = value.getUTCFullYear() === month.getUTCFullYear() && value.getUTCMonth() === month.getUTCMonth() && value.getUTCDate() === day; return <Pressable key={day} accessibilityRole="button" accessibilityLabel={`Due date ${month.getUTCFullYear()}-${pad(month.getUTCMonth() + 1)}-${pad(day)}`} onPress={() => onDone(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day, value.getUTCHours(), value.getUTCMinutes())))} style={[styles.calendarDay, selected && styles.calendarDaySelected]}><Text>{day}</Text></Pressable>; })}</View></View>;
}

function TimePicker({ value, onCancel, onDone }: { readonly value: string; readonly onCancel: () => void; readonly onDone: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return <View style={styles.pickerPanel}><View style={styles.pickerHeader}><Pressable accessibilityRole="button" accessibilityLabel="Cancel due time" onPress={onCancel}><Text>Cancel</Text></Pressable><Text style={styles.pickerTitle}>Time</Text><Pressable accessibilityRole="button" accessibilityLabel="Done due time" onPress={() => onDone(draft)}><Text>Done</Text></Pressable></View><TextInput accessibilityLabel="Due time" value={draft} onChangeText={setDraft} keyboardType="numbers-and-punctuation" style={styles.input} /><Text style={styles.pickerHint}>Use 24-hour time, for example 09:00.</Text></View>;
}

function EditableField({ field, label, value, editing, onEdit, onChange, multiline = false, editable = true }: { readonly field: "title" | "dueAt" | "content"; readonly label: string; readonly value: string; readonly editing: string | null; readonly onEdit: (field: "title" | "dueAt" | "content") => void; readonly onChange: (value: string) => void; readonly multiline?: boolean; readonly editable?: boolean }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{editing === field && editable ? <TextInput accessibilityLabel={label} autoFocus value={value} multiline={multiline} onChangeText={onChange} style={styles.input} /> : editable ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={() => onEdit(field)}><Text style={styles.value}>{value}</Text></Pressable> : <Text style={styles.value}>{value}</Text>}</View>;
}

function parseDue(value: string | null): Date | null {
  return value && isValidIsoDate(value) ? new Date(value) : null;
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value);
  if (!match) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
    && date.getUTCHours() === Number(match[4])
    && date.getUTCMinutes() === Number(match[5])
    && (match[6] === undefined || date.getUTCSeconds() === Number(match[6]));
}

function formatDue(value: string): string {
  const date = new Date(value);
  return `${formatDateBubble(date)} · ${formatTime(date)}`;
}

function formatDateBubble(value: Date): string { return `${value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`; }
function formatTime(value: Date): string { return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`; }
function pad(value: number): string { return String(value).padStart(2, "0"); }

function ReviewShell({ children, onBack }: { readonly children: ReactNode; readonly onBack: () => void }) { return <SafeAreaView style={styles.safeArea}><Pressable accessibilityRole="button" accessibilityLabel="Back to items" onPress={onBack}><Text style={styles.back}>‹ Items</Text></Pressable><ScrollView contentContainerStyle={styles.content}>{children}</ScrollView></SafeAreaView>; }
function Button({ label, onPress, disabled = false }: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, content: { padding: 24 }, back: { color: "#7A5C36", fontSize: 16, paddingHorizontal: 24, paddingTop: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 32, fontWeight: "700", marginTop: 6 }, stateText: { color: "#716B64", fontSize: 15, lineHeight: 22, marginTop: 8 }, reviewState: { color: "#8C3D25", fontSize: 15, fontWeight: "600", lineHeight: 22, marginTop: 18 }, field: { marginTop: 24 }, fieldLabel: { color: "#8B7355", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, value: { color: "#24221F", fontSize: 19, lineHeight: 27, marginTop: 5 }, originalText: { color: "#716B64", fontSize: 16, lineHeight: 24, marginTop: 5 }, input: { borderBottomColor: "#B9A895", borderBottomWidth: 1, color: "#24221F", fontSize: 19, lineHeight: 27, paddingVertical: 5 }, sectionTitle: { color: "#24221F", fontSize: 17, fontWeight: "700", marginTop: 32 }, provenance: { color: "#716B64", fontSize: 14, lineHeight: 21, marginTop: 6 }, button: { alignSelf: "flex-start", backgroundColor: "#24221F", borderRadius: 12, marginTop: 24, paddingHorizontal: 20, paddingVertical: 12 }, buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" }, error: { color: "#A33B31", fontSize: 14, marginTop: 12 }, success: { color: "#356445", fontSize: 14, marginTop: 12 }, dueBubbles: { flexDirection: "row", gap: 8, marginTop: 10 }, dueBubble: { borderColor: "#B9A895", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 }, dueBubbleText: { color: "#24221F", fontSize: 16 }, clearDue: { color: "#8C3D25", fontSize: 14, marginTop: 12 }, pickerPanel: { backgroundColor: "#EFEAE2", borderRadius: 16, marginTop: 14, padding: 16 }, pickerHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, pickerTitle: { color: "#24221F", fontSize: 17, fontWeight: "700" }, pickerHint: { color: "#716B64", fontSize: 13, marginTop: 8 }, monthRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginVertical: 18 }, calendarGrid: { flexDirection: "row", flexWrap: "wrap" }, calendarDay: { alignItems: "center", justifyContent: "center", minHeight: 38, width: "14.285%" }, calendarDaySelected: { backgroundColor: "#D5B98D", borderRadius: 19 } });
