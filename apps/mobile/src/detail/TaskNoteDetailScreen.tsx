import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { tokens } from "../design-system";
import { DueEditor } from "./DueEditor";

export type TaskNoteDetailItem =
  | { readonly kind: "task"; readonly id: string; readonly title: string; readonly status: "open" | "completed"; readonly dueAt: string | null; readonly space: string; readonly tags: readonly string[]; readonly source: string; readonly sourceDetails?: string; readonly correction?: string; readonly interpretation?: string; readonly transcription?: { readonly text: string; readonly language?: string } }
  | { readonly kind: "note"; readonly id: string; readonly content: string; readonly reviewState: "saved" | "needs_review"; readonly space: string; readonly tags: readonly string[]; readonly source: string; readonly sourceDetails?: string; readonly correction?: string; readonly interpretation?: string; readonly transcription?: { readonly text: string; readonly language?: string } };

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
  readonly initialEditing?: boolean;
  readonly onSave: (draft: TaskNoteDetailDraft) => void | TaskNoteDetailDraft | Promise<void | TaskNoteDetailDraft>;
  readonly onChangeStatus?: () => void | Promise<void>;
  readonly onConvert?: (() => void | Promise<void>) | undefined;
  readonly metadata?: TaskNoteDetailMetadata;
  readonly tagEntityControls?: (() => ReactNode) | undefined;
  readonly saving?: boolean;
  readonly statusBusy?: boolean;
  readonly converting?: boolean;
  readonly error?: string | null;
  readonly notice?: string | null;
}

