import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { tokens } from "../design-system";

export type TaskNoteDetailItem =
  | { readonly kind: "task"; readonly id: string; readonly title: string; readonly status: "open" | "completed"; readonly dueAt: string | null; readonly space: string; readonly tags: readonly string[]; readonly source: string; readonly interpretation?: string; readonly transcription?: { readonly text: string; readonly language?: string } }
  | { readonly kind: "note"; readonly id: string; readonly content: string; readonly reviewState: "saved" | "needs_review"; readonly space: string; readonly tags: readonly string[]; readonly source: string; readonly interpretation?: string; readonly transcription?: { readonly text: string; readonly language?: string } };

export interface TaskNoteDetailDraft { readonly text: string; readonly dueAt: string | null; }

export interface TaskNoteDetailMetadata {
  readonly selectedSpaceId: string | null;
  readonly spaces: readonly { readonly id: string; readonly label: string }[];
  readonly tags: readonly { readonly id: string; readonly label: string; readonly selected: boolean }[];
  readonly onSpaceChange: (spaceId: string | null) => void | Promise<void>;
  readonly onTagToggle: (tagId: string) => void | Promise<void>;
  readonly busy?: boolean;
  readonly error?: string | null;
}

interface TaskNoteDetailScreenProps {
  readonly item: TaskNoteDetailItem;
  readonly onBack: () => void;
  readonly onSave: (draft: TaskNoteDetailDraft) => void | TaskNoteDetailDraft | Promise<void | TaskNoteDetailDraft>;
  readonly onChangeStatus?: () => void | Promise<void>;
  readonly onConvert?: (() => void | Promise<void>) | undefined;
  readonly metadata?: TaskNoteDetailMetadata;
  readonly tagEntityControls?: ReactNode;
  readonly saving?: boolean;
  readonly statusBusy?: boolean;
  readonly converting?: boolean;
  readonly error?: string | null;
  readonly notice?: string | null;
}