export function TaskNoteDetailScreen({ item, onBack, initialEditing = false, onSave, onChangeStatus, onConvert, metadata, tagEntityControls, saving = false, statusBusy = false, converting = false, error, notice }: TaskNoteDetailScreenProps) {
  const initialText = item.kind === "task" ? item.title : item.content;
  const [draftText, setDraftText] = useState(initialText);
  const [draftDue, setDraftDue] = useState(item.kind === "task" ? item.dueAt : null);
  const [editing, setEditing] = useState(initialEditing);
  const [editingDue, setEditingDue] = useState(false);
  const [metadataPanel, setMetadataPanel] = useState<"space" | "tags" | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [taskSaved, setTaskSaved] = useState(false);

  useEffect(() => {
    setDraftText(initialText);
    setDraftDue(item.kind === "task" ? item.dueAt : null);
    setEditing(initialEditing);
    setEditingDue(false);
  }, [initialEditing, item.id, item.kind, item.kind === "note" ? item.content : null]);

  const dirty = item.kind === "task" ? draftText !== item.title || draftDue !== item.dueAt : draftText !== item.content;
  const saveDraft = async () => {
    setTaskSaved(false);
    const saved = await onSave({ text: draftText, dueAt: draftDue });
    if (item.kind === "task" && saved) {
      setDraftText(saved.text);
      setDraftDue(saved.dueAt);
      setEditing(false);
      setEditingDue(false);
      setTaskSaved(true);
    }
  };
  const cancelEditing = () => {
    if (saving || statusBusy || converting) return;
    setDraftText(initialText);
    setDraftDue(item.kind === "task" ? item.dueAt : null);
    setEditing(false);
    setEditingDue(false);
    setTaskSaved(false);
  };
  const statusLabel = item.kind === "task" ? item.status === "completed" ? "Completed" : "Open" : item.reviewState === "needs_review" ? "Needs review" : "Saved";
  const canSave = dirty && !editingDue && !saving && !statusBusy && !converting;
  return <View style={styles.product}>
    <View style={styles.productTop}>{editing ? <Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" onPress={cancelEditing} disabled={saving || statusBusy || converting} style={styles.headerAction}><CloseIcon /></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="Back to items" onPress={onBack} style={styles.headerAction}><Text style={styles.breadcrumb}>‹ Items</Text></Pressable>}<Text accessibilityRole="header" style={styles.screenTitle}>{editing ? `Edit ${item.kind === "task" ? "Task" : "Note"}` : item.kind === "task" ? "Task" : "Note"}</Text>{editing ? <Pressable accessibilityRole="button" accessibilityLabel="Save" onPress={() => void saveDraft()} disabled={!canSave} style={styles.headerAction}><CheckIcon enabled={canSave} /></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.kind === "task" ? "Task" : "Note"}`} onPress={() => setEditing(true)} style={styles.headerAction}><Text style={styles.editAction}>Edit</Text></Pressable>}</View>
    <View style={styles.body}>
      <View style={styles.statusLine}><Text style={[styles.badge, item.kind === "note" && styles.noteBadge, item.kind === "task" && item.status === "completed" && styles.doneBadge]}>{item.kind.toUpperCase()}</Text><Text style={styles.muted}>{statusLabel}</Text></View>
      <View style={styles.titleRow}>{editing ? <TextInput accessibilityLabel={item.kind === "task" ? "Title" : "Note"} value={draftText} onChangeText={(value) => { setDraftText(value); setTaskSaved(false); }} multiline={item.kind === "note"} style={styles.input} /> : <Text style={[styles.title, item.kind === "note" && styles.noteTitle, item.kind === "task" && item.status === "completed" && styles.struck]}>{draftText}</Text>}</View>
      {item.kind === "task" && (editing || (draftDue !== null && draftDue.trim().length > 0)) ? <DueEditor key={item.id} disabled={!editing || saving || statusBusy || converting} dueAt={draftDue} editing={editingDue} setEditing={setEditingDue} setDueAt={(value) => { setDraftDue(value); setTaskSaved(false); }} /> : null}
      {item.kind === "note" && editing ? <Text style={styles.helper}>Changes stay separate from the original Capture.</Text> : null}
      <Metadata item={item} metadata={metadata} panel={metadataPanel} setPanel={setMetadataPanel} tagEntityControls={tagEntityControls} editable={editing} />
      <View style={styles.history}>
        <Pressable accessibilityRole="button" accessibilityLabel="Toggle source and review history" accessibilityState={{ expanded: historyExpanded }} onPress={() => setHistoryExpanded((expanded) => !expanded)} style={styles.historyToggle}>
          <Text style={styles.historyToggleText}>{historyExpanded ? "Hide" : "Show"} source and review history</Text>
        </Pressable>
        {historyExpanded ? <View style={styles.historyContent}>
          <Text style={styles.fieldLabel}>Capture source</Text>
          <Text style={styles.historyText}>{item.source}</Text>
          {item.sourceDetails ? <Text style={styles.historyText}>{item.sourceDetails}</Text> : null}
          <Text style={styles.fieldLabel}>Original transcription{item.transcription?.language ? ` · ${item.transcription.language}` : ""}</Text>
          <Text style={styles.historyText}>{item.transcription?.text ?? "No transcription available"}</Text>
          {item.correction ? <><Text style={styles.fieldLabel}>Correction</Text><Text style={styles.historyText}>{item.correction}</Text></> : null}
          <Text style={styles.fieldLabel}>Interpretation</Text>
          <Text style={styles.historyText}>{item.interpretation ?? "No interpretation available"}</Text>
          <Text style={styles.fieldLabel}>Saved outcome</Text>
          <Text style={styles.historyText}>{initialText}</Text>
        </View> : null}
      </View>
      <View style={styles.actions}>
        {!editing && item.kind === "task" && onChangeStatus ? <Pressable accessibilityRole="button" accessibilityLabel={item.status === "completed" ? "Reopen task" : "Complete task"} onPress={onChangeStatus} disabled={statusBusy || saving || converting} style={styles.primary}><Text style={styles.primaryText}>{statusBusy ? "Updating…" : item.status === "completed" ? "Reopen task" : "Complete task"}</Text></Pressable> : null}
        {!editing && item.kind === "note" && onConvert ? <Pressable accessibilityRole="button" accessibilityLabel="Convert saved Note to Task" onPress={onConvert} disabled={saving || statusBusy || converting} style={styles.ghost}><Text style={styles.ghostText}>{converting ? "Converting…" : "Convert to Task"}</Text></Pressable> : null}
      </View>
      {notice ? <Text accessibilityRole="alert" style={styles.success}>{notice}</Text> : null}
      {taskSaved ? <Text accessibilityRole="alert" style={styles.success}>Task changes saved.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  </View>;
}

function Metadata({ item, metadata, panel, setPanel, tagEntityControls, editable }: { readonly item: TaskNoteDetailItem; readonly metadata: TaskNoteDetailMetadata | undefined; readonly panel: "space" | "tags" | null; readonly setPanel: (value: "space" | "tags" | null) => void; readonly tagEntityControls?: (() => ReactNode) | undefined; readonly editable: boolean }) {
  const showSpace = hasMeaningfulSpace(item.space);
  return <View>
    {showSpace || editable ? <View style={styles.propertyRow}>
      <View style={styles.propertyCopy}><Text style={styles.fieldLabel}>SPACE</Text><Text style={styles.value}>{showSpace ? item.space : "No Space"}</Text></View>
      {editable && metadata ? <Pressable accessibilityRole="button" accessibilityLabel="Choose Space" onPress={() => setPanel(panel === "space" ? null : "space")} style={styles.propertyButton}><Text style={styles.propertyButtonText}>Change</Text></Pressable> : null}
    </View> : null}
    {tagEntityControls ? tagEntityControls() : <BasicTagControls item={item} metadata={metadata} panel={panel} setPanel={setPanel} editable={editable} />}
    {metadata?.error ? <Text accessibilityRole="alert" style={styles.error}>{metadata.error}</Text> : null}
    {panel === "space" && metadata ? <SpacePicker metadata={metadata} close={() => setPanel(null)} /> : null}
  </View>;
}

function BasicTagControls({ item, metadata, panel, setPanel, editable }: { readonly item: TaskNoteDetailItem; readonly metadata: TaskNoteDetailMetadata | undefined; readonly panel: "space" | "tags" | null; readonly setPanel: (value: "space" | "tags" | null) => void; readonly editable: boolean }) {
  const tags = item.tags.filter((tag) => tag.trim().length > 0);
  return <>
    {editable || tags.length > 0 ? <View style={styles.tagProperty}>
      <View style={styles.propertyCopy}><Text style={styles.fieldLabel}>TAGS</Text><View style={styles.tagRow}>{tags.map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}{editable && tags.length === 0 ? <Text style={styles.muted}>No tags</Text> : null}</View></View>
      {editable && metadata ? <Pressable accessibilityRole="button" accessibilityLabel="Choose Tags" onPress={() => setPanel(panel === "tags" ? null : "tags")} style={styles.propertyButton}><Text style={styles.propertyButtonText}>Change</Text></Pressable> : null}
    </View> : null}
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

function CloseIcon() {
  return <View style={[styles.headerIcon, styles.headerIconCancel]}>
    <View style={[styles.closeStrokeA, styles.iconStroke, styles.disabledStroke]} />
    <View style={[styles.closeStrokeB, styles.iconStroke, styles.disabledStroke]} />
  </View>;
}

function CheckIcon({ enabled }: { readonly enabled: boolean }) {
  return <View style={[styles.headerIcon, enabled ? styles.headerIconEnabled : styles.headerIconDisabled]}>
    <View style={[styles.checkStrokeShort, styles.iconStroke, enabled ? styles.enabledStroke : styles.disabledStroke]} />
    <View style={[styles.checkStrokeLong, styles.iconStroke, enabled ? styles.enabledStroke : styles.disabledStroke]} />
  </View>;
}

function hasMeaningfulSpace(value: string): boolean { return value.trim().length > 0 && value.trim().toLocaleLowerCase() !== "no space"; }

const styles = StyleSheet.create({
  product: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 22, borderWidth: 1, overflow: "hidden", shadowColor: tokens.colors.ink, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 18 }, productTop: { alignItems: "center", borderBottomColor: tokens.colors.border, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 54, paddingHorizontal: 18, paddingVertical: 12 }, headerAction: { alignItems: "center", justifyContent: "center", minWidth: 54, minHeight: 40 }, screenTitle: { color: tokens.colors.ink, flex: 1, fontSize: 16, fontWeight: "700", textAlign: "center" }, headerIcon: { alignItems: "center", borderRadius: 18, borderWidth: 1.5, height: 34, justifyContent: "center", position: "relative", width: 34 }, headerIconEnabled: { borderColor: tokens.colors.green }, headerIconDisabled: { borderColor: tokens.colors.border, backgroundColor: "#F2F2F7" }, headerIconCancel: { backgroundColor: "#F2F2F7", borderColor: tokens.colors.border }, iconStroke: { borderRadius: 1 }, closeStrokeA: { height: 2, left: 9, position: "absolute", top: 15, transform: [{ rotate: "45deg" }], width: 13 }, closeStrokeB: { height: 2, left: 9, position: "absolute", top: 15, transform: [{ rotate: "-45deg" }], width: 13 }, checkStrokeShort: { height: 2.5, left: 8, position: "absolute", top: 16, transform: [{ rotate: "45deg" }], width: 6 }, checkStrokeLong: { height: 2.5, left: 12, position: "absolute", top: 14, transform: [{ rotate: "-45deg" }], width: 11 }, enabledStroke: { backgroundColor: tokens.colors.green }, disabledStroke: { backgroundColor: tokens.colors.muted }, editAction: { color: tokens.colors.green, fontSize: 14, fontWeight: "700" }, breadcrumb: { color: tokens.colors.muted, fontSize: 12 }, body: { padding: 16 }, statusLine: { alignItems: "center", flexDirection: "row", gap: 8 }, badge: { backgroundColor: "rgba(23, 59, 47, 0.1)", borderRadius: tokens.radius.pill, color: tokens.colors.green, fontSize: 11, fontWeight: "800", letterSpacing: 1, paddingHorizontal: 9, paddingVertical: 6 }, noteBadge: { backgroundColor: tokens.colors.lavender, color: tokens.colors.ink }, doneBadge: { backgroundColor: tokens.colors.green, color: tokens.colors.lime, }, muted: { color: tokens.colors.muted, fontSize: 13 }, titleRow: { borderBottomColor: tokens.colors.border, borderBottomWidth: 1, borderTopColor: tokens.colors.border, borderTopWidth: 1, marginBottom: 8, marginTop: 8, paddingVertical: 10 }, title: { color: tokens.colors.ink, fontSize: 32, fontWeight: "800", letterSpacing: -1.2, lineHeight: 38 }, noteTitle: { fontWeight: "500" }, struck: { color: tokens.colors.muted, textDecorationLine: "line-through" }, input: { color: tokens.colors.ink, fontSize: 24, lineHeight: 32, paddingVertical: 5 }, helper: { color: tokens.colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 4 }, fieldLabel: { color: tokens.colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 }, value: { color: tokens.colors.ink, fontSize: 15, marginTop: 6 }, cancel: { color: tokens.colors.muted, fontWeight: "700" }, done: { color: tokens.colors.green, fontWeight: "800" }, sheet: { backgroundColor: tokens.colors.background, borderTopColor: tokens.colors.border, borderTopWidth: 1, marginTop: 12, paddingTop: 12 }, sheetHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, sheetTitle: { color: tokens.colors.ink, fontSize: 16, fontWeight: "800" },
  propertyRow: { alignItems: "center", borderBottomColor: tokens.colors.border, borderBottomWidth: 1, borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginVertical: 8, paddingVertical: 10 }, propertyCopy: { flex: 1 }, propertyButton: { borderColor: tokens.colors.border, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 }, propertyButtonText: { color: tokens.colors.green, fontSize: 12, fontWeight: "800" }, tagProperty: { alignItems: "flex-start", borderBottomColor: tokens.colors.border, borderBottomWidth: 1, borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 10 }, tagRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 5 }, tag: { backgroundColor: "rgba(23, 59, 47, 0.09)", borderRadius: 8, color: tokens.colors.green, fontSize: 12, paddingHorizontal: 8, paddingVertical: 5 }, choice: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 11, borderWidth: 1, marginBottom: 7, paddingHorizontal: 12, paddingVertical: 11 }, choiceSelected: { backgroundColor: tokens.colors.lime, borderColor: tokens.colors.green }, choiceText: { color: tokens.colors.ink, fontSize: 14, fontWeight: "700" },
  history: { borderTopColor: tokens.colors.border, borderTopWidth: 1, marginTop: 14, paddingTop: 10 }, historyToggle: { paddingVertical: 8 }, historyToggleText: { color: tokens.colors.green, fontSize: 13, fontWeight: "700" }, historyContent: { gap: 6, paddingBottom: 8 }, historyText: { color: tokens.colors.ink, fontSize: 14, lineHeight: 20, marginBottom: 6 }, actions: { borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 16, paddingTop: 12 }, primary: { backgroundColor: tokens.colors.green, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12 }, primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" }, secondary: { backgroundColor: tokens.colors.lime, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12 }, secondaryText: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" }, ghost: { borderColor: tokens.colors.border, borderRadius: 13, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12 }, ghostText: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" }, disabled: { opacity: 0.45 }, success: { color: "#356445", fontSize: 13, lineHeight: 18, marginTop: 12 }, error: { color: "#9B392B", fontSize: 13, lineHeight: 18, marginTop: 10 },
});