export function TaskNoteDetailScreen({ item, onBack, onSave, onChangeStatus, onConvert, metadata, tagEntityControls, saving = false, statusBusy = false, converting = false, error, notice }: TaskNoteDetailScreenProps) {
  const initialText = item.kind === "task" ? item.title : item.content;
  const [draftText, setDraftText] = useState(initialText);
  const [draftDue, setDraftDue] = useState(item.kind === "task" ? item.dueAt : null);
  const [editingText, setEditingText] = useState(false);
  const [editingDue, setEditingDue] = useState(false);
  const [metadataPanel, setMetadataPanel] = useState<"space" | "tags" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [taskSaved, setTaskSaved] = useState(false);

  useEffect(() => {
    setDraftText(initialText);
    setDraftDue(item.kind === "task" ? item.dueAt : null);
    setEditingText(false);
    setEditingDue(false);
  }, [item.id, item.kind, item.kind === "note" ? item.content : null]);

  const dirty = item.kind === "task" ? draftText !== item.title || draftDue !== item.dueAt : draftText !== item.content;
  const cancelTaskDraft = () => {
    if (saving) return;
    setDraftText(item.kind === "task" ? item.title : item.content);
    setDraftDue(item.kind === "task" ? item.dueAt : null);
    setEditingText(false);
    setEditingDue(false);
    setTaskSaved(false);
  };
  const saveDraft = async () => {
    setTaskSaved(false);
    const saved = await onSave({ text: draftText, dueAt: draftDue });
    if (item.kind === "task" && saved) {
      setDraftText(saved.text);
      setDraftDue(saved.dueAt);
      setEditingText(false);
      setEditingDue(false);
      setTaskSaved(true);
    }
  };
  const statusLabel = item.kind === "task" ? item.status === "completed" ? "Completed" : "Open" : item.reviewState === "needs_review" ? "Needs review" : "Saved";
  return <View style={styles.product}>
    <View style={styles.productTop}><Pressable accessibilityRole="button" accessibilityLabel="Back to items" onPress={onBack}><Text style={styles.breadcrumb}>‹ Items  ·  Focused editor</Text></Pressable><Text style={styles.afterCapture}>After Capture</Text></View>
    <View style={styles.body}>
      <View style={styles.statusLine}><Text style={[styles.badge, item.kind === "note" && styles.noteBadge, item.kind === "task" && item.status === "completed" && styles.doneBadge]}>{item.kind.toUpperCase()}</Text><Text style={styles.muted}>{statusLabel}</Text></View>
      <View style={styles.titleRow}>{editingText ? <TextInput accessibilityLabel={item.kind === "task" ? "Title" : "Note"} autoFocus value={draftText} onChangeText={(value) => { setDraftText(value); setTaskSaved(false); }} multiline={item.kind === "note"} style={styles.input} /> : <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.kind === "task" ? "Title" : "Note"}`} onPress={() => setEditingText(true)}><Text style={[styles.title, item.kind === "note" && styles.noteTitle, item.kind === "task" && item.status === "completed" && styles.struck]}>{draftText}</Text></Pressable>}</View>
      {item.kind === "task" ? <DueEditor dueAt={draftDue} editing={editingDue} setEditing={setEditingDue} setDueAt={(value) => { setDraftDue(value); setTaskSaved(false); }} /> : <Text style={styles.helper}>Editable Note content stays separate from the original Capture.</Text>}
      <Metadata item={item} metadata={metadata} panel={metadataPanel} setPanel={setMetadataPanel} tagEntityControls={tagEntityControls} />
      <SourceDisclosure item={item} open={showHistory} setOpen={setShowHistory} />
      <View style={styles.actions}>
        {item.kind === "task" && onChangeStatus ? <Pressable accessibilityRole="button" accessibilityLabel={item.status === "completed" ? "Reopen task" : "Complete task"} onPress={onChangeStatus} disabled={statusBusy || saving || converting} style={styles.primary}><Text style={styles.primaryText}>{statusBusy ? "Updating…" : item.status === "completed" ? "Reopen task" : "Complete task"}</Text></Pressable> : null}
        {item.kind === "task" && dirty ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel Task editing" onPress={cancelTaskDraft} disabled={saving || statusBusy || converting} style={styles.ghost}><Text style={styles.cancel}>Cancel</Text></Pressable> : null}
        {item.kind === "note" && editingText ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel Note editing" onPress={() => { setDraftText(initialText); setEditingText(false); }} disabled={saving || statusBusy || converting} style={styles.ghost}><Text style={styles.cancel}>Cancel</Text></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Save" onPress={() => void saveDraft()} disabled={!dirty || saving || statusBusy || converting} style={[styles.secondary, (!dirty || saving || statusBusy || converting) && styles.disabled]}><Text style={styles.secondaryText}>{saving ? "Saving…" : item.kind === "note" ? "Save note" : "Save changes"}</Text></Pressable>
        {item.kind === "note" && onConvert ? <Pressable accessibilityRole="button" accessibilityLabel="Convert saved Note to Task" onPress={onConvert} disabled={saving || statusBusy || converting} style={styles.ghost}><Text style={styles.ghostText}>{converting ? "Converting…" : "Convert to Task"}</Text></Pressable> : null}
      </View>
      {notice ? <Text accessibilityRole="alert" style={styles.success}>{notice}</Text> : null}
      {taskSaved ? <Text accessibilityRole="alert" style={styles.success}>Task changes saved.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  </View>;
}

function DueEditor({ dueAt, editing, setEditing, setDueAt }: { readonly dueAt: string | null; readonly editing: boolean; readonly setEditing: (value: boolean) => void; readonly setDueAt: (value: string | null) => void }) {
  const initial = parseDue(dueAt) ?? new Date();
  const hasDue = dueAt !== null;
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [draftDate, setDraftDate] = useState(initial);
  const [draftTime, setDraftTime] = useState(formatTime(initial));
  const [timeError, setTimeError] = useState<string | null>(null);
  useEffect(() => {
    const next = parseDue(dueAt) ?? new Date();
    setDraftDate(next);
    setDraftTime(formatTime(next));
    setPicker(null);
    setTimeError(null);
  }, [dueAt]);
  if (!editing) return <View style={styles.dueRow}><Pressable accessibilityRole="button" accessibilityLabel="Edit Due information" onPress={() => setEditing(true)} style={styles.dueCard}><Text style={styles.fieldLabel}>DUE DATE</Text><Text style={styles.dueValue}>{hasDue && isValidIsoDate(dueAt) ? formatDateBubble(new Date(dueAt)) : "No due date"}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Choose due time" onPress={() => { setEditing(true); setPicker("time"); }} style={styles.dueCard}><Text style={styles.fieldLabel}>DUE TIME</Text><Text style={styles.dueValue}>{hasDue && isValidIsoDate(dueAt) ? formatTime(new Date(dueAt)) : "Set time"}</Text></Pressable></View>;
  const commitDate = (date: Date) => { const [hour, minute] = draftTime.split(":").map(Number); const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute)); setDraftDate(next); setDueAt(next.toISOString()); setPicker(null); };
  const commitTime = (time: string) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setTimeError("Enter a valid time between 00:00 and 23:59"); return; } const [hour, minute] = time.split(":").map(Number); const next = new Date(Date.UTC(draftDate.getUTCFullYear(), draftDate.getUTCMonth(), draftDate.getUTCDate(), hour, minute)); setDraftTime(time); setDraftDate(next); setDueAt(next.toISOString()); setTimeError(null); setPicker(null); };
  return <View style={styles.dueEditor}><View style={styles.pickerHeading}><Text style={styles.fieldLabel}>DUE DATE & TIME</Text>{hasDue ? <Pressable accessibilityRole="button" accessibilityLabel="Clear due information" onPress={() => { setDueAt(null); setPicker(null); }}><Text style={styles.clear}>Clear</Text></Pressable> : null}</View>{hasDue ? <View style={styles.dueRow}><Pressable accessibilityRole="button" accessibilityLabel="Choose due date" onPress={() => setPicker("date")} style={styles.dueCard}><Text style={styles.fieldLabel}>DUE DATE</Text><Text style={styles.dueValue}>{formatDateBubble(draftDate)}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Choose due time" onPress={() => setPicker("time")} style={styles.dueCard}><Text style={styles.fieldLabel}>DUE TIME</Text><Text style={styles.dueValue}>{draftTime}</Text></Pressable></View> : <Text style={styles.muted}>No due date</Text>}{!hasDue ? <Pressable accessibilityRole="button" accessibilityLabel="Set due information" onPress={() => setPicker("date")}><Text style={styles.link}>Set due date</Text></Pressable> : null}<View style={styles.pickerButtons}><Pressable accessibilityRole="button" accessibilityLabel="Cancel due editing" onPress={() => setEditing(false)}><Text style={styles.cancel}>Cancel</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Done due editing" onPress={() => setEditing(false)}><Text style={styles.done}>Done</Text></Pressable></View>{timeError ? <Text accessibilityRole="alert" style={styles.error}>{timeError}</Text> : null}{picker === "date" ? <DatePicker value={draftDate} onCancel={() => setPicker(null)} onDone={commitDate} onClear={() => { setDueAt(null); setPicker(null); }} /> : null}{picker === "time" ? <TimePicker value={draftTime} onCancel={() => setPicker(null)} onDone={commitTime} /> : null}</View>;
}

function DatePicker({ value, onCancel, onDone, onClear }: { readonly value: Date; readonly onCancel: () => void; readonly onDone: (value: Date) => void; readonly onClear: () => void }) {
  const options = useMemo(() => [0, 5, 7].map((offset) => addDays(value, offset)), [value]);
  return <View style={styles.sheet}><View style={styles.sheetHeading}><Text style={styles.sheetTitle}>Choose due date</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel due date" onPress={onCancel}><Text style={styles.cancel}>Cancel</Text></Pressable></View><View style={styles.dateStrip}>{options.map((date) => <Pressable key={date.toISOString()} accessibilityRole="button" accessibilityLabel={`Due date ${dateKey(date)}`} onPress={() => onDone(date)} style={styles.dateOption}><Text style={styles.fieldLabel}>{date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase()}</Text><Text style={styles.dateOptionValue}>{formatDateBubble(date)}</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel="Due date none" onPress={onClear} style={styles.dateOption}><Text style={styles.fieldLabel}>CLEAR</Text><Text style={styles.dateOptionValue}>None</Text></Pressable></View></View>;
}

function TimePicker({ value, onCancel, onDone }: { readonly value: string; readonly onCancel: () => void; readonly onDone: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return <View style={styles.sheet}><View style={styles.sheetHeading}><Text style={styles.sheetTitle}>Choose due time</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel due time" onPress={onCancel}><Text style={styles.cancel}>Cancel</Text></Pressable></View><View style={styles.timeGrid}>{["09:30", "13:00", "18:00"].map((time) => <Pressable key={time} accessibilityRole="button" accessibilityLabel={`Due time option ${time}`} onPress={() => setDraft(time)} style={[styles.timeOption, draft === time && styles.timeOptionSelected]}><Text style={[styles.timeOptionText, draft === time && styles.timeOptionSelectedText]}>{time}</Text></Pressable>)}</View><TextInput accessibilityLabel="Due time" value={draft} onChangeText={setDraft} keyboardType="numbers-and-punctuation" style={styles.input} /><Text style={styles.pickerHint}>Or enter another time in 24-hour format.</Text><Pressable accessibilityRole="button" accessibilityLabel="Done due time" onPress={() => onDone(draft)} style={styles.doneButton}><Text style={styles.done}>Done</Text></Pressable></View>;
}

function Metadata({ item, metadata, panel, setPanel, tagEntityControls }: { readonly item: TaskNoteDetailItem; readonly metadata: TaskNoteDetailMetadata | undefined; readonly panel: "space" | "tags" | null; readonly setPanel: (value: "space" | "tags" | null) => void; readonly tagEntityControls?: ReactNode }) {
  return <View style={styles.metadata}>
    <View style={styles.propertyRow}>
      <View style={styles.propertyCopy}><Text style={styles.fieldLabel}>SPACE</Text><Text style={styles.value}>{item.space}</Text></View>
      {metadata ? <Pressable accessibilityRole="button" accessibilityLabel="Choose Space" onPress={() => setPanel(panel === "space" ? null : "space")} style={styles.propertyButton}><Text style={styles.propertyButtonText}>Change</Text></Pressable> : null}
    </View>
    {tagEntityControls ?? <BasicTagControls item={item} metadata={metadata} panel={panel} setPanel={setPanel} />}
    {metadata?.error ? <Text accessibilityRole="alert" style={styles.error}>{metadata.error}</Text> : null}
    {panel === "space" && metadata ? <SpacePicker metadata={metadata} close={() => setPanel(null)} /> : null}
  </View>;
}

function BasicTagControls({ item, metadata, panel, setPanel }: { readonly item: TaskNoteDetailItem; readonly metadata: TaskNoteDetailMetadata | undefined; readonly panel: "space" | "tags" | null; readonly setPanel: (value: "space" | "tags" | null) => void }) {
  return <>
    <View style={styles.tagProperty}>
      <View style={styles.propertyCopy}><Text style={styles.fieldLabel}>TAGS</Text><View style={styles.tagRow}>{item.tags.length > 0 ? item.tags.map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>) : <Text style={styles.muted}>No tags</Text>}</View></View>
      {metadata ? <Pressable accessibilityRole="button" accessibilityLabel="Choose Tags" onPress={() => setPanel(panel === "tags" ? null : "tags")} style={styles.propertyButton}><Text style={styles.propertyButtonText}>Change</Text></Pressable> : null}
    </View>
    {panel === "tags" && metadata ? <View style={styles.sheet}>
      <View style={styles.sheetHeading}><Text style={styles.sheetTitle}>Choose tags</Text><Pressable accessibilityRole="button" accessibilityLabel="Close Tags picker" onPress={() => setPanel(null)}><Text style={styles.cancel}>Done</Text></Pressable></View>
      {metadata.tags.map((tag) => <Pressable key={tag.id} accessibilityRole="checkbox" accessibilityState={{ checked: tag.selected }} accessibilityLabel={`${tag.selected ? "Remove" : "Add"} tag ${tag.label}`} onPress={() => void metadata.onTagToggle(tag.id)} style={[styles.choice, tag.selected && styles.choiceSelected]}><Text style={styles.choiceText}>{tag.selected ? "✓ " : "○ "}#{tag.label}</Text></Pressable>)}
    </View> : null}
  </>;
}

function SpacePicker({ metadata, close }: { readonly metadata: TaskNoteDetailMetadata; readonly close: () => void }) {
  return <View style={styles.sheet}>
    <View style={styles.sheetHeading}><Text style={styles.sheetTitle}>Choose Space</Text><Pressable accessibilityRole="button" accessibilityLabel="Close Space picker" onPress={close}><Text style={styles.cancel}>Done</Text></Pressable></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose Space Unassigned" onPress={() => { void metadata.onSpaceChange(null); close(); }} style={[styles.choice, metadata.selectedSpaceId === null && styles.choiceSelected]}><Text style={styles.choiceText}>No Space</Text></Pressable>
    {metadata.spaces.map((space) => <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Choose Space ${space.label}`} onPress={() => { void metadata.onSpaceChange(space.id); close(); }} style={[styles.choice, metadata.selectedSpaceId === space.id && styles.choiceSelected]}><Text style={styles.choiceText}>{space.label}</Text></Pressable>)}
  </View>;
}

function SourceDisclosure({ item, open, setOpen }: { readonly item: TaskNoteDetailItem; readonly open: boolean; readonly setOpen: (value: boolean) => void }) {
  return <View style={styles.source}><Pressable accessibilityRole="button" accessibilityLabel="Toggle source and review history" onPress={() => setOpen(!open)}><Text style={styles.sourceLabel}>{open ? "⌃" : "⌄"}  Source & review history</Text></Pressable>{open ? <View style={styles.history}><View style={[styles.historyItem, styles.historySource]}><View style={styles.dot} /><View><Text style={styles.historyTitle}>Original Capture</Text><Text style={styles.historyText}>{item.source}</Text>{item.transcription ? <><Text style={styles.historyTitle}>Original transcription{item.transcription.language ? ` · ${item.transcription.language}` : ""}</Text><Text style={styles.historyText}>{item.transcription.text}</Text></> : null}</View></View><View style={[styles.historyItem, styles.historyInterpretation]}><View style={styles.dot} /><View><Text style={styles.historyTitle}>Interpretation</Text><Text style={styles.historyText}>{item.interpretation ?? "Saved result"}</Text></View></View></View> : null}</View>;
}

function parseDue(value: string | null): Date | null { return value && isValidIsoDate(value) ? new Date(value) : null; }
function isValidIsoDate(value: string): boolean { const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/.exec(value); if (!match) return false; const date = new Date(value); return !Number.isNaN(date.getTime()) && date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) && date.getUTCHours() === Number(match[4]) && date.getUTCMinutes() === Number(match[5]); }
function formatDateBubble(value: Date): string { return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }
function formatTime(value: Date): string { return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`; }
function dateKey(value: Date): string { return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`; }
function addDays(value: Date, days: number): Date { const next = new Date(value); next.setUTCDate(next.getUTCDate() + days); return next; }
function pad(value: number): string { return String(value).padStart(2, "0"); }

const styles = StyleSheet.create({
  product: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 22, borderWidth: 1, overflow: "hidden", shadowColor: tokens.colors.ink, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 18 }, productTop: { alignItems: "center", borderBottomColor: tokens.colors.border, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 16 }, breadcrumb: { color: tokens.colors.muted, flex: 1, fontSize: 12 }, afterCapture: { color: tokens.colors.muted, fontSize: 12 }, body: { padding: 22 }, statusLine: { alignItems: "center", flexDirection: "row", gap: 8 }, badge: { backgroundColor: "rgba(23, 59, 47, 0.1)", borderRadius: tokens.radius.pill, color: tokens.colors.green, fontSize: 11, fontWeight: "800", letterSpacing: 1, paddingHorizontal: 9, paddingVertical: 6 }, noteBadge: { backgroundColor: tokens.colors.lavender, color: tokens.colors.ink }, doneBadge: { backgroundColor: tokens.colors.green, color: tokens.colors.lime }, muted: { color: tokens.colors.muted, fontSize: 13 }, titleRow: { marginBottom: 18, marginTop: 12 }, title: { color: tokens.colors.ink, fontSize: 36, fontWeight: "800", letterSpacing: -1.5, lineHeight: 42 }, noteTitle: { fontWeight: "500" }, struck: { color: tokens.colors.muted, textDecorationLine: "line-through" }, input: { borderBottomColor: tokens.colors.green, borderBottomWidth: 2, color: tokens.colors.ink, fontSize: 24, lineHeight: 32, paddingVertical: 5 }, helper: { color: tokens.colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 4 }, dueRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, dueCard: { backgroundColor: tokens.colors.background, borderColor: tokens.colors.border, borderRadius: 15, borderWidth: 1, flex: 1, minWidth: 142, paddingHorizontal: 14, paddingVertical: 12 }, fieldLabel: { color: tokens.colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, dueValue: { color: tokens.colors.ink, fontSize: 15, fontWeight: "700", marginTop: 5 }, value: { color: tokens.colors.ink, fontSize: 15, marginTop: 6 }, dueEditor: { backgroundColor: tokens.colors.background, borderTopColor: tokens.colors.border, borderTopWidth: 1, marginTop: 4, paddingTop: 16 }, pickerHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }, clear: { color: "#9B392B", fontSize: 13, fontWeight: "700" }, link: { color: tokens.colors.green, fontSize: 13, fontWeight: "800", marginTop: 12 }, pickerButtons: { alignItems: "center", flexDirection: "row", gap: 18, justifyContent: "flex-end", marginTop: 16 }, cancel: { color: tokens.colors.muted, fontWeight: "700" }, done: { color: tokens.colors.green, fontWeight: "800" }, sheet: { backgroundColor: tokens.colors.background, borderTopColor: tokens.colors.border, borderTopWidth: 1, marginTop: 14, paddingTop: 15 }, sheetHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }, sheetTitle: { color: tokens.colors.ink, fontSize: 16, fontWeight: "800" }, dateStrip: { flexDirection: "row", gap: 7 }, dateOption: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 13, borderWidth: 1, flex: 1, minWidth: 70, paddingHorizontal: 7, paddingVertical: 10 }, dateOptionValue: { color: tokens.colors.ink, fontSize: 12, fontWeight: "700", marginTop: 5 }, timeGrid: { flexDirection: "row", gap: 8, marginBottom: 14 }, timeOption: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 12 }, timeOptionSelected: { backgroundColor: tokens.colors.green, borderColor: tokens.colors.green }, timeOptionText: { color: tokens.colors.ink, fontSize: 14, fontWeight: "800", textAlign: "center" }, timeOptionSelectedText: { color: "#FFFFFF" }, pickerHint: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 8 }, doneButton: { alignSelf: "flex-end", marginTop: 12 },
  metadata: { borderTopColor: tokens.colors.border, borderTopWidth: 1, marginTop: 22, paddingTop: 16 }, propertyRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" }, propertyCopy: { flex: 1 }, propertyButton: { borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 }, propertyButtonText: { color: tokens.colors.green, fontSize: 12, fontWeight: "800" }, tagProperty: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, tagRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 7 }, tag: { backgroundColor: "rgba(23, 59, 47, 0.09)", borderRadius: 8, color: tokens.colors.green, fontSize: 12, paddingHorizontal: 8, paddingVertical: 5 }, choice: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 11, borderWidth: 1, marginBottom: 7, paddingHorizontal: 12, paddingVertical: 11 }, choiceSelected: { backgroundColor: tokens.colors.lime, borderColor: tokens.colors.green }, choiceText: { color: tokens.colors.ink, fontSize: 14, fontWeight: "700" },
  source: { borderTopColor: tokens.colors.border, borderTopWidth: 1, marginTop: 16, paddingTop: 14 }, sourceLabel: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" }, history: { gap: 8, marginTop: 12 }, historyItem: { borderRadius: 13, flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingVertical: 11 }, historySource: { backgroundColor: tokens.colors.lavender }, historyInterpretation: { backgroundColor: tokens.colors.butter }, dot: { backgroundColor: tokens.colors.green, borderRadius: 4, height: 8, marginTop: 4, width: 8 }, historyTitle: { color: tokens.colors.ink, fontSize: 13, fontWeight: "800" }, historyText: { color: tokens.colors.ink, fontSize: 13, lineHeight: 18, marginTop: 3 }, actions: { borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 22, paddingTop: 18 }, primary: { backgroundColor: tokens.colors.green, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12 }, primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" }, secondary: { backgroundColor: tokens.colors.lime, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12 }, secondaryText: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" }, ghost: { borderColor: tokens.colors.border, borderRadius: 13, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12 }, ghostText: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" }, disabled: { opacity: 0.45 }, success: { color: "#356445", fontSize: 13, lineHeight: 18, marginTop: 12 }, error: { color: "#9B392B", fontSize: 13, lineHeight: 18, marginTop: 10 },
});
